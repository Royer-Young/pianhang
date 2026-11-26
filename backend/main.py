# -*- coding: utf-8 -*-
"""偏航后端服务（FastAPI）

API 密钥仅存储于后端环境变量，不向客户端暴露。
"""
import asyncio
import hashlib
import hmac
import http.client
import json
import math
import os
import random
import re
import secrets
import socket
import sqlite3
import time
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
from pydantic import BaseModel
from slowapi import Limiter as SlowLimiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

# 加载 backend/.env（密钥仅在此处配置，不下发前端）
_env_path = Path(__file__).parent / ".env"
load_dotenv(_env_path)

LLM_API_KEY = os.environ.get("LLM_API_KEY", "")
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "https://api.openai-next.com/v1")
LLM_MODEL = os.environ.get("LLM_MODEL", "deepseek-v4-flash")
ENVIRONMENT = os.environ.get("ENVIRONMENT", "development").lower()
IS_PRODUCTION = ENVIRONMENT in ("production", "prod")

MOCK_MODE = not LLM_API_KEY  # 未配置密钥时启用模拟模式

# 生产环境默认值
_COOKIE_SECURE_DEFAULT = "1" if IS_PRODUCTION else "0"
_DEMO_DEFAULT = "0" if IS_PRODUCTION else "1"

# 懒加载 OpenAI 客户端：避免 httpx 版本冲突导致导入阶段崩掉。
# 真实调用时才初始化（_get_llm_client），mock 模式下完全不碰它。
_llm_client = None

def _get_llm_client():
    global _llm_client
    if _llm_client is None and not MOCK_MODE:
        _llm_client = OpenAI(api_key=LLM_API_KEY, base_url=LLM_BASE_URL, timeout=20.0)
    return _llm_client

app = FastAPI(title="偏航后端", version="0.3.0")

# 限流：内存存储，按请求来源 IP 限流（反向代理下仍可用，因为 slowapi 默认走 get_remote_address）
limiter = SlowLimiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# 跨域：允许前端域名访问（从环境变量读取，逗号分隔；生产环境默认收紧为空列表，由平台代理统一处理）
if IS_PRODUCTION:
    cors_raw = os.environ.get("CORS_ORIGINS", "")
    CORS_ORIGINS = [o.strip() for o in cors_raw.split(",") if o.strip()] if cors_raw else []
else:
    CORS_ORIGINS = os.environ.get(
        "CORS_ORIGINS",
        "http://localhost:8000,http://127.0.0.1:8000,http://localhost:8124,http://127.0.0.1:8124",
    ).split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type"],
)


# ---------- 请求模型 ----------
class ParsePrefRequest(BaseModel):
    user_text: str = ""
    minutes: Optional[int] = None


class PoiItem(BaseModel):
    name: str = ""
    type: str = ""
    lat: float = 0
    lng: float = 0


class GetReasonRequest(BaseModel):
    pois: List[PoiItem] = []
    weather: str = ""
    minutes: int = 60


class GetIntroRequest(BaseModel):
    name: str = ""
    type: str = ""


# ---------- 大模型调用 ----------

def extract_json(raw: str) -> dict:
    """鲁棒解析模型输出的JSON：兼容 markdown 代码块、前后缀杂讯"""
    if not raw:
        raise ValueError("模型返回为空")
    raw = raw.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```[A-Za-z]*\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    try:
        return json.loads(raw)
    except Exception:
        m = re.search(r"\{.*\}", raw, re.S)
        if m:
            return json.loads(m.group(0))
        raise


def call_llm(system_prompt: str, user_prompt: str, json_mode: bool = True, temperature: float = 0.7) -> str:
    """统一大模型调用，返回文本或JSON字符串。

    注意：openai-next 等中转服务对部分模型不支持 response_format=json_object，
    因此统一不传该参数，改用提示词约束 + 鲁棒解析。
    """
    if MOCK_MODE:
        raise RuntimeError("未配置 LLM_API_KEY，无法调用大模型")
    kwargs = {
        "model": LLM_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": temperature,
    }
    resp = _get_llm_client().chat.completions.create(**kwargs)
    return resp.choices[0].message.content


# ---------- AI 接口（真实大模型版） ----------

def ai_parse_pref(user_text: str, minutes: Optional[int]) -> dict:
    """解析用户自由文本 → 结构化参数"""
    time_map = {30: "short", 60: "medium", 90: "long"}
    time_level = time_map.get(minutes, "medium") if minutes else "medium"

    system_prompt = (
        "你是偏航App的偏好解析助手。根据用户描述，输出JSON格式的结构化参数。"
        "time_level只能是short/medium/long；walk_intensity只能是low/mid/high；"
        "novelty和minor_level都是0-1的数字（保留1位小数）。"
        "只输出JSON对象本身，不要添加任何解释、标点或markdown代码块。"
    )
    user_prompt = (
        f"用户可用时间：{minutes}分钟。"
        f"用户描述：{user_text or '无'}\n"
        "请返回JSON：{\"time_level\":\"...\", \"walk_intensity\":\"...\", \"novelty\":0.x, \"minor_level\":0.x}"
    )
    try:
        raw = call_llm(system_prompt, user_prompt, json_mode=True)
        result = extract_json(raw)
        result.setdefault("time_level", time_level)
        result["novelty"] = float(result.get("novelty", 0.5))
        result["minor_level"] = float(result.get("minor_level", 0.5))
        return result
    except Exception as e:
        err_msg = str(e)
        print(f"[WARN] LLM解析失败，使用默认值: {err_msg}")
        return {
            "time_level": time_level,
            "walk_intensity": "mid",
            "novelty": 0.5,
            "minor_level": 0.5,
            "llm_error": err_msg,
        }


def ai_get_reason(pois: List[PoiItem], weather: str, minutes: int) -> dict:
    """生成路线推荐理由"""
    names = [p.name or "?" for p in (pois or [])]
    types = [p.type or "" for p in (pois or [])]
    head = "、".join(names) if names else "若干地点"
    type_set = "、".join(sorted(set(t for t in types if t))) or "各类地点"

    system_prompt = (
        "你是偏航App的路线推荐助手。根据地点列表、天气和时长，生成一段有吸引力的路线推荐理由。"
        "不要编造地点不存在的事实（如历史、评分等）。理由要简洁、口语化、有温度，控制在100字以内。"
    )
    user_prompt = f"地点：{head}（{type_set}），当前天气：{weather or '未知'}，预计时长：{minutes}分钟。请生成推荐理由。"
    try:
        text = call_llm(system_prompt, user_prompt, json_mode=False)
        return {"text": text.strip()}
    except Exception as e:
        err_msg = str(e)
        print(f"[WARN] LLM生成理由失败，使用模板: {err_msg}")
        return {
            "text": f"这条路线串联{len(names)}处地点：{head}，结合{weather or '当前'}天气与约{minutes}分钟时长，带你逛平时容易忽略的街角与风景。",
            "llm_error": err_msg,
        }


# 每个地点随机抽一个写作角度，避免所有停留点都是同一套话术
INTRO_ANGLES = [
    "从名字能听出的气质",
    "在这里适合做的一件小事",
    "它和旁边街道、社区的关系",
    "适合在什么时段路过",
    "一个人走进去时的感觉",
    "门外先看到、听到的细节",
]


def intro_fallback(name: str, ptype: str) -> str:
    """大模型不可用时的兜底文案：按地点名散列选句式，避免完全雷同"""
    name = name or "这里"
    p = ptype or "地点"
    templates = [
        f"拐进巷口就是{name}，一处{p}，走进去的那几步路比门口更安静。",
        f"{name}是那种路过才发现、专门找反而找不到的{p}，适合顺路拐一下。",
        f"如果时间还宽裕，可以绕到{name}看一眼——一处没什么人排队的{p}。",
        f"{name}这一带的生活气比招牌更明显，{p}门口常常站着两三个本地人。",
        f"走到{name}时脚步会慢下来，{p}本身不大，但足够撑起一次停留。",
        f"{name}藏在街区中间，作为一处{p}，它更像是个路标，而不是目的地。",
    ]
    idx = sum(ord(c) for c in name) % len(templates)
    return templates[idx]


def ai_get_intro(name: str, ptype: str) -> dict:
    """生成地点简短介绍（每个地点换角度、换句式，避免套话）"""
    angle = random.choice(INTRO_ANGLES)
    system_prompt = (
        "你在为一个城市漫游App写地点卡片文案。读者正在步行途中，只看一眼就要决定要不要拐进去。\n"
        "写作要求：\n"
        "1. 只写一句话，40~60字，口语、具体、有画面感。\n"
        "2. 必须出现地点名，并让它读起来像这个地方本身。\n"
        "3. 禁止使用这些套话：适合稍作停留、慢慢感受、放慢脚步、留意周围细节、值得一去、氛围感、小众宝藏、城市角落。\n"
        "4. 不同地点必须用不同的开头和句式，不要每段都从地点名开始。\n"
        "5. 不要编造历史、评分、店龄、创始人、招牌产品等无法从名称推断的事实。\n"
        "6. 只输出这一句话，不要引号、不要解释、不要换行。"
    )
    user_prompt = f"地点：{name}\n类型：{ptype or '地点'}\n这次请侧重：{angle}"
    try:
        text = call_llm(system_prompt, user_prompt, json_mode=False, temperature=0.95)
        return {"text": text.strip()}
    except Exception as e:
        err_msg = str(e)
        print(f"[WARN] LLM生成介绍失败，使用兜底文案: {err_msg}")
        return {"text": intro_fallback(name, ptype), "llm_error": err_msg}


# ---------- 模拟模式实现（未配置密钥时回退） ----------

def mock_parse_pref(user_text: str, minutes: Optional[int]) -> dict:
    """模拟：解析用户自由文本 → 结构化参数"""
    t = (user_text or "").strip()
    if minutes:
        if minutes <= 30:
            time_level = "short"
        elif minutes <= 60:
            time_level = "medium"
        else:
            time_level = "long"
    else:
        if any(k in t for k in ("近", "不远", "短", "少走")):
            time_level = "short"
        elif any(k in t for k in ("远", "长", "多走")):
            time_level = "long"
        else:
            time_level = "medium"
    if any(w in t for w in ("慢", "悠闲", "闲逛", "散步", "漫步", "轻松")):
        walk_intensity = "low"
    elif any(w in t for w in ("快", "赶", "急", "效率")):
        walk_intensity = "high"
    else:
        walk_intensity = "mid"
    if any(w in t for w in ("小众", "冷门", "人少", "安静", "特别", "独特", "新奇")):
        novelty = 0.85
    elif any(w in t for w in ("热门", "打卡", "著名", "网红", "知名")):
        novelty = 0.20
    else:
        novelty = 0.50
    if any(w in t for w in ("弄堂", "小巷", "小路", "支路", "偏", "安静")):
        minor_level = 0.85
    elif any(w in t for w in ("主路", "大道", "大街", "环线")):
        minor_level = 0.20
    else:
        minor_level = 0.50
    return {
        "time_level": time_level,
        "walk_intensity": walk_intensity,
        "novelty": round(novelty, 2),
        "minor_level": round(minor_level, 2),
    }


def mock_get_reason(pois: List[PoiItem], weather: str, minutes: int) -> dict:
    """模拟：生成路线推荐理由"""
    names = [p.name or "?" for p in (pois or [])]
    types = [p.type or "" for p in (pois or [])]
    n = len(names)
    w = weather or "未知天气"
    head = "、".join(names) if names else "若干地点"
    type_set = "、".join(sorted(set(t for t in types if t))) or "各类地点"
    templates = [
        f"这条路线串联{n}处地点：{head}，带你逛平时容易忽略的街角与风景。",
        f"结合当前{w}与约{minutes}分钟时长，{type_set}混搭，兼顾新奇发现与步行舒适度。",
        f"从{names[0] if n else '起点'}出发，依次经过{head}，是一条“非最短但值得”的探索路线。",
    ]
    idx = (hash(tuple(names)) % len(templates)) if names else 0
    return {"text": templates[idx]}


def mock_get_intro(name: str, ptype: str) -> dict:
    """模拟：生成地点简短介绍（按地点散列选句式，避免雷同）"""
    return {"text": intro_fallback(name, ptype)}


# ---------- 路由 ----------

@app.post("/api/parse_pref")
@limiter.limit("10/minute")
def parse_pref(request: Request, req: ParsePrefRequest):
    if MOCK_MODE:
        return mock_parse_pref(req.user_text, req.minutes)
    return ai_parse_pref(req.user_text, req.minutes)


@app.post("/api/get_reason")
@limiter.limit("10/minute")
def get_reason(request: Request, req: GetReasonRequest):
    if MOCK_MODE:
        return mock_get_reason(req.pois, req.weather, req.minutes)
    return ai_get_reason(req.pois, req.weather, req.minutes)


@app.post("/api/get_intro")
@limiter.limit("10/minute")
def get_intro(request: Request, req: GetIntroRequest):
    if MOCK_MODE:
        return mock_get_intro(req.name, req.type)
    return ai_get_intro(req.name, req.type)


@app.get("/api/status")
def root():
    return {
        "service": "偏航后端",
        "mode": "Mock(无密钥)" if MOCK_MODE else f"Real({LLM_MODEL})",
        "endpoints": [
            "POST /api/parse_pref",
            "POST /api/get_reason",
            "POST /api/get_intro",
            "GET /api/ip",
            "GET /api/amap/regeo",
            "GET /api/auth/me",
            "POST /api/auth/register",
            "POST /api/auth/login",
            "POST /api/auth/logout",
            "PATCH /api/auth/profile",
            "POST /api/detours",
            "GET /api/detours",
            "GET /api/favorites",
            "POST /api/favorites",
            "DELETE /api/favorites/{id}",
        ]
    }


@app.get("/api/ip")
@limiter.limit("30/minute")
def ip_locate(request: Request):
    """IP 定位代理：优先使用真实客户端 IP（从代理头或 request.client），
    失败时回退公开 ip-api.com。部署在反向代理后时，确保代理传递了 X-Forwarded-For。"""
    import urllib.request
    import urllib.error

    # 真实客户端 IP 处理（支持七牛云等反向代理）
    client_ip = None
    xf_for = request.headers.get("x-forwarded-for")
    if xf_for:
        client_ip = xf_for.split(",")[0].strip()
    if not client_ip:
        xf_real = request.headers.get("x-real-ip")
        if xf_real:
            client_ip = xf_real.strip()
    if not client_ip and request.client:
        client_ip = request.client.host

    # 尝试用后端 ip-api.com 走客户端 IP（需要后端能访问 ip-api）；失败用通用兜底
    if client_ip:
        url = f"http://ip-api.com/json/{client_ip}?lang=zh-CN&fields=status,lat,lon,city"
    else:
        url = "http://ip-api.com/json/?lang=zh-CN&fields=status,lat,lon,city"

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "pianhang/1.0"})
        with urllib.request.urlopen(req, timeout=6) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if data.get("status") == "success":
                return {"lat": data.get("lat"), "lon": data.get("lon"), "city": data.get("city", ""),
                        "ip_source": "x-forwarded-for" if xf_for else ("x-real-ip" if request.headers.get("x-real-ip") else ("request.client" if client_ip else "generic"))}
    except Exception as e:
        return {"error": str(e)}
    return {"error": "定位失败"}


# ---------- 高德逆地理编码代理 ----------
# 高德网页端逆地理编码无需 key、国内可直连；浏览器端有跨域限制，因此由后端代理。
# 结果做 30 分钟内存缓存：同一地点重复生成路线时立即返回，也降低被上游限流的概率。
_AMAP_CACHE: dict = {}
_AMAP_CACHE_TTL = 30 * 60
_AMAP_CACHE_MAX = 600


def _amap_num(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


class _IPv4HTTPSConnection(http.client.HTTPSConnection):
    """强制走 IPv4 的 HTTPS 连接。

    ditu.amap.com 同时解析出 IPv6/IPv4；当前网络下 IPv6 不可达，
    urllib 会先卡在 IPv6 上几十秒。这里只取 A 记录，并保留 SNI 正常校验证书。
    """

    def connect(self):
        last_error = None
        for family, socktype, proto, _canonname, sockaddr in socket.getaddrinfo(
            self.host, self.port, socket.AF_INET, socket.SOCK_STREAM
        ):
            sock = socket.socket(family, socktype, proto)
            try:
                sock.settimeout(self.timeout)
                sock.connect(sockaddr)
                self.sock = self._context.wrap_socket(sock, server_hostname=self.host)
                return
            except Exception as exc:
                last_error = exc
                try:
                    sock.close()
                except Exception:
                    pass
        raise last_error or OSError("无法建立 IPv4 连接")


def _ipv4_get_json(host: str, path: str, timeout: float = 5.0, referer: str = "") -> dict:
    """通过 IPv4 发起 HTTPS GET 并解析 JSON。"""
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
        ),
        "Accept": "application/json, text/plain, */*",
    }
    if referer:
        headers["Referer"] = referer
    conn = _IPv4HTTPSConnection(host, 443, timeout=timeout)
    try:
        conn.request("GET", path, headers=headers)
        resp = conn.getresponse()
        raw = resp.read().decode("utf-8", "replace")
        return json.loads(raw)
    finally:
        try:
            conn.close()
        except Exception:
            pass


def _fetch_amap_regeo(lat: float, lng: float) -> dict:
    """同步请求高德网页端逆地理编码并整理成前端需要的结构。"""
    path = f"/service/regeo?longitude={lng:.6f}&latitude={lat:.6f}"
    try:
        data = _ipv4_get_json("ditu.amap.com", path, timeout=5.0, referer="https://ditu.amap.com/")
    except Exception:
        raise HTTPException(status_code=502, detail="高德逆地理编码暂时不可用")

    body = data.get("data") if isinstance(data, dict) else None
    if not isinstance(body, dict) or str(data.get("status")) != "1":
        raise HTTPException(status_code=502, detail="高德逆地理编码返回异常")

    def _points(items):
        points = []
        for item in items or []:
            if not isinstance(item, dict):
                continue
            name = (item.get("name") or "").strip()
            plat = _amap_num(item.get("latitude"))
            plng = _amap_num(item.get("longitude"))
            if not name or plat is None or plng is None:
                continue
            points.append({
                "name": name,
                "lat": plat,
                "lng": plng,
                "direction": item.get("direction") or "",
                "distance": _amap_num(item.get("distance")) or 0.0,
                "width": item.get("width") or "",
            })
        return points

    return {
        "ok": True,
        "source": "amap",
        "province": body.get("province") or "",
        "city": body.get("city") or "",
        "district": body.get("district") or "",
        "adcode": body.get("adcode") or "",
        "desc": body.get("desc") or "",
        "pos": body.get("pos") or "",
        "roads": _points(body.get("road_list")),
        "crosses": _points(body.get("cross_list")),
    }


@app.get("/api/amap/regeo")
@limiter.limit("30/minute")
async def amap_regeo(request: Request, lat: float, lng: float):
    """逆地理编码，输入为 GCJ-02（高德坐标系），返回附近道路、路口与地标描述。"""
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        raise HTTPException(status_code=400, detail="坐标超出范围")

    # 约 100 米粒度缓存：同一街区内的重复请求直接命中
    cache_key = (round(lat, 3), round(lng, 3))
    now = time.time()
    cached = _AMAP_CACHE.get(cache_key)
    if cached and now - cached[0] < _AMAP_CACHE_TTL:
        return cached[1]

    # urllib 的 timeout 只约束单次 socket 操作；这里再加一道整体硬超时，
    # 避免上游限流时把前端请求一起拖住。
    try:
        payload = await asyncio.wait_for(
            asyncio.to_thread(_fetch_amap_regeo, lat, lng), timeout=7.0
        )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="高德逆地理编码超时")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=502, detail="高德逆地理编码暂时不可用")

    if len(_AMAP_CACHE) >= _AMAP_CACHE_MAX:
        expired = [k for k, v in _AMAP_CACHE.items() if now - v[0] >= _AMAP_CACHE_TTL]
        for k in expired[:200]:
            _AMAP_CACHE.pop(k, None)
        if len(_AMAP_CACHE) >= _AMAP_CACHE_MAX:
            _AMAP_CACHE.clear()
    _AMAP_CACHE[cache_key] = (now, payload)
    return payload


# ---------- 账号与会话 ----------
# 轻量账号系统：SQLite + PBKDF2 密码哈希 + HttpOnly 会话 Cookie。
# 游客仍可直接使用全部探索功能，登录只用于保存个人资料与后续同步数据。
DB_PATH = Path(os.environ.get("PIANHANG_DB", str(Path(__file__).resolve().parent / "pianhang.db")))
SESSION_COOKIE = "ph_session"
SESSION_DAYS = 30
PBKDF2_ITERATIONS = 240_000
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", _COOKIE_SECURE_DEFAULT).lower() in ("1", "true", "yes")
ENABLE_DEMO_ACCOUNT = os.environ.get("ENABLE_DEMO_ACCOUNT", _DEMO_DEFAULT).lower() in ("1", "true", "yes")
USERNAME_RE = re.compile(r"^[A-Za-z0-9_一-龥]{3,24}$")

# 偏好设置：与前端 js/prefs.js 的白名单保持一致
PREF_MODES = ("walk", "bike", "ebike")
PREF_PACES = ("slow", "steady", "far")
PREF_INTERESTS = ("公园", "咖啡店", "书店", "博物馆", "广场", "景点")
DEFAULT_PREFERENCES = {"default_mode": "walk", "pace": "steady", "interests": []}


def _normalize_preferences(data) -> dict:
    """把任意来源（数据库 / 请求）的偏好收敛到安全、可预期的值。"""
    if not isinstance(data, dict):
        data = {}
    mode = data.get("default_mode")
    pace = data.get("pace")
    interests = data.get("interests")
    cleaned = []
    if isinstance(interests, (list, tuple)):
        for item in interests:
            text = str(item or "").strip()
            if text in PREF_INTERESTS and text not in cleaned:
                cleaned.append(text)
    return {
        "default_mode": mode if mode in PREF_MODES else DEFAULT_PREFERENCES["default_mode"],
        "pace": pace if pace in PREF_PACES else DEFAULT_PREFERENCES["pace"],
        "interests": cleaned[: len(PREF_INTERESTS)],
    }


def _preferences_from_row(row) -> dict:
    raw = ""
    try:
        raw = row["preferences"] or ""
    except (KeyError, IndexError, TypeError):
        raw = ""
    if not raw:
        return dict(DEFAULT_PREFERENCES)
    try:
        return _normalize_preferences(json.loads(raw))
    except (TypeError, ValueError):
        return dict(DEFAULT_PREFERENCES)


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iterations, salt_hex, digest_hex = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(iterations)
        )
        return hmac.compare_digest(digest.hex(), digest_hex)
    except Exception:
        return False


def _db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), timeout=8)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with closing(_db()) as conn, conn:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
                nickname      TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                city          TEXT NOT NULL DEFAULT '',
                bio           TEXT NOT NULL DEFAULT '',
                preferences   TEXT NOT NULL DEFAULT '',
                created_at    TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id    INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
            CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
            CREATE TABLE IF NOT EXISTS detours (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id     INTEGER NOT NULL,
                distance_km REAL NOT NULL DEFAULT 0,
                created_at  TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS favorites (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    INTEGER NOT NULL,
                place_key  TEXT NOT NULL,
                name       TEXT NOT NULL DEFAULT '',
                type       TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                UNIQUE (user_id, place_key),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            """
        )
        # 老库补齐账号偏好字段
        user_cols = {row["name"] for row in conn.execute("PRAGMA table_info(users)")}
        if "preferences" not in user_cols:
            conn.execute("ALTER TABLE users ADD COLUMN preferences TEXT NOT NULL DEFAULT ''")
        # 老库补齐偏航记录字段（SQLite 不支持 ADD COLUMN IF NOT EXISTS）
        detour_cols = {row["name"] for row in conn.execute("PRAGMA table_info(detours)")}
        for name, ddl in (
            ("mode", "TEXT NOT NULL DEFAULT ''"),
            ("minutes", "INTEGER NOT NULL DEFAULT 0"),
            ("start_name", "TEXT NOT NULL DEFAULT ''"),
            ("end_name", "TEXT NOT NULL DEFAULT ''"),
            ("start_lat", "REAL NOT NULL DEFAULT 0"),
            ("start_lng", "REAL NOT NULL DEFAULT 0"),
            ("end_lat", "REAL NOT NULL DEFAULT 0"),
            ("end_lng", "REAL NOT NULL DEFAULT 0"),
            ("waypoints", "TEXT NOT NULL DEFAULT ''"),
            ("path", "TEXT NOT NULL DEFAULT ''"),
            ("weather", "TEXT NOT NULL DEFAULT ''"),
        ):
            if name not in detour_cols:
                conn.execute(f"ALTER TABLE detours ADD COLUMN {name} {ddl}")
        fav_cols = {row["name"] for row in conn.execute("PRAGMA table_info(favorites)")}
        for name, ddl in (
            ("lat", "REAL NOT NULL DEFAULT 0"),
            ("lng", "REAL NOT NULL DEFAULT 0"),
        ):
            if name not in fav_cols:
                conn.execute(f"ALTER TABLE favorites ADD COLUMN {name} {ddl}")
        # 演示账号：方便本地评审体验；生产环境默认关闭（由 ENABLE_DEMO_ACCOUNT 控制）
        if ENABLE_DEMO_ACCOUNT:
            demo = conn.execute("SELECT id FROM users WHERE username = ?", ("demo",)).fetchone()
            if demo is None:
                conn.execute(
                    "INSERT INTO users (username, nickname, password_hash, city, bio, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (
                        "demo",
                        "偏航演示",
                        hash_password("pianhang"),
                        "上海",
                        "喜欢没有目的地的傍晚。",
                        datetime.now(timezone.utc).isoformat(),
                    ),
                )


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_session(user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    expires = now + timedelta(days=SESSION_DAYS)
    with closing(_db()) as conn, conn:
        conn.execute("DELETE FROM sessions WHERE expires_at <= ?", (now.isoformat(),))
        conn.execute(
            "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
            (_hash_token(token), user_id, now.isoformat(), expires.isoformat()),
        )
    return token


def session_user(request: Request):
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    with closing(_db()) as conn:
        return conn.execute(
            "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id "
            "WHERE s.token_hash = ? AND s.expires_at > ?",
            (_hash_token(token), datetime.now(timezone.utc).isoformat()),
        ).fetchone()


def _get_user(user_id: int):
    with closing(_db()) as conn:
        return conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=SESSION_DAYS * 24 * 3600,
        httponly=True,
        samesite="lax",
        secure=COOKIE_SECURE,
        path="/",
    )


def _user_payload(row) -> dict:
    raw_preferences = ""
    try:
        raw_preferences = row["preferences"] or ""
    except (KeyError, IndexError, TypeError):
        raw_preferences = ""
    return {
        "username": row["username"],
        "nickname": row["nickname"],
        "city": row["city"],
        "bio": row["bio"],
        "preferences": _preferences_from_row(row),
        "preferences_set": bool(raw_preferences),
        "created_at": row["created_at"],
    }


def _local_hour(iso: str) -> Optional[int]:
    """把 UTC 时间转成偏航所在的东八区小时，用于夜航徽章判定。"""
    try:
        dt = datetime.fromisoformat((iso or "").replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone(timedelta(hours=8))).hour


def _badge_state(rows) -> dict:
    """徽章只依据真实偏航记录计算，成就页与个人中心共用同一份结果。"""
    count = len(rows)
    km = 0.0
    places = set()
    rain = False
    night = False

    for row in rows:
        try:
            km += float(row["distance_km"] or 0)
        except (TypeError, ValueError):
            pass
        if re.search(r"[雨雪]", row["weather"] or ""):
            rain = True
        hour = _local_hour(row["created_at"])
        if hour is not None and (hour >= 19 or hour < 5):
            night = True
        try:
            waypoints = json.loads(row["waypoints"] or "[]")
        except (TypeError, ValueError):
            waypoints = []
        if not isinstance(waypoints, list):
            continue
        for point in waypoints:
            name = point.get("name") if isinstance(point, dict) else None
            if name:
                places.add(name)

    progress = {
        "first": {"current": min(count, 1), "target": 1, "unit": "次"},
        "coffee": {"current": min(count, 3), "target": 3, "unit": "次"},
        "rain": {"current": 1 if rain else 0, "target": 1, "unit": "次"},
        "alleys": {"current": min(len(places), 5), "target": 5, "unit": "个地点"},
        "night": {"current": 1 if night else 0, "target": 1, "unit": "次"},
        "city": {"current": round(km, 1), "target": 20, "unit": "km"},
    }
    keys = [key for key, item in progress.items() if item["current"] >= item["target"]]
    return {
        "keys": keys,
        "count": len(keys),
        "progress": progress,
        "places": len(places),
        "distance_km": km,
        "detours": count,
    }


def _user_stats(user_id: int) -> dict:
    with closing(_db()) as conn:
        rows = conn.execute(
            "SELECT distance_km, created_at, weather, waypoints FROM detours WHERE user_id = ?",
            (user_id,),
        ).fetchall()
        favorite = conn.execute(
            "SELECT COUNT(*) AS total FROM favorites WHERE user_id = ?", (user_id,)
        ).fetchone()
    badges = _badge_state(rows)
    return {
        "detours": badges["detours"],
        "distance_km": round(badges["distance_km"], 1),
        "places": badges["places"],
        "favorites": int(favorite["total"]) if favorite else 0,
        "badges": badges["count"],
        "badge_keys": badges["keys"],
        "badge_progress": badges["progress"],
    }


def _auth_payload(row) -> dict:
    return {
        "authenticated": True,
        "user": _user_payload(row),
        "stats": _user_stats(row["id"]),
    }


def _clean_text(value: Optional[str], max_len: int, fallback: str = "") -> str:
    text = (value or "").strip()
    return text[:max_len] if text else fallback


class RegisterRequest(BaseModel):
    username: str = ""
    password: str = ""
    nickname: str = ""


class LoginRequest(BaseModel):
    username: str = ""
    password: str = ""


class DetourRequest(BaseModel):
    distance_km: float = 0
    minutes: int = 0
    mode: str = "walk"
    start_name: str = ""
    end_name: str = ""
    weather: str = ""
    start_lat: float = 0
    start_lng: float = 0
    end_lat: float = 0
    end_lng: float = 0
    waypoints: List[PoiItem] = []
    # OSRM 路线几何，[lng, lat] 数组；用于偏航记录回放
    path: List[List[float]] = []


class FavoriteRequest(BaseModel):
    name: str = ""
    type: str = ""
    lat: float = 0
    lng: float = 0


class ProfileUpdateRequest(BaseModel):
    nickname: Optional[str] = None
    city: Optional[str] = None
    bio: Optional[str] = None


class PreferencesUpdateRequest(BaseModel):
    default_mode: str = "walk"
    pace: str = "steady"
    interests: List[str] = []


def _validate_credentials(username: str, password: str) -> None:
    if not USERNAME_RE.match(username):
        raise HTTPException(status_code=400, detail="用户名需为 3–24 位中文、字母、数字或下划线")
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="密码至少 6 位")
    if len(password) > 64:
        raise HTTPException(status_code=400, detail="密码不能超过 64 位")


@app.get("/api/auth/me")
def auth_me(request: Request):
    row = session_user(request)
    if row is None:
        return {"authenticated": False}
    return _auth_payload(row)


@app.post("/api/auth/register")
@limiter.limit("5/minute")
def auth_register(request: Request, req: RegisterRequest, response: Response):
    username = req.username.strip()
    _validate_credentials(username, req.password)
    nickname = _clean_text(req.nickname, 20, username)
    created_at = datetime.now(timezone.utc).isoformat()
    try:
        with closing(_db()) as conn, conn:
            cursor = conn.execute(
                "INSERT INTO users (username, nickname, password_hash, city, bio, created_at) "
                "VALUES (?, ?, ?, '', '', ?)",
                (username, nickname, hash_password(req.password), created_at),
            )
            user_id = int(cursor.lastrowid)
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="这个用户名已经被用过了")
    token = create_session(user_id)
    _set_session_cookie(response, token)
    return _auth_payload(_get_user(user_id))


@app.post("/api/auth/login")
@limiter.limit("5/minute")
def auth_login(request: Request, req: LoginRequest, response: Response):
    username = req.username.strip()
    with closing(_db()) as conn:
        row = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    if row is None or not verify_password(req.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="用户名或密码不对")
    token = create_session(row["id"])
    _set_session_cookie(response, token)
    return _auth_payload(row)


@app.post("/api/auth/logout")
def auth_logout(request: Request, response: Response):
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        with closing(_db()) as conn, conn:
            conn.execute("DELETE FROM sessions WHERE token_hash = ?", (_hash_token(token),))
    response.delete_cookie(
        SESSION_COOKIE, path="/", httponly=True, samesite="lax", secure=COOKIE_SECURE
    )
    return {"ok": True}


@app.patch("/api/auth/profile")
def auth_update_profile(req: ProfileUpdateRequest, request: Request):
    row = session_user(request)
    if row is None:
        raise HTTPException(status_code=401, detail="请先登录")
    updates = {}
    if req.nickname is not None:
        nickname = _clean_text(req.nickname, 20)
        if not nickname:
            raise HTTPException(status_code=400, detail="昵称不能为空")
        updates["nickname"] = nickname
    if req.city is not None:
        updates["city"] = _clean_text(req.city, 30)
    if req.bio is not None:
        updates["bio"] = _clean_text(req.bio, 80)
    if updates:
        assignments = ", ".join(f"{key} = ?" for key in updates)
        with closing(_db()) as conn, conn:
            conn.execute(
                f"UPDATE users SET {assignments} WHERE id = ?",
                (*updates.values(), row["id"]),
            )
    return {"ok": True, "user": _user_payload(_get_user(row["id"]))}


@app.put("/api/auth/preferences")
def auth_update_preferences(req: PreferencesUpdateRequest, request: Request):
    row = session_user(request)
    if row is None:
        raise HTTPException(status_code=401, detail="请先登录")
    preferences = _normalize_preferences(
        {"default_mode": req.default_mode, "pace": req.pace, "interests": req.interests}
    )
    with closing(_db()) as conn, conn:
        conn.execute(
            "UPDATE users SET preferences = ? WHERE id = ?",
            (json.dumps(preferences, ensure_ascii=False, separators=(",", ":")), row["id"]),
        )
    return {
        "ok": True,
        "preferences": preferences,
        "preferences_set": True,
        "user": _user_payload(_get_user(row["id"])),
    }


def _safe_coord(value) -> float:
    try:
        number = float(value or 0)
    except (TypeError, ValueError):
        return 0.0
    return number if math.isfinite(number) else 0.0


def _clean_path(points, max_points: int = 900) -> list:
    """校验并压缩 OSRM 轨迹，既能回放又不会把数据库撑大。"""
    coords = []
    for pair in points or []:
        if not isinstance(pair, (list, tuple)) or len(pair) < 2:
            continue
        try:
            lng = float(pair[0])
            lat = float(pair[1])
        except (TypeError, ValueError):
            continue
        if not (math.isfinite(lat) and math.isfinite(lng)):
            continue
        if not (-90 <= lat <= 90 and -180 <= lng <= 180):
            continue
        coords.append([round(lng, 5), round(lat, 5)])
    if len(coords) > max_points:
        step = math.ceil(len(coords) / max_points)
        last = coords[-1]
        coords = coords[::step]
        if coords[-1] != last:
            coords.append(last)
    return coords


def _detour_payload(row) -> dict:
    try:
        waypoints = json.loads(row["waypoints"] or "[]")
    except (TypeError, ValueError):
        waypoints = []
    try:
        path = json.loads(row["path"] or "[]")
    except (TypeError, ValueError):
        path = []
    return {
        "id": row["id"],
        "distance_km": round(float(row["distance_km"] or 0), 2),
        "minutes": int(row["minutes"] or 0),
        "mode": row["mode"] or "walk",
        "start_name": row["start_name"] or "当前位置",
        "end_name": row["end_name"] or "",
        "start_lat": _safe_coord(row["start_lat"]),
        "start_lng": _safe_coord(row["start_lng"]),
        "end_lat": _safe_coord(row["end_lat"]),
        "end_lng": _safe_coord(row["end_lng"]),
        "weather": row["weather"] or "",
        "waypoints": waypoints if isinstance(waypoints, list) else [],
        "path": path if isinstance(path, list) else [],
        "created_at": row["created_at"],
    }


@app.post("/api/detours")
def create_detour(req: DetourRequest, request: Request):
    row = session_user(request)
    if row is None:
        raise HTTPException(status_code=401, detail="请先登录")
    distance = max(0.0, min(float(req.distance_km or 0), 200.0))
    minutes = max(0, min(int(req.minutes or 0), 300))
    mode = _clean_text(req.mode, 12, "walk")
    start_name = _clean_text(req.start_name, 40, "当前位置")
    end_name = _clean_text(req.end_name, 40)
    weather = _clean_text(req.weather, 30)
    start_lat = _safe_coord(req.start_lat)
    start_lng = _safe_coord(req.start_lng)
    end_lat = _safe_coord(req.end_lat)
    end_lng = _safe_coord(req.end_lng)
    waypoints = []
    for item in (req.waypoints or [])[:8]:
        name = _clean_text(item.name, 40)
        if not name:
            continue
        waypoints.append({
            "name": name,
            "type": _clean_text(item.type, 10),
            "lat": round(_safe_coord(item.lat), 6),
            "lng": round(_safe_coord(item.lng), 6),
        })
    path = _clean_path(req.path)
    created_at = datetime.now(timezone.utc).isoformat()
    with closing(_db()) as conn, conn:
        cursor = conn.execute(
            "INSERT INTO detours "
            "(user_id, distance_km, created_at, mode, minutes, start_name, end_name, "
            "start_lat, start_lng, end_lat, end_lng, waypoints, path, weather) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                row["id"], distance, created_at, mode, minutes,
                start_name, end_name, start_lat, start_lng, end_lat, end_lng,
                json.dumps(waypoints, ensure_ascii=False), json.dumps(path, ensure_ascii=False),
                weather,
            ),
        )
        detour_id = int(cursor.lastrowid)
        saved = conn.execute("SELECT * FROM detours WHERE id = ?", (detour_id,)).fetchone()
    return {
        "ok": True,
        "detour": _detour_payload(saved),
        "stats": _user_stats(row["id"]),
    }


@app.get("/api/detours")
def list_detours(request: Request, limit: int = 20):
    row = session_user(request)
    if row is None:
        raise HTTPException(status_code=401, detail="请先登录")
    limit = max(1, min(int(limit or 20), 50))
    with closing(_db()) as conn:
        rows = conn.execute(
            "SELECT * FROM detours WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
            (row["id"], limit),
        ).fetchall()
    return {
        "ok": True,
        "detours": [_detour_payload(item) for item in rows],
        "stats": _user_stats(row["id"]),
    }


def _favorite_payload(row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"] or "",
        "type": row["type"] or "",
        "lat": float(row["lat"] or 0),
        "lng": float(row["lng"] or 0),
        "created_at": row["created_at"],
    }


def _favorite_list(conn, user_id: int) -> list:
    rows = conn.execute(
        "SELECT * FROM favorites WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 60",
        (user_id,),
    ).fetchall()
    return [_favorite_payload(item) for item in rows]


@app.get("/api/favorites")
def list_favorites(request: Request):
    row = session_user(request)
    if row is None:
        raise HTTPException(status_code=401, detail="请先登录")
    with closing(_db()) as conn:
        favorites = _favorite_list(conn, row["id"])
    return {"ok": True, "favorites": favorites, "stats": _user_stats(row["id"])}


@app.post("/api/favorites")
def create_favorite(req: FavoriteRequest, request: Request):
    row = session_user(request)
    if row is None:
        raise HTTPException(status_code=401, detail="请先登录")
    name = _clean_text(req.name, 60)
    if not name:
        raise HTTPException(status_code=400, detail="地点名称不能为空")
    ftype = _clean_text(req.type, 12)
    lat = max(-90.0, min(float(req.lat or 0), 90.0))
    lng = max(-180.0, min(float(req.lng or 0), 180.0))
    place_key = f"{name.lower()}|{lat:.5f}|{lng:.5f}|{ftype}"
    created_at = datetime.now(timezone.utc).isoformat()
    with closing(_db()) as conn, conn:
        conn.execute(
            "INSERT OR IGNORE INTO favorites "
            "(user_id, place_key, name, type, lat, lng, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (row["id"], place_key, name, ftype, lat, lng, created_at),
        )
        saved_row = conn.execute(
            "SELECT * FROM favorites WHERE user_id = ? AND place_key = ?",
            (row["id"], place_key),
        ).fetchone()
        favorites = _favorite_list(conn, row["id"])
    saved = _favorite_payload(saved_row) if saved_row else None
    return {"ok": True, "favorite": saved, "favorites": favorites, "stats": _user_stats(row["id"])}


@app.delete("/api/favorites/{favorite_id}")
def delete_favorite(favorite_id: int, request: Request):
    row = session_user(request)
    if row is None:
        raise HTTPException(status_code=401, detail="请先登录")
    with closing(_db()) as conn, conn:
        conn.execute(
            "DELETE FROM favorites WHERE id = ? AND user_id = ?", (favorite_id, row["id"])
        )
        favorites = _favorite_list(conn, row["id"])
    return {"ok": True, "favorites": favorites, "stats": _user_stats(row["id"])}


@app.delete("/api/detours/{detour_id}")
def delete_detour(detour_id: int, request: Request):
    """删除一条偏航记录；仅记录创建者可删。"""
    row = session_user(request)
    if row is None:
        raise HTTPException(status_code=401, detail="请先登录")
    with closing(_db()) as conn, conn:
        cur = conn.execute(
            "DELETE FROM detours WHERE id = ? AND user_id = ?", (detour_id, row["id"])
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="这条偏航记录不存在")
        conn.commit()
    with closing(_db()) as conn:
        detours = conn.execute(
            "SELECT * FROM detours WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 20",
            (row["id"],),
        ).fetchall()
    return {
        "ok": True,
        "detours": [_detour_payload(item) for item in detours],
        "stats": _user_stats(row["id"]),
    }


@app.delete("/api/auth/me")
def delete_account(request: Request, response: Response):
    """永久删除当前登录账号及其全部关联数据（偏航、收藏、会话）。"""
    row = session_user(request)
    if row is None:
        raise HTTPException(status_code=401, detail="请先登录")
    with closing(_db()) as conn, conn:
        conn.execute("DELETE FROM favorites WHERE user_id = ?", (row["id"],))
        conn.execute("DELETE FROM detours WHERE user_id = ?", (row["id"],))
        conn.execute("DELETE FROM sessions WHERE user_id = ?", (row["id"],))
        conn.execute("DELETE FROM users WHERE id = ?", (row["id"],))
    response.delete_cookie(
        SESSION_COOKIE, path="/", httponly=True, samesite="lax", secure=COOKIE_SECURE
    )
    return {"ok": True}


@app.get("/api/healthz")
def healthz():
    """轻量健康检查：用于平台探针。"""
    try:
        with closing(_db()) as conn:
            conn.execute("SELECT 1")
        db_ok = True
    except Exception:
        db_ok = False
    return {
        "ok": db_ok,
        "version": app.version,
        "mode": "Mock" if MOCK_MODE else f"Real({LLM_MODEL})",
        "environment": ENVIRONMENT,
    }


init_db()


# ---------- 静态前端（同源部署） ----------
# 一条隧道同时服务页面与 AI 接口，前端请求 /api/* 与页面同源，无需跨域。
# 挂载在 API 路由之后，未匹配的路径由静态文件兜底（含默认首页 index.html）。
from fastapi.staticfiles import StaticFiles

_DIST_DIR = Path(__file__).resolve().parent.parent / "dist"
if _DIST_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(_DIST_DIR), html=True), name="static")
