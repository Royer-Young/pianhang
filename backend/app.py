# -*- coding: utf-8 -*-
"""偏航后端服务（步骤7 · Mock 模式）
开发阶段：全部 Mock 模拟返回，不调用真实大模型 API。
真实接入时：在此读取环境变量中的大模型密钥（密钥保管在后端，不下发前端）。
例如:
    import os
    LLM_API_KEY = os.environ.get("LLM_API_KEY")   # 真实密钥仅在 backend 读取
    # 调用真实大模型替换下方 Mock 实现
"""
import json
from http.server import BaseHTTPRequestHandler, HTTPServer

# 开发阶段标志：True=纯Mock，不调用任何真实大模型
MOCK_MODE = True
HOST, PORT = "127.0.0.1", 5000


# ---------- Mock 实现（模拟三件AI能力，不编造地点事实） ----------

def mock_parse_pref(text, minutes=None):
    """模拟：解析用户自由文本 → 结构化参数
    时长优先取前端传入(来自用户点选的时间按钮)，确保解析结果与实际选择一致。
    """
    t = (text or "").strip()
    # 时长：优先用前端传入的(来自时间按钮)，否则从文本粗解析
    if minutes:
        time_level = minutes
    else:
        time_level = 60
        for k, v in (("90", 90), ("60", 60), ("30", 30), ("半小时", 30), ("一小时", 60), ("一个半小时", 90)):
            if k in t:
                time_level = v
                break
    # 步行强度
    walk_intensity = "medium"
    if any(w in t for w in ("快", "赶", "急", "效率")):
        walk_intensity = "fast"
    elif any(w in t for w in ("慢", "悠闲", "闲逛", "散步", "漫步")):
        walk_intensity = "slow"
    # 新奇度
    novelty = "medium"
    if any(w in t for w in ("小众", "冷门", "新奇", "人少", "安静")):
        novelty = "high"
    elif any(w in t for w in ("热门", "打卡", "著名", "网红")):
        novelty = "low"
    # 主路/小巷
    minor_level = "medium"
    if any(w in t for w in ("小巷", "弄堂", "支路", "小路", "胡同")):
        minor_level = "high"
    elif any(w in t for w in ("主路", "大道", "大街", "环线")):
        minor_level = "low"
    return {
        "time_level": time_level,
        "walk_intensity": walk_intensity,
        "novelty": novelty,
        "minor_level": minor_level,
    }


def mock_get_reason(places, weather, minutes):
    """模拟：生成路线推荐理由（基于已知地点，不编造事实）"""
    names = [p.get("name", "?") for p in (places or [])]
    head = "、".join(names) if names else "若干地点"
    w = weather or "未知天气"
    return {
        "text": (
            f"本次偏航串联 {len(names)} 处地点：{head}。"
            f"结合当前{w}与约{minutes}分钟时长，"
            f"兼顾新奇发现与步行舒适度，是一条“非最短但值得”的探索路线。"
        )
    }


def mock_get_intro(name, ptype):
    """模拟：生成地点简短介绍（通用模板，不编造任何具体历史/事实）"""
    type_cn = ptype or "地点"
    return {
        "text": (
            f"{name or '该地点'}是一处{type_cn}，"
            f"适合在偏航途中稍作停留、慢慢感受周边氛围。"
        )
    }


# ---------- HTTP 服务（stdlib，零依赖；含 CORS） ----------

class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self._cors()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            data = json.loads(raw) if raw else {}
        except Exception:
            data = {}
        path = self.path.split("?")[0]
        if path == "/api/parse_pref":
            self._json(200, mock_parse_pref(data.get("text", ""), data.get("minutes")))
        elif path == "/api/get_reason":
            self._json(200, mock_get_reason(
                data.get("places", []), data.get("weather", ""), data.get("minutes", 60)))
        elif path == "/api/get_intro":
            self._json(200, mock_get_intro(data.get("name", ""), data.get("type", "")))
        else:
            self._json(404, {"error": "not found", "path": path})

    def log_message(self, fmt, *args):
        # 开发期可注释下一行以查看请求日志
        print("[" + self.command + "] " + self.path + "  " + (fmt % args))


def main():
    mode = "Mock（不调用真实大模型）" if MOCK_MODE else "真实大模型"
    print(f"偏航后端启动: http://{HOST}:{PORT}  模式={mode}")


if __name__ == "__main__":
    main()
    HTTPServer((HOST, PORT), Handler).serve_forever()
