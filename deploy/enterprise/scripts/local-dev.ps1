# Phase 1 local dev: bundled CLI + kilo serve (no Docker)
param(
  [int]$Port = 4096,
  [string]$Password = "local-phase1-dev",
  [string]$Hostname = "127.0.0.1",
  [switch]$MockLicense
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$vscode = Join-Path $root "packages\kilo-vscode"
$bin = Join-Path $vscode "bin\kilo.exe"
$offlineLicense = Join-Path $root "deploy\enterprise\samples\offline-license.signed.json"
$offlinePublicKey = Join-Path $root "deploy\enterprise\samples\license-dev-public.pem"

Write-Host "[local-dev] Building extension CLI bundle..."
Push-Location $vscode
try {
  bun script/local-bin.ts
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}

if (-not (Test-Path $bin)) {
  Write-Error "CLI not found at $bin"
  exit 1
}

if ($MockLicense) {
  Write-Host "[local-dev] Starting license mock on :19090 (background job)..."
  Start-Job -Name "kilo-license-mock" -ScriptBlock {
    param($root)
    Set-Location (Join-Path $root "deploy\enterprise")
    bun ./mock-license.mjs
  } -ArgumentList $root | Out-Null
}

$env:KILO_SERVER_PASSWORD = $Password
Write-Host "[local-dev] Starting kilo serve on http://${Hostname}:$Port"
Write-Host "[local-dev] Password: $Password"
Write-Host ""
Write-Host "=== VS Code settings (merge into settings.json) ==="
$licenseBlock = if ($MockLicense) {
@"

  "kilo-code.new.enterprise.license.serverUrl": "http://127.0.0.1:19090",
  "kilo-code.new.enterprise.license.key": "poc-demo-key",
"@
} else {
@"

  "kilo-code.new.enterprise.license.offlinePath": "$($offlineLicense -replace '\\', '/')",
  "kilo-code.new.enterprise.license.offlinePublicKeyPath": "$($offlinePublicKey -replace '\\', '/')",
  "kilo-code.new.enterprise.license.key": "enterprise-offline-demo",
"@
}

@"

  "kilo-code.new.enterprise.remoteServer.enabled": true,
  "kilo-code.new.enterprise.remoteServer.url": "http://${Hostname}:$Port",
  "kilo-code.new.enterprise.remoteServer.password": "$Password",
  "kilo-code.new.enterprise.license.enabled": true,
$licenseBlock
  "kilo-code.new.customApi.enabled": true,
  "kilo-code.new.customApi.providerId": "ruiyumaas",
  "kilo-code.new.customApi.baseUrl": "https://ruiyumaas.com/v1",
  "kilo-code.new.customApi.defaultModel": "glm-5.1",
  "kilo-code.new.customApi.smallModel": "glm-5",
  "kilo-code.new.customApi.overwriteOnStartup": true

"@
Write-Host "=== customApi: 使用 Ruiyu MaaS (https://ruiyumaas.com/v1) ==="
Write-Host "    若未在 settings 中设置 apiKey，将使用扩展 package.json 默认值或环境变量 KILO_CUSTOM_API_KEY"
Write-Host ""
Write-Host "=== Keep this window open. Press Ctrl+C to stop serve. ==="
Write-Host ""

& $bin serve --port $Port --hostname $Hostname
