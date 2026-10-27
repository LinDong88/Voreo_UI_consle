@echo off
setlocal
cd /d "%~dp0"
title Voreo Console

set "URL=http://127.0.0.1:5173/"

REM Clear leftover processes so this window owns the service
call "%~dp0停止.bat" /quiet

echo.
echo Starting Voreo...
echo Close this window or press Ctrl+C to stop.
echo.

REM Open the browser once the UI is ready (runs in background)
start /b powershell -NoProfile -Command ^
  "$url='%URL%'; for($i=0;$i -lt 40;$i++){ try{ Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 1 | Out-Null; Start-Process $url; exit 0 } catch{}; Start-Sleep -Milliseconds 500 }; Write-Host 'Timed out waiting for UI.'"

npm run dev

echo.
echo Service stopped.
pause
exit /b 0
