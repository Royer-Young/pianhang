@echo off
setlocal
title Pianhang Launcher
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 goto :nopython

where node >nul 2>nul
if not errorlevel 1 goto :build

if exist "dist\index.html" goto :reuse
echo [ERROR] No Node.js and no prebuilt dist\.
echo         Install Node.js 16+ and run once:  node scripts\build.js
pause
exit /b 1

:build
echo [1/3] Building frontend (same-origin) ...
set "VITE_API_BASE_URL=SAME_ORIGIN"
node scripts\build.js
if errorlevel 1 goto :buildfail
goto :serve

:reuse
echo [1/3] Node.js not found - reusing existing dist\.

:serve
echo [2/3] Starting service on port 8000 ...
start "pianhang-service" cmd /k "cd /d %~dp0backend && python -m uvicorn main:app --host 0.0.0.0 --port 8000"

echo [3/3] Waiting for the service ...
timeout /t 6 /nobreak >nul
start http://localhost:8000

echo.
echo ============================================
echo  Pianhang is running.
echo    Local   :  http://localhost:8000
echo    LAN     :  http://YOUR-IP:8000   (find IP with: ipconfig)
echo    Public  :  run  go-online.bat
echo  Keep the "pianhang-service" window open.
echo  Close it to stop the server.
echo ============================================
echo.
pause
exit /b 0

:nopython
echo [ERROR] Python not found. Install Python 3.9+ and tick "Add Python to PATH".
pause
exit /b 1

:buildfail
echo [ERROR] Frontend build failed.
pause
exit /b 1
