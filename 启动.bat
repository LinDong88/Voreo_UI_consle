@echo off
setlocal
cd /d "%~dp0"
title Voreo Console

REM Clear leftover processes so this window owns the service
call "%~dp0停止.bat" /quiet

echo.
echo Starting Voreo...
echo Close this window or press Ctrl+C to stop.
echo.

REM Open browser when http://127.0.0.1:5173/ is ready (separate window)
start "Voreo Open Browser" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0open-ui.ps1"

npm run dev

echo.
echo Service stopped.
pause
exit /b 0
