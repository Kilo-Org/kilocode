# Phase 1 MVP automated checks (Windows / dev machine)
param(
  [string]$EngineUrl = "http://127.0.0.1:4096",
  [string]$Password = "local-phase1-dev",
  [switch]$SkipCompile
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$vscode = Join-Path $root "packages\kilo-vscode"
$fail = 0

function Step($name, [scriptblock]$block) {
  Write-Host "`n[mvp] $name"
  try {
    & $block
    Write-Host "[mvp] OK: $name" -ForegroundColor Green
  } catch {
    Write-Host "[mvp] FAIL: $name — $_" -ForegroundColor Red
    $script:fail++
  }
}

Step "License unit tests" {
  Push-Location $vscode
  try {
    bun test tests/unit/enterprise-license-offline.test.ts
    if ($LASTEXITCODE -ne 0) { throw "exit $LASTEXITCODE" }
  } finally { Pop-Location }
}

if (-not $SkipCompile) {
  Step "Extension typecheck" {
    Push-Location $vscode
    try {
      bun run typecheck
      if ($LASTEXITCODE -ne 0) { throw "exit $LASTEXITCODE" }
    } finally { Pop-Location }
  }

  Step "Extension esbuild" {
    Push-Location $vscode
    try {
      if (-not (Test-Path "bin\kilo.exe")) {
        bun script/local-bin.ts
        if ($LASTEXITCODE -ne 0) { throw "cli build exit $LASTEXITCODE" }
      }
      node esbuild.js
      if ($LASTEXITCODE -ne 0) { throw "esbuild exit $LASTEXITCODE" }
    } finally { Pop-Location }
  }
}

Step "RSA sample files exist" {
  $signed = Join-Path $root "deploy\enterprise\samples\offline-license.signed.json"
  $pub = Join-Path $root "deploy\enterprise\samples\license-dev-public.pem"
  if (-not (Test-Path $signed)) { throw "missing $signed — run: bun deploy/enterprise/scripts/gen-offline-license.mjs" }
  if (-not (Test-Path $pub)) { throw "missing $pub" }
}

Step "Engine health (optional)" {
  try {
    $pair = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("kilo:$Password"))
    $r = Invoke-WebRequest -Uri "$EngineUrl/global/health" -Headers @{ Authorization = "Basic $pair" } -UseBasicParsing -TimeoutSec 3
    if ($r.StatusCode -ne 200) { throw "status $($r.StatusCode)" }
  } catch {
    Write-Warning "Engine not running at $EngineUrl — start local-dev.ps1 or cloud stack (not a hard fail)"
  }
}

Write-Host ""
if ($fail -gt 0) {
  Write-Host "[mvp] $fail check(s) failed." -ForegroundColor Red
  exit 1
}
Write-Host "[mvp] All automated MVP checks passed." -ForegroundColor Green
