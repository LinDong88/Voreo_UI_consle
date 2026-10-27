$url = 'http://127.0.0.1:5173/'
for ($i = 0; $i -lt 60; $i++) {
  try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
    if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) {
      Start-Process $url
      exit 0
    }
  } catch {
    # not ready yet
  }
  Start-Sleep -Milliseconds 500
}
Write-Host 'Timed out waiting for UI at' $url
exit 1
