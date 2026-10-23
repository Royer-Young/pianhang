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
set "PORT="
set "SAVED="

rem Reuse the last service if it is still ours, otherwise reuse :8000.
if exist ".pianhang-port" set /p SAVED=<.pianhang-port
if defined SAVED (
    python scripts\server_port.py check %SAVED% >nul 2>nul
    if not errorlevel 1 set "PORT=%SAVED%"
)
if not defined PORT (
    python scripts\server_port.py check 8000 >nul 2>nul
    if not errorlevel 1 set "PORT=8000"
)
if defined PORT goto :havesvc

rem :8000 may belong to another program (music players often hold it).
for /f "delims=" %%p in ('python scripts\server_port.py free 8000 8099') do set "PORT=%%p"
if not defined PORT goto :noport
if "%PORT%"=="8000" goto :startsvc
echo [INFO] Port 8000 is busy - using port %PORT% instead.

:startsvc
echo [2/3] Starting service on port %PORT% ...
start "pianhang-service" cmd /k "cd /d %~dp0backend && python -m uvicorn main:app --host 0.0.0.0 --port %PORT%"
>".pianhang-port" echo %PORT%
goto :wait

:havesvc
>".pianhang-port" echo %PORT%
echo [2/3] Reusing the running service on port %PORT%.

:wait
echo [3/3] Waiting for the service ...
python scripts\server_port.py wait %PORT% 35
if errorlevel 1 goto :openfail
start "" "http://localhost:%PORT%"

echo.
echo ============================================
echo  Pianhang is running.
echo    Local   :  http://localhost:%PORT%
echo    LAN     :  http://YOUR-IP:%PORT%   (find IP with: ipconfig)
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

:noport
echo [ERROR] No free port found between 8000 and 8099.
pause
exit /b 1

:openfail
echo [ERROR] The service did not answer on port %PORT%.
echo         Check the "pianhang-service" window for the error,
echo         then run this script again.
pause
exit /b 1
