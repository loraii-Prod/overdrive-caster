@echo off
setlocal
title Overdrive Caster
cd /d "%~dp0"

rem Optional settings (passwords, port, OBS): copy settings.example.bat to settings.bat and edit it.
if exist settings.bat call settings.bat
if "%PORT%"=="" set PORT=8787

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)

rem First run, or "start.cmd rebuild" after updating the files: install and build.
if /i "%~1"=="rebuild" goto build
if not exist "dist\server.js" goto build
goto run

:build
echo Installing and building (first run takes a few minutes)...
call npm run build
if errorlevel 1 (
  echo.
  echo The build failed. Scroll up for the error.
  pause
  exit /b 1
)

:run
start "" "http://localhost:%PORT%/controller"
:loop
echo.
echo Overdrive Caster on http://localhost:%PORT%  (close this window to stop)
node dist\server.js
rem The controller's "Restart server" button exits the server: start it again.
echo Server stopped. Restarting in 2 seconds... (close this window to stop)
timeout /t 2 /nobreak >nul
goto loop
