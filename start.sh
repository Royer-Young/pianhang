#!/usr/bin/env bash
# Pianhang - one-click start for Linux / macOS
# Same-origin single service: builds the frontend (if Node exists)
# then runs FastAPI on 0.0.0.0:8000 serving both pages and /api.
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

# --- 2. start the single service ---
echo "[2/3] Starting service on 0.0.0.0:8000  (Ctrl+C to stop) ..."
echo "[3/3] Open  http://localhost:8000"
cd backend
exec "$PY" -m uvicorn main:app --host 0.0.0.0 --port 8000
