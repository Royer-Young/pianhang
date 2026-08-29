# -*- coding: utf-8 -*-
"""偏航后端服务（步骤7 · 真实大模型模式 · FastAPI）

密钥仅保管在后端，通过 .env 配置，绝不下发前端。
"""
import json
import os
import re
from pathlib import Path
from typing import List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
from pydantic import BaseModel

# 加载 backend/.env（密钥仅在此处配置，不下发前端）
_env_path = Path(__file__).parent / ".env"
load_dotenv(_env_path)

LLM_API_KEY = os.environ.get("LLM_API_KEY", "")
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "https://api.openai-next.com/v1")
LLM_MODEL = os.environ.get("LLM_MODEL", "gpt-4o-mini")

MOCK_MODE = not LLM_API_KEY  # 无密钥时自动回退 Mock 模式

if not MOCK_MODE:
    llm_client = OpenAI(api_key=LLM_API_KEY, base_url=LLM_BASE_URL)

app = FastAPI(title="偏航后端", version="0.2.0")

# 跨域：允许前端域名访问（从环境变量读取，逗号分隔；默认本地开发地址）
CORS_ORIGINS = os.environ.get("CORS_ORIGINS", "http://localhost:8000,http://127.0.0.1:8000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["POST", "OPTIONS", "GET"],
    allow_headers=["Content-Type"],
)


# ---------- 请求模型 ----------
class ParsePrefRequest(BaseModel):
    user_text: str = ""
    minutes: Optional[int] = None


class PoiItem(BaseModel):
    name: str = ""
    type: str = ""


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


def call_llm(system_prompt: str, user_prompt: str, json_mode: bool = True) -> str:
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
        "temperature": 0.7,
    }
    resp = llm_client.chat.completions.create(**kwargs)
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


def ai_get_intro(name: str, ptype: str) -> dict:
    """生成地点简短介绍"""
    system_prompt = (
        "你是偏航App的地点介绍助手。根据地点名称和类型，生成一段简短的介绍文字（50字以内）。"
        "只描述地点本身的氛围和适合偏航的理由，不要编造历史、评分、创始人等无法从名称推断的事实。"
    )
    user_prompt = f"地点名称：{name}，类型：{ptype or '地点'}。请生成介绍。"
    try:
        text = call_llm(system_prompt, user_prompt, json_mode=False)
        return {"text": text.strip()}
    except Exception as e:
        err_msg = str(e)
        print(f"[WARN] LLM生成介绍失败，使用模板: {err_msg}")
        return {"text": f"{name}是一处{ptype or '地点'}，适合在偏航途中稍作停留、慢慢感受周边氛围。", "llm_error": err_msg}


# ---------- Mock 实现（无密钥时自动回退） ----------

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
    """模拟：生成地点简短介绍"""
    templates = [
        f"{name}是一处{ptype or '地点'}，适合在偏航途中稍作停留、慢慢感受周边氛围。",
        f"这里是{name}（{ptype or '地点'}），漫步至此不妨放慢脚步、留意周围细节。",
        f"{name}，属于{ptype or '地点'}类别，是这次偏航探索的一处停靠点。",
    ]
    idx = hash((name, ptype)) % len(templates)
    return {"text": templates[idx]}


# ---------- 路由 ----------

@app.post("/api/parse_pref")
def parse_pref(req: ParsePrefRequest):
    if MOCK_MODE:
        return mock_parse_pref(req.user_text, req.minutes)
    return ai_parse_pref(req.user_text, req.minutes)


@app.post("/api/get_reason")
def get_reason(req: GetReasonRequest):
    if MOCK_MODE:
        return mock_get_reason(req.pois, req.weather, req.minutes)
    return ai_get_reason(req.pois, req.weather, req.minutes)


@app.post("/api/get_intro")
def get_intro(req: GetIntroRequest):
    if MOCK_MODE:
        return mock_get_intro(req.name, req.type)
    return ai_get_intro(req.name, req.type)


@app.get("/")
def root():
    return {
        "service": "偏航后端",
        "mode": "Mock(无密钥)" if MOCK_MODE else f"Real({LLM_MODEL})",
        "endpoints": ["POST /api/parse_pref", "POST /api/get_reason", "POST /api/get_intro"]
    }
