@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js not found. Install Node.js 18+ first.
  echo.
  pause
  exit /b 1
)

set "LB=%~dp0launcher.mjs"

echo.
echo   注册开机自启任务（登录时后台启动启动器，无需再敲命令）
echo.
schtasks /Create /TN "WorkbenchLauncher" /TR "node \"%LB%\"" /SC ONLOGON /F

echo.
echo   立即启动一次（最小化窗口）...
start "" /min node "%LB%"
echo.
echo   本机浏览器打开： http://127.0.0.1:7339/
echo   之后每次登录会自动启动启动器。
echo.
pause
