@echo off
chcp 65001 >nul
title Deploy xiangqi to Cloudflare Workers
cd /d "%~dp0"

rem ASCII only: cmd.exe parses .bat with the console code page.
rem Chinese messages come from the node script.

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js not found. Install the LTS build from https://nodejs.org
  echo   then run this file again.
  echo.
  pause
  exit /b 1
)

node "%~dp0scripts\deploy-cloudflare.js" %*

echo.
echo   ---- Result is also saved to %USERPROFILE%\xiangqi-cloudflare\deploy-cloudflare.log ----
echo.
echo   Press Enter to close this window...
set /p XQ_DUMMY=
