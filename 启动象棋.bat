@echo off
rem ---------------------------------------------------------------
rem  Chess site launcher. Keep this file ASCII-only: cmd.exe reads
rem  .bat files with the console code page, so Chinese text here
rem  would be garbled. All Chinese messages come from server.js.
rem ---------------------------------------------------------------
title Chinese Chess Server
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto nonode

set XQ_PORT=8080
if not "%~1"=="" set XQ_PORT=%~1

start "" cmd /c "timeout /t 2 >nul & start http://localhost:%XQ_PORT%"
node "%~dp0server.js" --port %XQ_PORT%

echo.
echo Server stopped.
pause
exit /b 0

:nonode
echo.
echo   Node.js not found. Install the LTS build from https://nodejs.org
echo   then run this file again.
echo.
pause
exit /b 1
