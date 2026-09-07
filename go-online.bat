@echo off
setlocal
cd /d "%~dp0"
title Pianhang - Public (cpolar)

echo ============================================
echo   Pianhang - Go Public via cpolar tunnel
echo ============================================
echo.

REM ---------- 0. cpolar present? ----------
if not exist ".tools\cpolar\cpolar.exe" (
    echo [ERROR] .tools\cpolar\cpolar.exe not found.
    echo         Download cpolar from https://www.cpolar.com and place
    echo         cpolar.exe + your cpolar.yml (with authtoken) into .tools\cpolar\
    pause
    exit /b 1
)

REM ---------- 1. ensure the local service is listening on :8000 ----------
netstat -ano | findstr /R /C:":8000 .*LISTENING" >nul 2>nul
if errorlevel 1 (
    echo Local service not running on :8000 - starting it first ...
    start "pianhang-service" cmd /k "cd /d %~dp0backend && python -m uvicorn main:app --host 0.0.0.0 --port 8000"
    timeout /t 6 /nobreak >nul
    echo.
)

REM ---------- 2. open cpolar tunnel to localhost:8000 ----------
echo Starting cpolar tunnel  localhost:8000  -^>  public URL ...
start "cpolar-tunnel" cmd /k "cd /d %~dp0.tools\cpolar && cpolar http 8000 -config cpolar.yml -log stdout -log-level INFO"

echo.
echo ============================================
echo  The PUBLIC URL is shown in the new
echo  "cpolar-tunnel" black window on the line
echo  starting with "URL:"  - copy it and share.
echo  It is also listed at https://dashboard.cpolar.com
echo.
echo  IMPORTANT:
echo   * Keep this PC on, and keep BOTH black windows
echo     ("pianhang-service" and "cpolar-tunnel") open.
echo   * Free plan gives a NEW random URL on each run.
echo   * Stop the public link: close the cpolar-tunnel window.
echo ============================================
echo.
pause
