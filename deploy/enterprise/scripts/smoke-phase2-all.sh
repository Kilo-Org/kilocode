#!/usr/bin/env bash
# Phase 2 W6 — 联调验收总脚本（platform + gateway + Phase1 共存）
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

ENV_FILE="$DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

PLATFORM_URL="${PLATFORM_URL:-http://127.0.0.1:8090}"
GATEWAY_URL="${GATEWAY_URL:-http://127.0.0.1:9080}"
LICENSE_URL="${LICENSE_URL:-$PLATFORM_URL}"
LICENSE_KEY="${LICENSE_KEY:-poc-demo-key}"
PUBLIC_PLATFORM_URL="${PUBLIC_PLATFORM_URL:-}"
PUBLIC_LOGTO_URL="${PUBLIC_LOGTO_URL:-https://logto.wab.flyfishphp.cn}"

export PLATFORM_URL GATEWAY_URL LICENSE_URL LICENSE_KEY

echo "=============================================="
echo " Phase 2 W6 acceptance — $(date -Iseconds)"
echo " PLATFORM_URL=$PLATFORM_URL"
echo " GATEWAY_URL=$GATEWAY_URL"
echo "=============================================="

run() {
  echo ""
  echo ">>> $*"
  "$@"
}

run "$DIR/scripts/smoke-phase2.sh"
run "$DIR/scripts/smoke-phase2-w3.sh"
run "$DIR/scripts/smoke-phase2-w4.sh"

if [[ -n "${KILO_SERVER_PASSWORD:-}" ]]; then
  export ENGINE_URL="${ENGINE_URL:-http://127.0.0.1:4096}"
  export BRIDGE_URL="${BRIDGE_URL:-http://127.0.0.1:8080}"
  run "$DIR/scripts/e2e-smoke.sh" --full-chain
else
  echo "[w6] skip e2e-smoke --full-chain (KILO_SERVER_PASSWORD unset)" >&2
fi

echo ""
echo ">>> RBAC three-admin mutex..."
run "$DIR/scripts/smoke-rbac.sh"

if [[ "${SKIP_SSO_SMOKE:-}" != "1" ]]; then
  run "$DIR/scripts/smoke-phase2-sso.sh"
fi

echo ""
echo ">>> Logto OIDC discovery (HTTPS)..."
curl -sf "$PUBLIC_LOGTO_URL/oidc/.well-known/openid-configuration" | grep -q '"authorization_endpoint":"https://'

if [[ -n "$PUBLIC_PLATFORM_URL" ]]; then
  echo ""
  echo ">>> Public platform: $PUBLIC_PLATFORM_URL"
  curl -sf "$PUBLIC_PLATFORM_URL/api/v1/version" | grep -q enterprise-platform
  curl -sf "$PUBLIC_PLATFORM_URL/health" | grep -q '"status":"ok"'
fi

echo ""
echo ">>> Compose status (platform + gateway + logto)..."
docker compose --profile platform --profile gateway --profile logto ps

echo ""
echo "[w6] ALL PASSED — see docs/enterprise/PHASE2-E2E-CHECKLIST.md for manual items"
