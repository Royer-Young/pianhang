#!/usr/bin/env bash
# 偏航 Pianhang - 一键启动（Linux / macOS / WSL / Git Bash）
# 同源单服务：先构建前端（有可用 Node 时），再用 FastAPI 同时提供页面和 /api。
set -euo pipefail
cd "$(dirname "$0")"

REQ_FILE="backend/requirements.txt"

# --- 0. 选择真正可用的 Python ---
# 只判断“命令存在”不够：WSL 里的 python3 可能没装依赖，
# 也可能存在无法执行的 Windows python.exe（exec format error）。
# 因此这里对每个候选都实际执行一次。
py_runs() {
  "$1" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' >/dev/null 2>&1
}
py_has_deps() {
  "$1" -c 'import uvicorn, fastapi, dotenv, slowapi' >/dev/null 2>&1
}

PY=""
PY_NEEDS_DEPS=""

# 1) 项目内虚拟环境优先，避免污染系统环境
for cand in \
  .venv/Scripts/python.exe .venv/bin/python \
  venv/Scripts/python.exe venv/bin/python \
  backend/.venv/Scripts/python.exe backend/.venv/bin/python; do
  [ -f "$cand" ] || continue
  py_runs "$cand" || continue
  if py_has_deps "$cand"; then PY="$cand"; break; fi
  [ -n "$PY_NEEDS_DEPS" ] || PY_NEEDS_DEPS="$cand"
done

# 2) 系统解释器（含 Git Bash 下的 Windows python.exe / py.exe）
if [ -z "$PY" ]; then
  for cand in python3 python py python.exe py.exe; do
    command -v "$cand" >/dev/null 2>&1 || continue
    py_runs "$cand" || continue
    if py_has_deps "$cand"; then PY="$cand"; break; fi
    [ -n "$PY_NEEDS_DEPS" ] || PY_NEEDS_DEPS="$cand"
  done
fi

# 3) 找到解释器但缺依赖 → 先尝试直接补装（最快，改动最小）
if [ -z "$PY" ] && [ -n "$PY_NEEDS_DEPS" ]; then
  echo "[INFO] $PY_NEEDS_DEPS 缺少后端依赖，正在执行 pip install -r $REQ_FILE ..."
  if "$PY_NEEDS_DEPS" -m pip install -r "$REQ_FILE"; then
    if py_has_deps "$PY_NEEDS_DEPS"; then PY="$PY_NEEDS_DEPS"; fi
  fi
fi

# 4) 仍不行 → 在项目内建虚拟环境后安装
if [ -z "$PY" ] && [ -n "$PY_NEEDS_DEPS" ]; then
  echo "[INFO] 正在创建 backend/.venv 并安装依赖 ..."
  if "$PY_NEEDS_DEPS" -m venv backend/.venv >/dev/null 2>&1; then
    VENV_PY="backend/.venv/bin/python"
    [ -f "$VENV_PY" ] || VENV_PY="backend/.venv/Scripts/python.exe"
    if [ -f "$VENV_PY" ] && "$VENV_PY" -m pip install -q -r "$REQ_FILE" >/dev/null 2>&1; then
      if py_has_deps "$VENV_PY"; then PY="$VENV_PY"; fi
    fi
  fi
fi

if [ -z "$PY" ]; then
  cat <<'MSG'
[ERROR] 没有找到能运行后端的 Python（需要 3.9+，且已安装后端依赖）。

请任选一种方式修复后重试：

  1) Windows（PowerShell / CMD / Git Bash）：
       pip install -r backend/requirements.txt

  2) WSL / Linux 缺少 pip 或 venv：
       sudo apt install python3-venv python3-pip
     然后重新运行： ./start.sh

  3) 如果只依赖 Windows 的 Python，请改用 Windows 终端启动，不要用 WSL。
MSG
  exit 1
fi

echo "[INFO] 使用 Python: $PY"

# --- 1. 构建前端（同源）---
# 同样实际执行一次再采用，避免选中无法运行的 node.exe。
NODE=""
for cand in node node.exe nodejs; do
  command -v "$cand" >/dev/null 2>&1 || continue
  if "$cand" --version >/dev/null 2>&1; then NODE="$cand"; break; fi
done

if [ -n "$NODE" ]; then
  echo "[1/3] 构建前端（同源） ..."
  VITE_API_BASE_URL=SAME_ORIGIN "$NODE" scripts/build.js
elif [ -f "dist/index.html" ]; then
  echo "[1/3] 未找到可用的 Node.js，复用已有 dist/"
else
  echo "[ERROR] 没有可用的 Node.js，也没有已构建的 dist/。"
  echo "        请安装 Node.js 16+，或先执行一次：node scripts/build.js"
  exit 1
fi

# --- 2. 复用已在运行的服务，或挑一个空闲端口 ---
# :8000 常被其他本地软件占用，因此从不假定它可用。
PORT=""
if [ -f ".pianhang-port" ]; then
  SAVED="$(tr -d '[:space:]' < .pianhang-port)"
  if [ -n "$SAVED" ] && "$PY" scripts/server_port.py check "$SAVED" >/dev/null 2>&1; then
    PORT="$SAVED"
  fi
fi
if [ -z "$PORT" ] && "$PY" scripts/server_port.py check 8000 >/dev/null 2>&1; then
  PORT=8000
fi
if [ -n "$PORT" ]; then
  printf '%s\n' "$PORT" > .pianhang-port
  echo "[2/3] 复用已在运行的服务，端口 $PORT。"
  echo "[3/3] 打开  http://localhost:$PORT"
  exit 0
fi
if ! PORT="$("$PY" scripts/server_port.py free 8000 8099)"; then
  echo "[ERROR] 8000-8099 之间没有空闲端口。"
  exit 1
fi
printf '%s\n' "$PORT" > .pianhang-port
if [ "$PORT" != "8000" ]; then
  echo "[INFO] 8000 被占用，改用端口 $PORT。"
fi

# --- 3. 启动单服务 ---
echo "[2/3] 启动服务 0.0.0.0:$PORT  (Ctrl+C 停止) ..."
echo "[3/3] 打开  http://localhost:$PORT"
exec "$PY" -m uvicorn backend.main:app --host 0.0.0.0 --port "$PORT"
