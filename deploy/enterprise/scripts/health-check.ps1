# Phase 1 health check for docker compose stack
param(
  [string]$EngineUrl = "http://127.0.0.1:4096",
  [string]$Password = $env:KILO_SERVER_PASSWORD,
  [string]$LicenseUrl = "http://127.0.0.1:19090"
)

if (-not $Password) {
  Write-Error "Set KILO_SERVER_PASSWORD or pass -Password"
  exit 1
}

$pair = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("kilo:$Password"))
$headers = @{ Authorization = "Basic $pair" }

Write-Host "Engine health: $EngineUrl/global/health"
$engine = Invoke-WebRequest -Uri "$EngineUrl/global/health" -Headers $headers -UseBasicParsing
if ($engine.StatusCode -ne 200) { exit 1 }
Write-Host "OK"

Write-Host "License mock: $LicenseUrl/health"
$lic = Invoke-WebRequest -Uri "$LicenseUrl/health" -UseBasicParsing -ErrorAction SilentlyContinue
if ($lic -and $lic.StatusCode -eq 200) {
  Write-Host "OK"
} else {
  Write-Host "SKIP (start profile license if needed)"
}

Write-Host "All checks passed."
