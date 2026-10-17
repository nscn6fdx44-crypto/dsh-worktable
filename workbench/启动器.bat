@echo off
chcp 65001 >nul
title Workbench Launcher
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js not found. Install Node.js 18+ first.
  echo.
  pause
  exit /b 1
)

echo.
echo   工作台启动器已启动
echo   本机浏览器打开： http://127.0.0.1:7339/
echo   点「启动工作台」即可拉起本地服务并跳转。
echo.
node "%~dp0launcher.mjs"
echo.
echo   启动器已停止。
pause
