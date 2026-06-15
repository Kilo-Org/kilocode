# Start Phase 1 enterprise stack
param(
  [switch]$Build,
  [switch]$License,
  [switch]$Gateway,
  [switch]$Bridge,
  [switch]$FullChain
)

$ErrorActionPreference = "Stop"
$dir = Split-Path $PSScriptRoot -Parent
Push-Location $dir
try {
  if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "Created .env from .env.example — set KILO_SERVER_PASSWORD."
  }
  if ($Build) {
    & "$PSScriptRoot\build-engine.ps1"
  }

  New-Item -ItemType Directory -Force -Path "logs\apisix" | Out-Null

  if ($FullChain) {
    $Gateway = $true
    $Bridge = $true
    $License = $true
  }

  $services = @("kilo-engine", "qdrant")
  if ($License) { $services += "license-mock" }
  if ($Gateway -or $Bridge) { $services += "enterprise-bridge" }
  if ($Gateway) { $services += "apisix" }

  $profiles = @()
  if ($License) { $profiles += "license" }
  if ($Gateway) { $profiles += "gateway" }
  if ($Bridge -and -not $Gateway) { $profiles += "bridge" }

  $composeArgs = @("compose")
  foreach ($p in $profiles) {
    $composeArgs += "--profile"
    $composeArgs += $p
  }
  $composeArgs += "up", "-d"
  $composeArgs += $services

  docker @composeArgs
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

  $pwd = $env:KILO_SERVER_PASSWORD
  if (-not $pwd) {
    Get-Content .env | ForEach-Object {
      if ($_ -match '^\s*KILO_SERVER_PASSWORD=(.+)$') { $pwd = $matches[1].Trim() }
    }
  }

  $smokeArgs = @("-SkipUp", "-Password", $pwd)
  if ($FullChain) { $smokeArgs += "-FullChain" }
  elseif ($Gateway) { $smokeArgs += "-Gateway" }
  if ($Bridge -and -not $FullChain) { $smokeArgs += "-Bridge" }

  & "$PSScriptRoot\e2e-smoke.ps1" @smokeArgs
} finally {
  Pop-Location
}
