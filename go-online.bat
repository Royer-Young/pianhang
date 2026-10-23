@echo off
setlocal
cd /d "%~dp0"
title Pianhang - Public (cpolar)

if not exist ".tools\cpolar\cpolar.exe" goto :nocpolar

where python >nul 2>nul
if errorlevel 1 goto :nopython

rem Follow the port chosen by start.bat instead of assuming :8000.
set "PORT=8000"
if exist ".pianhang-port" set /p PORT=<.pianhang-port
if not defined PORT set "PORT=8000"

python scripts\server_port.py check %PORT% >nul 2>nul
if not errorlevel 1 goto :havesvc

echo Local service not running on :%PORT% - starting it first ...
for /f "delims=" %%p in ('python scripts\server_port.py free 8000 8099') do set "PORT=%%p"
if not defined PORT goto :noport
if not "%PORT%"=="8000" echo [INFO] Port 8000 is busy - using port %PORT% instead.
start "pianhang-service" cmd /k "cd /d %~dp0backend && python -m uvicorn main:app --host 0.0.0.0 --port %PORT%"
>".pianhang-port" echo %PORT%
echo Waiting for the service ...
python scripts\server_port.py wait %PORT% 35
if errorlevel 1 goto :startfail

:havesvc
>".pianhang-port" echo %PORT%
echo Starting cpolar tunnel  localhost:%PORT%  -^>  public URL ...
start "cpolar-tunnel" cmd /k "cd /d %~dp0.tools\cpolar && cpolar http %PORT% -config cpolar.yml -log stdout -log-level INFO"

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

:nopython
echo [ERROR] Python not found. Install Python 3.9+ and add it to PATH.
pause
exit /b 1

:noport
echo [ERROR] No free port found between 8000 and 8099.
pause
exit /b 1

:startfail
echo [ERROR] The service did not answer on port %PORT%.
echo         Check the "pianhang-service" window for details.
pause
exit /b 1
