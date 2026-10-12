@echo off
chcp 65001 >nul
title Push xiangqi to GitHub
cd /d "%~dp0"

rem ASCII only in this file: cmd.exe parses .bat with the console code page,
rem so Chinese here would be garbled. All Chinese messages come from node.

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js not found. Install the LTS build from https://nodejs.org
  echo   then run this file again.
  echo.
  pause
  exit /b 1
)

node "%~dp0scripts\push-to-github.js" %*

echo.
pause
