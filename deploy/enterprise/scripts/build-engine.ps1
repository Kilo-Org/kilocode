# Build @kilocode/cli dist and Docker image for kilo-engine (x86_64 default)
param(
  [string]$Tag = "kilo-engine:local",
  [string]$Platform = "linux/amd64"
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$opencode = Join-Path $root "packages\opencode"
$enterprise = Join-Path $root "deploy\enterprise"

Write-Host "[build-engine] Building CLI in $opencode"
Push-Location $opencode
try {
  bun run script/build.ts --single --skip-install
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}

Write-Host "[build-engine] Docker build $Tag ($Platform)"
Push-Location $enterprise
try {
  docker build --platform $Platform -t $Tag -f ..\..\packages\opencode\Dockerfile ..\..\packages\opencode
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  Write-Host "[build-engine] Done: $Tag"
} finally {
  Pop-Location
}
