@echo off
rem Pianhang - Windows one-click launcher (same-origin single service)
rem NOTE: keep this file ASCII-only. Non-ASCII text breaks cmd parsing on
rem some code pages and makes the window close immediately on double-click.
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Pianhang Service

set "REQ=backend\requirements.txt"
set "PY="
set "FIXPY="

rem --- 0. pick a Python that can actually run the backend ---
for %%C in ("backend\.venv\Scripts\python.exe" ".venv\Scripts\python.exe" "venv\Scripts\python.exe") do (
    if not defined PY if exist "%%~C" (
        "%%~C" -c "import uvicorn, fastapi, dotenv, slowapi" >nul 2>nul
        if not errorlevel 1 set "PY=%%~C"
    )
)

if not defined PY (
    python -c "import uvicorn, fastapi, dotenv, slowapi" >nul 2>nul
    if not errorlevel 1 set "PY=python"
)

if not defined PY (
    py -c "import uvicorn, fastapi, dotenv, slowapi" >nul 2>nul
    if not errorlevel 1 set "PY=py"
)

if not defined PY (
    where python >nul 2>nul
    if not errorlevel 1 set "FIXPY=python"
)
if not defined PY if not defined FIXPY (
    where py >nul 2>nul
    if not errorlevel 1 set "FIXPY=py"
)

rem --- missing deps: install once, then re-check ---
if not defined PY if defined FIXPY (
    echo [INFO] Backend dependencies missing, running pip install ...
    "!FIXPY!" -m pip install -r "%REQ%"
    "!FIXPY!" -c "import uvicorn, fastapi, dotenv, slowapi" >nul 2>nul
    if not errorlevel 1 set "PY=!FIXPY!"
)

if not defined PY (
    echo.
    echo [ERROR] No usable Python 3.9+ found with backend dependencies.
    echo         Run this once, then double-click start.bat again:
    echo             pip install -r backend\requirements.txt
    echo.
    pause
    exit /b 1
)

echo [INFO] Python: !PY!

rem --- 1. build frontend (same-origin) ---
set "VITE_API_BASE_URL=SAME_ORIGIN"
where node >nul 2>nul
if errorlevel 1 goto :no_node

echo [1/3] Building frontend ...
node scripts\build.js
if errorlevel 1 (
    echo [ERROR] Frontend build failed. See messages above.
    pause
    exit /b 1
)
goto :build_done

:no_node
if not exist "dist\index.html" (
    echo [ERROR] Node.js not found and dist\index.html is missing.
    echo         Install Node.js 16+ or run: node scripts\build.js
    pause
    exit /b 1
)
echo [1/3] Node.js not found, using existing dist\

:build_done

rem --- 2. pick a free port ---
set "PORT="
for /f "usebackq delims=" %%P in (`"!PY!" scripts\server_port.py free 8000 8099`) do set "PORT=%%P"
if not defined PORT (
    echo [ERROR] No free port between 8000 and 8099.
    pause
    exit /b 1
)
>".pianhang-port" echo !PORT!
if not "!PORT!"=="8000" echo [INFO] Port 8000 is busy, using !PORT! instead.

rem --- 3. start the service and open the browser ---
echo [2/3] Starting service on http://localhost:!PORT! ...
echo [3/3] Opening browser in a moment.
echo.
echo Keep this window open. Press Ctrl+C to stop the server.
echo.
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 3; Start-Process 'http://localhost:!PORT!'"
"!PY!" -m uvicorn backend.main:app --host 0.0.0.0 --port !PORT!

if errorlevel 1 (
    echo.
    echo [ERROR] Service failed to start. See the messages above.
    pause
)
endlocal
