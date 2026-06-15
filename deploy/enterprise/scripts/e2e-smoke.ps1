# Phase 1 automated smoke tests (Engine + License + Gateway + Bridge)
param(
  [switch]$SkipUp,
  [string]$EngineUrl = "http://127.0.0.1:4096",
  [string]$GatewayUrl = "http://127.0.0.1:9080",
  [string]$BridgeUrl = "http://127.0.0.1:8080",
  [string]$LicenseUrl = "http://127.0.0.1:19090",
  [string]$Password = $env:KILO_SERVER_PASSWORD,
  [string]$LicenseKey = "poc-demo-key",
  [switch]$Gateway,
  [switch]$Bridge,
  [switch]$FullChain
)

$ErrorActionPreference = "Stop"
$dir = Split-Path $PSScriptRoot -Parent

if ($FullChain) {
  $Gateway = $true
  $Bridge = $true
}

if (-not $SkipUp) {
  if ($FullChain) {
    & "$PSScriptRoot\up.ps1" -FullChain
  } elseif ($Gateway) {
    & "$PSScriptRoot\up.ps1" -Gateway -License
  } else {
    & "$PSScriptRoot\up.ps1" -License
  }
}

if (-not $Password) {
  $envFile = Join-Path $dir ".env"
  if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
      if ($_ -match '^\s*KILO_SERVER_PASSWORD=(.+)$') { $Password = $matches[1].Trim() }
    }
  }
}
if (-not $Password) {
  Write-Error "KILO_SERVER_PASSWORD not set"
  exit 1
}

$pair = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("kilo:$Password"))
$headers = @{ Authorization = "Basic $pair" }

function Wait-Http {
  param([string]$Url, [hashtable]$Hdr, [int]$Max = 60, [string]$Label = "service")
  for ($i = 0; $i -lt $Max; $i++) {
    try {
      $r = Invoke-WebRequest -Uri $Url -Headers $Hdr -UseBasicParsing -TimeoutSec 3
      if ($r.StatusCode -eq 200) { return }
    } catch {}
    Start-Sleep -Seconds 2
  }
  throw "$Label not healthy at $Url after ${Max} attempts"
}

Write-Host "[smoke] Waiting for engine (direct)..."
Wait-Http -Url "$EngineUrl/global/health" -Hdr $headers -Label "Engine"
Write-Host "[smoke] Engine OK (direct)"

if ($Bridge) {
  Write-Host "[smoke] Bridge /health..."
  Wait-Http -Url "$BridgeUrl/health" -Hdr @{} -Label "Bridge"
  Write-Host "[smoke] Bridge OK"
  Write-Host "[smoke] Bridge -> Engine health..."
  Wait-Http -Url "$BridgeUrl/global/health" -Hdr $headers -Label "Bridge proxy"
  Write-Host "[smoke] Bridge proxy OK"
}

Write-Host "[smoke] License verify..."
$body = @{ key = $LicenseKey; machineId = "smoke-test"; client = "vscode" } | ConvertTo-Json
try {
  $lic = Invoke-RestMethod -Uri "$LicenseUrl/api/v1/license/verify" -Method POST -Body $body -ContentType "application/json"
  if (-not $lic.valid) { throw "License invalid: $($lic | ConvertTo-Json -Compress)" }
  Write-Host "[smoke] License OK"
} catch {
  Write-Warning "[smoke] License mock not running (start: docker compose --profile license up -d)"
}

if ($Gateway) {
  Write-Host "[smoke] Gateway -> bridge -> engine health..."
  Wait-Http -Url "$GatewayUrl/kilo/global/health" -Hdr $headers -Label "Gateway chain"
  Write-Host "[smoke] Gateway chain OK"
  $log = Join-Path $dir "logs\apisix\enterprise-audit.log"
  if (Test-Path $log) {
    Write-Host "[smoke] Audit log lines: $((Get-Content $log | Measure-Object -Line).Lines)"
  } else {
    Write-Warning "[smoke] Audit log not found at $log"
  }
}

Write-Host "[smoke] Phase 1 stack checks passed."
