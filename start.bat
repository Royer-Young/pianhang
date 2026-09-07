@echo off
setlocal
title Pianhang Launcher
echo ============================================
echo   Pianhang - One-click Start  (LAN ready)
echo ============================================
echo.

REM 切到脚本所在目录（无论脚本放在哪都能用）
cd /d "%~dp0"

REM ---------- 0. python check ----------
where python >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Python not found. Install Python 3.9+ and tick "Add Python to PATH".
    pause
    exit /b 1
)

REM ---------- 1. build frontend (same-origin) ----------
where node >nul 2>nul
if not errorlevel 1 (
    echo [1/3] Building frontend (same-origin) ...
    set "VITE_API_BASE_URL=SAME_ORIGIN"
    node scripts\build.js
    if errorlevel 1 (
        echo [ERROR] Frontend build failed.
        pause
        exit /b 1
    )
) else (
    if exist "dist\index.html" (
        echo [1/3] Node.js not found - reusing existing dist\
        echo       (if pages fail to reach the backend, install Node and run: node scripts\build.js)
    ) else (
        echo [ERROR] No Node.js and no prebuilt dist\.
        echo         Install Node.js 16+, or run once:  node scripts\build.js
        pause
        exit /b 1
    )
)

REM ---------- 2. start ONE service: FastAPI hosts frontend + /api on 0.0.0.0:8000 ----------
echo [2/3] Starting service on port 8000 ...
start "pianhang-service" cmd /k "cd /d %~dp0backend && python -m uvicorn main:app --host 0.0.0.0 --port 8000"

REM ---------- 3. wait then open browser ----------
echo [3/3] Waiting for the service to be ready ...
timeout /t 6 /nobreak >nul
start http://localhost:8000

echo.
echo ============================================
echo  Pianhang is now running in ONE window
echo  (the "pianhang-service" black window).
echo.
echo    Local   :  http://localhost:8000
echo    LAN     :  http://<this-PC-IP>:8000
echo               find your IP with:  ipconfig
echo               (other devices on same Wi-Fi can open it;
echo                allow Python through Windows Firewall if asked)
echo    Public  :  run  go-online.bat  for a cpolar URL
echo ============================================
echo.
echo If the browser did not open, visit http://localhost:8000
echo Close the "pianhang-service" window to stop.
echo.
pause
