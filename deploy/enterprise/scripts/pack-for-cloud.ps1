# Pack minimal repo slice for cloud deploy (OpenCloudOS / Linux)
param(
  [string]$CloudHost,
  [string]$User = "root",
  [string]$RemoteDir = "/root/kilocode-main",
  [string]$Output,
  [switch]$Upload
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$outDir = Join-Path $root "deploy\enterprise\dist"
$tar = if ($Output) { $Output } else { Join-Path $root "kilocode-cloud.tgz" }

# Paths required for `bun install` + `build-engine.sh` (workspace deps for @kilocode/cli)
$paths = @(
  "package.json",
  "bun.lock",
  "LICENSE",
  "patches",
  "packages/opencode",
  "packages/core",
  "packages/script",
  "packages/kilo-gateway",
  "packages/kilo-indexing",
  "packages/kilo-memory",
  "packages/kilo-sandbox",
  "packages/kilo-telemetry",
  "packages/plugin",
  "packages/plugin-atomic-chat",
  "packages/http-recorder",
  "packages/llm",
  "packages/ui",
  "packages/kilo-ui",
  "packages/kilo-web-ui",
  "packages/kilo-console",
  "packages/sdk/js",
  "deploy/enterprise"
)

$exclude = @(
  "--exclude=node_modules",
  "--exclude=.git",
  "--exclude=packages/opencode/dist",
  "--exclude=packages/opencode/bin",
  "--exclude=packages/kilo-vscode",
  "--exclude=packages/kilo-jetbrains",
  "--exclude=packages/kilo-docs",
  "--exclude=packages/storybook",
  "--exclude=*.vsix",
  "--exclude=deploy/enterprise/dist"
)

New-Item -ItemType Directory -Force -Path (Split-Path $tar -Parent) | Out-Null

Write-Host "[pack] Creating $tar"
Write-Host "[pack] Includes: $($paths -join ', ')"

Push-Location $root
try {
  if (-not (Get-Command tar -ErrorAction SilentlyContinue)) {
    throw "tar not found — install Git for Windows (includes tar)"
  }
  foreach ($p in $paths) {
    if (-not (Test-Path $p)) { throw "missing path: $p" }
  }
  $tarArgs = @("-czf", $tar) + $exclude + $paths
  & tar @tarArgs
  if ($LASTEXITCODE -ne 0) { throw "tar exit $LASTEXITCODE" }
} finally {
  Pop-Location
}

$size = (Get-Item $tar).Length
Write-Host "[pack] Archive: $tar ($([math]::Round($size/1MB, 1)) MB)" -ForegroundColor Green

if ($Upload -or $CloudHost) {
  if (-not $CloudHost) { throw "CloudHost required for upload" }
  Write-Host "[pack] Uploading to ${User}@${CloudHost}:${RemoteDir}..."
  ssh "${User}@${CloudHost}" "mkdir -p $RemoteDir"
  scp $tar "${User}@${CloudHost}:/root/kilocode-cloud.tgz"
  ssh "${User}@${CloudHost}" @"
mkdir -p $RemoteDir && tar -xzf /root/kilocode-cloud.tgz -C $RemoteDir && rm /root/kilocode-cloud.tgz && chmod +x $RemoteDir/deploy/enterprise/scripts/*.sh && ls $RemoteDir/deploy/enterprise/scripts/deploy-cloud.sh
"@
}

Write-Host ""
Write-Host "[pack] Upload to cloud (manual):" -ForegroundColor Cyan
Write-Host "  scp `"$tar`" root@43.143.227.210:/root/kilocode-cloud.tgz"
Write-Host ""
Write-Host "[pack] On cloud server:" -ForegroundColor Green
Write-Host @"
  mkdir -p $RemoteDir && tar -xzf /root/kilocode-cloud.tgz -C $RemoteDir
  chmod +x $RemoteDir/deploy/enterprise/scripts/*.sh
  cd $RemoteDir/deploy/enterprise
  ./scripts/bootstrap-oc9.sh          # first time only
  cd $RemoteDir && bun install --ignore-scripts
  cd deploy/enterprise
  cp env/test.cloud.ruiyumaas.env.sample .env && nano .env
  chmod +x scripts/*.sh
  ./scripts/deploy-cloud.sh --build --full-chain
"@
