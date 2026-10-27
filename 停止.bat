@echo off
setlocal
cd /d "%~dp0"

echo Stopping Voreo (ports 5173 / 5174)...
powershell -NoProfile -Command ^
  "$ports = 5173,5174; $pids = @(); foreach ($p in $ports) { Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $pids += $_.OwningProcess } }; $pids = $pids | Select-Object -Unique; foreach ($id in $pids) { if ($id) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue; Write-Host ('  killed PID ' + $id) } }; if (-not $pids) { Write-Host '  nothing listening' }"

if /i not "%~1"=="/quiet" (
  echo.
  echo Done.
  pause
)
exit /b 0
