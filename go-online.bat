@echo off
setlocal
cd /d "%~dp0"
title Pianhang - Public (cpolar)

if not exist ".tools\cpolar\cpolar.exe" goto :nocpolar

netstat -ano | findstr /R /C:":8000 .*LISTENING" >nul 2>nul
if not errorlevel 1 goto :havesvc

echo Local service not running on :8000 - starting it first ...
start "pianhang-service" cmd /k "cd /d %~dp0backend && python -m uvicorn main:app --host 0.0.0.0 --port 8000"
timeout /t 6 /nobreak >nul

:havesvc
echo Starting cpolar tunnel  localhost:8000  -^>  public URL ...
start "cpolar-tunnel" cmd /k "cd /d %~dp0.tools\cpolar && cpolar http 8000 -config cpolar.yml -log stdout -log-level INFO"

echo.
echo ============================================
echo  The PUBLIC URL is shown in the new
echo  "cpolar-tunnel" window, on the line that
echo  starts with "URL:" - copy it and share.
echo  It is also listed at https://dashboard.cpolar.com
echo.
echo  IMPORTANT:
echo   * Keep this PC on, and keep BOTH black windows
echo     "pianhang-service" and "cpolar-tunnel" open.
echo   * Free plan gives a NEW random URL each run.
echo   * To stop the public link, close the cpolar-tunnel window.
echo ============================================
echo.
pause
exit /b 0

:nocpolar
echo [ERROR] .tools\cpolar\cpolar.exe not found.
echo         Download cpolar from https://www.cpolar.com and put
echo         cpolar.exe and cpolar.yml (with authtoken) into .tools\cpolar\
pause
exit /b 1
