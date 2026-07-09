#!/usr/bin/env bash
# Phase 2 platform smoke — health + license verify
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

PLATFORM_URL="${PLATFORM_URL:-http://127.0.0.1:8090}"
LICENSE_KEY="${LICENSE_KEY:-poc-demo-key}"

wait_http() {
  local url=$1 label=$2 max=${3:-60}
  for ((i = 0; i < max; i++)); do
    if curl -sf "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  echo "[phase2-smoke] $label not healthy: $url" >&2
  exit 1
}

echo "[phase2-smoke] Platform health..."
wait_http "$PLATFORM_URL/health" "Platform" 60

body="$(curl -sf "$PLATFORM_URL/health")"
echo "[phase2-smoke] health: $body"

ver="$(curl -sf "$PLATFORM_URL/api/v1/version")"
echo "[phase2-smoke] version: $ver"

echo "[phase2-smoke] License verify (valid key)..."
lic="$(curl -sf -X POST "$PLATFORM_URL/api/v1/license/verify" \
  -H "Content-Type: application/json" \
  -d "{\"key\":\"$LICENSE_KEY\",\"client\":\"vscode\",\"machineId\":\"smoke\"}")"
echo "[phase2-smoke] license: $lic"
echo "$lic" | grep -q '"valid":true'

echo "[phase2-smoke] License verify (invalid key)..."
code="$(curl -s -o /tmp/license-bad.json -w "%{http_code}" -X POST "$PLATFORM_URL/api/v1/license/verify" \
  -H "Content-Type: application/json" \
  -d '{"key":"bad-key"}')"
if [[ "$code" != "403" ]]; then
  echo "[phase2-smoke] expected 403 for bad key, got $code" >&2
  cat /tmp/license-bad.json >&2
  exit 1
fi
echo "[phase2-smoke] invalid key: HTTP $code"

echo "[phase2-smoke] OK"
