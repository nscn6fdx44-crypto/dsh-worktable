@echo off
chcp 65001 >nul
title Workbench Local Server
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js not found. Install Node.js 18+ first, then run this again.
  echo.
  pause
  exit /b 1
)

echo.
echo   Starting workbench local server ...
echo.
node "%~dp0serve.mjs"
echo.
echo   Server stopped.
pause
