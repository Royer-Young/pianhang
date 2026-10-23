#!/usr/bin/env bash
# Pianhang - one-click start for Linux / macOS
# Same-origin single service: builds the frontend (if Node exists)
# then runs FastAPI serving both pages and /api.
set -euo pipefail
cd "$(dirname "$0")"

# --- 0. python check ---
# Pick the first candidate that actually runs (skips broken launchers such as
# the Windows Store "python3" stub, which exists on PATH but does nothing).
PY=""
for cand in python3 python; do
  if command -v "$cand" >/dev/null 2>&1; then
    if "$cand" -c "import sys" >/dev/null 2>&1; then
      PY="$cand"
      break
    fi
  fi
done
if [ -z "$PY" ]; then
  echo "[ERROR] Python 3.9+ not found or not working. Install it and add it to PATH."
  exit 1
fi

# --- 1. build frontend (same-origin) when possible ---
if command -v node >/dev/null 2>&1; then
  echo "[1/3] Building frontend (same-origin) ..."
  VITE_API_BASE_URL=SAME_ORIGIN node scripts/build.js
elif [ -f "dist/index.html" ]; then
  echo "[1/3] Node.js not found - reusing existing dist/"
else
  echo "[ERROR] No Node.js and no prebuilt dist/."
  echo "        Install Node.js 16+, or run once:  node scripts/build.js"
  exit 1
fi

# --- 2. reuse a running service or pick a free port ---
# :8000 is frequently taken by other local software, so never assume it.
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
  echo "[2/3] Reusing the running service on port $PORT."
  echo "[3/3] Open  http://localhost:$PORT"
  exit 0
fi
if ! PORT="$("$PY" scripts/server_port.py free 8000 8099)"; then
  echo "[ERROR] No free port found between 8000 and 8099."
  exit 1
fi
printf '%s\n' "$PORT" > .pianhang-port
if [ "$PORT" != "8000" ]; then
  echo "[INFO] Port 8000 is busy - using port $PORT instead."
fi

# --- 3. start the single service ---
echo "[2/3] Starting service on 0.0.0.0:$PORT  (Ctrl+C to stop) ..."
echo "[3/3] Open  http://localhost:$PORT"
cd backend
exec "$PY" -m uvicorn main:app --host 0.0.0.0 --port "$PORT"
