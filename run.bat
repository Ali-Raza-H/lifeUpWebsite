@echo off
setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0"

set "APP_URL=http://127.0.0.1:5000/"
set "STATE_DIR=%~dp0.run-state"
set "BACKEND_PID_FILE=%STATE_DIR%\backend.pid"
set "BROWSER_PID_FILE=%STATE_DIR%\browser.pid"
set "BROWSER_PROFILE_DIR=%STATE_DIR%\browser-profile"
set "LIFEWEB_WORKDIR=%CD%"
set "LIFEWEB_APP_URL=%APP_URL%"
set "LIFEWEB_BROWSER_PROFILE_DIR=%BROWSER_PROFILE_DIR%"

if not exist "%STATE_DIR%" mkdir "%STATE_DIR%" >nul 2>&1

call :sync_state
if not defined BACKEND_PID call :start_backend
if /i not "%LIFEWEB_NO_BROWSER%"=="1" if not defined BROWSER_PID call :start_browser

:menu
call :sync_state
cls
echo ==================================
echo            LifeWeb Menu
echo ==================================
echo URL: %APP_URL%
echo.
call :show_status
echo.
echo [O] Open browser
echo [R] Restart backend
echo [S] Stop backend
echo [B] Restart browser
echo [Q] Quit everything
echo.
choice /c ORSBQ /n /m "Select an option: "

if errorlevel 5 goto :quit_all
if errorlevel 4 goto :restart_browser
if errorlevel 3 goto :stop_backend_menu
if errorlevel 2 goto :restart_backend
if errorlevel 1 goto :open_browser_menu
goto :menu

:show_status
if defined BACKEND_PID (
    echo Backend: running   [PID !BACKEND_PID!]
) else (
    echo Backend: stopped
)

if /i "%LIFEWEB_NO_BROWSER%"=="1" (
    echo Browser: disabled  [LIFEWEB_NO_BROWSER=1]
) else if defined BROWSER_PID (
    echo Browser: running   [PID !BROWSER_PID!]
) else (
    echo Browser: stopped
)
exit /b 0

:open_browser_menu
if not defined BACKEND_PID call :start_backend
call :start_browser
goto :menu

:restart_backend
call :stop_backend
call :start_backend
goto :menu

:stop_backend_menu
call :stop_backend
goto :menu

:restart_browser
call :stop_browser
call :start_browser
goto :menu

:quit_all
call :stop_browser
call :stop_backend
exit /b 0

:sync_state
call :load_valid_pid BACKEND_PID "%BACKEND_PID_FILE%"
call :load_valid_pid BROWSER_PID "%BROWSER_PID_FILE%"
exit /b 0

:load_valid_pid
set "%~1="
if not exist "%~2" exit /b 0

set "PID_VALUE="
set /p PID_VALUE=<"%~2"
if not defined PID_VALUE (
    del /q "%~2" >nul 2>&1
    exit /b 0
)

call :is_process_running "%PID_VALUE%"
if errorlevel 1 (
    del /q "%~2" >nul 2>&1
    exit /b 0
)

set "%~1=%PID_VALUE%"
exit /b 0

:is_process_running
tasklist /FI "PID eq %~1" 2>nul | findstr /R /C:"[ ]%~1[ ]" >nul
if errorlevel 1 exit /b 1
exit /b 0

:start_backend
call :sync_state
if defined BACKEND_PID exit /b 0

echo Starting backend...
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "$p = Start-Process -FilePath 'python' -ArgumentList 'app.py' -WorkingDirectory $env:LIFEWEB_WORKDIR -WindowStyle Hidden -PassThru; $p.Id"`) do set "BACKEND_PID=%%P"

if not defined BACKEND_PID (
    echo Failed to start backend.
    timeout /t 2 /nobreak >nul
    exit /b 1
)

>"%BACKEND_PID_FILE%" echo !BACKEND_PID!
call :wait_for_backend
exit /b 0

:wait_for_backend
for /l %%I in (1,1,30) do (
    powershell -NoProfile -Command "try { $client = New-Object Net.Sockets.TcpClient('127.0.0.1', 5000); $client.Close(); exit 0 } catch { exit 1 }" >nul 2>&1
    if not errorlevel 1 exit /b 0
    timeout /t 1 /nobreak >nul
)
echo Backend started but port 5000 is not responding yet.
timeout /t 2 /nobreak >nul
exit /b 0

:stop_backend
call :sync_state
if not defined BACKEND_PID exit /b 0

echo Stopping backend...
taskkill /PID !BACKEND_PID! /T /F >nul 2>&1
del /q "%BACKEND_PID_FILE%" >nul 2>&1
set "BACKEND_PID="
exit /b 0

:start_browser
if /i "%LIFEWEB_NO_BROWSER%"=="1" exit /b 0

call :sync_state
if defined BROWSER_PID exit /b 0

call :detect_browser
if not defined BROWSER_EXE (
    echo No supported browser was found. Open %APP_URL% manually.
    timeout /t 2 /nobreak >nul
    exit /b 1
)

if not exist "%BROWSER_PROFILE_DIR%" mkdir "%BROWSER_PROFILE_DIR%" >nul 2>&1
set "LIFEWEB_BROWSER_EXE=%BROWSER_EXE%"

echo Opening browser...
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "$p = Start-Process -FilePath $env:LIFEWEB_BROWSER_EXE -ArgumentList @('--new-window', ""--user-data-dir=$env:LIFEWEB_BROWSER_PROFILE_DIR"", $env:LIFEWEB_APP_URL) -WorkingDirectory $env:LIFEWEB_WORKDIR -PassThru; $p.Id"`) do set "BROWSER_PID=%%P"

if not defined BROWSER_PID (
    echo Failed to open browser.
    timeout /t 2 /nobreak >nul
    exit /b 1
)

>"%BROWSER_PID_FILE%" echo !BROWSER_PID!
exit /b 0

:stop_browser
call :sync_state
if not defined BROWSER_PID exit /b 0

echo Closing browser...
taskkill /PID !BROWSER_PID! /T /F >nul 2>&1
del /q "%BROWSER_PID_FILE%" >nul 2>&1
set "BROWSER_PID="
if exist "%BROWSER_PROFILE_DIR%" rmdir /S /Q "%BROWSER_PROFILE_DIR%" >nul 2>&1
exit /b 0

:detect_browser
set "BROWSER_EXE="
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "$candidates = @($env:LocalAppData + '\Programs\Opera GX\opera.exe', $env:AppData + '\Opera Software\Opera GX Stable\opera.exe', $env:ProgramFiles + '\Opera GX\opera.exe', ${env:ProgramFiles(x86)} + '\Opera GX\opera.exe', $env:ProgramFiles + '\Microsoft\Edge\Application\msedge.exe', ${env:ProgramFiles(x86)} + '\Microsoft\Edge\Application\msedge.exe', $env:ProgramFiles + '\Google\Chrome\Application\chrome.exe', ${env:ProgramFiles(x86)} + '\Google\Chrome\Application\chrome.exe', $env:LocalAppData + '\Google\Chrome\Application\chrome.exe', $env:LocalAppData + '\BraveSoftware\Brave-Browser\Application\brave.exe'); ($candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1)"`) do set "BROWSER_EXE=%%P"
exit /b 0
