@echo off
title Pianhang Launcher
echo ============================================
echo   Pianhang - One-click Start
echo ============================================
echo.

REM 切到脚本所在目录（无论脚本放在哪都能用）
cd /d "%~dp0"

echo [1/2] Starting backend (port 8001) ...
start "pianhang-backend" cmd /k "cd /d %~dp0backend && python -m uvicorn main:app --host 0.0.0.0 --port 8001"

echo [2/2] Starting frontend (port 8000) ...
start "pianhang-frontend" cmd /k "cd /d %~dp0 && python -m http.server 8000"

echo Waiting 6 seconds for services...
timeout /t 6 /nobreak >nul

echo Opening browser...
start http://localhost:8000

echo.
echo All done! Keep BOTH new black windows open.
echo If browser did not open, visit http://localhost:8000
echo.
pause
