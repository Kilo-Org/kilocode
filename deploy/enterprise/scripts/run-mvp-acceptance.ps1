# Phase 1 MVP acceptance — automated checks (Path B + License; optional FullChain)
param(
  [string]$EngineUrl = "http://127.0.0.1:4096",
  [string]$Password = "local-phase1-dev",
  [string]$LicenseUrl = "http://127.0.0.1:19090",
  [switch]$SkipCompile,
  [switch]$FullChain
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$fail = 0
$warn = 0
$startedMock = $false
$mockProc = $null

function Step($name, [scriptblock]$block, [switch]$Optional) {
  Write-Host "`n[accept] $name"
  try {
    & $block
    Write-Host "[accept] OK: $name" -ForegroundColor Green
  } catch {
    if ($Optional) {
      Write-Host "[accept] SKIP: $name — $_" -ForegroundColor Yellow
      $script:warn++
    } else {
      Write-Host "[accept] FAIL: $name — $_" -ForegroundColor Red
      $script:fail++
    }
  }
}

function Test-Http($url, $headers = @{}) {
  $r = Invoke-WebRequest -Uri $url -Headers $headers -UseBasicParsing -TimeoutSec 5
  if ($r.StatusCode -ne 200) { throw "status $($r.StatusCode)" }
}

try {
  Step "verify-mvp.ps1" {
    $vpArgs = @("-EngineUrl", $EngineUrl, "-Password", $Password)
    if ($SkipCompile) { $vpArgs += "-SkipCompile" }
    & "$PSScriptRoot\verify-mvp.ps1" @vpArgs
    if ($LASTEXITCODE -ne 0) { throw "exit $LASTEXITCODE" }
  }

  Step "Online License mock (P1-LC-01)" {
    try {
      Test-Http "$LicenseUrl/health"
    } catch {
      Write-Host "[accept] Starting mock-license.mjs..."
      $mockProc = Start-Process -FilePath "bun" -ArgumentList "deploy/enterprise/mock-license.mjs" -WorkingDirectory $root -PassThru -WindowStyle Hidden
      $startedMock = $true
      Start-Sleep -Seconds 2
      Test-Http "$LicenseUrl/health"
    }
    $body = @{ key = "poc-demo-key"; machineId = "mvp-acceptance"; client = "vscode" } | ConvertTo-Json
    $lic = Invoke-RestMethod -Uri "$LicenseUrl/api/v1/license/verify" -Method POST -Body $body -ContentType "application/json"
    if (-not $lic.valid) { throw "valid=false" }
  }

  Step "Engine health (P1-L1-01)" {
    $pair = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("kilo:$Password"))
    Test-Http "$EngineUrl/global/health" @{ Authorization = "Basic $pair" }
  }

  if ($FullChain) {
    Step "Docker FullChain (P1-E2E-02)" {
      docker info 2>&1 | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "Docker daemon not running — start Docker Desktop (WSL2 engine)" }
      & "$PSScriptRoot\up.ps1" -FullChain
      if ($LASTEXITCODE -ne 0) { throw "up.ps1 exit $LASTEXITCODE" }
    }
  } else {
    Step "Docker FullChain (P1-E2E-02)" {
      docker info 2>&1 | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "Docker daemon not running" }
      Write-Host "[accept] Docker available — run: .\run-mvp-acceptance.ps1 -FullChain"
    } -Optional
  }

  Write-Host ""
  if ($fail -gt 0) {
    Write-Host "[accept] FAILED: $fail required check(s), $warn optional skip(s)." -ForegroundColor Red
    exit 1
  }
  Write-Host "[accept] MVP automated acceptance PASSED ($warn optional skip(s))." -ForegroundColor Green
  Write-Host "[accept] Manual: VS Code B4-B6 — see docs/enterprise/PHASE1-VSCODE-TEST.md"
  if (-not $FullChain) {
    Write-Host "[accept] FullChain (A5-A9): start Docker Desktop, then re-run with -FullChain"
  }
} finally {
  if ($startedMock -and $mockProc -and -not $mockProc.HasExited) {
    Stop-Process -Id $mockProc.Id -Force -ErrorAction SilentlyContinue
  }
}
