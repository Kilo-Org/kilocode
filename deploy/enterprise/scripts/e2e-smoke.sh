#!/usr/bin/env bash
# Linux smoke tests (cloud / CI)
set -euo pipefail

ENGINE_URL="${ENGINE_URL:-http://127.0.0.1:4096}"
GATEWAY_URL="${GATEWAY_URL:-http://127.0.0.1:9080}"
BRIDGE_URL="${BRIDGE_URL:-http://127.0.0.1:8080}"
LICENSE_URL="${LICENSE_URL:-http://127.0.0.1:19090}"
LICENSE_KEY="${LICENSE_KEY:-poc-demo-key}"
FULL=0

for arg in "$@"; do
  case "$arg" in
    --full-chain) FULL=1 ;;
  esac
done

if [[ -z "${KILO_SERVER_PASSWORD:-}" ]]; then
  ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env"
  if [[ -f "$ENV_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$ENV_FILE"
  fi
fi
if [[ -z "${KILO_SERVER_PASSWORD:-}" ]]; then
  echo "KILO_SERVER_PASSWORD not set" >&2
  exit 1
fi

auth="kilo:${KILO_SERVER_PASSWORD}"

wait_http() {
  local url=$1 label=$2 max=${3:-60} use_auth=${4:-0}
  for ((i = 0; i < max; i++)); do
    if [[ "$use_auth" == "1" ]]; then
      if curl -sf -u "$auth" "$url" >/dev/null 2>&1; then return 0; fi
    else
      if curl -sf "$url" >/dev/null 2>&1; then return 0; fi
    fi
    sleep 2
  done
  echo "[smoke] $label not healthy: $url" >&2
  echo "[smoke] hint: docker compose ps && docker compose logs kilo-engine --tail 80" >&2
  exit 1
}

echo "[smoke] Engine direct..."
wait_http "$ENGINE_URL/global/health" "Engine" 90 1

if [[ "$FULL" -eq 1 ]]; then
  echo "[smoke] Bridge..."
  wait_http "$BRIDGE_URL/health" "Bridge" 60 0
  wait_http "$BRIDGE_URL/global/health" "Bridge proxy" 60 1
  echo "[smoke] Gateway chain..."
  wait_http "$GATEWAY_URL/kilo/global/health" "Gateway" 60 1
  log="$(cd "$(dirname "$0")/.." && pwd)/logs/apisix/enterprise-audit.log"
  if [[ -f "$log" ]]; then
    echo "[smoke] Audit log lines: $(wc -l < "$log")"
  fi
fi

echo "[smoke] License..."
if curl -sf -X POST "$LICENSE_URL/api/v1/license/verify" \
  -H "Content-Type: application/json" \
  -d "{\"key\":\"$LICENSE_KEY\",\"machineId\":\"smoke\",\"client\":\"vscode\"}" | grep -q '"valid":true'; then
  echo "[smoke] License OK"
else
  echo "[smoke] License mock skipped or failed" >&2
fi

echo "[smoke] Passed."
