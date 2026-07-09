#!/usr/bin/env bash
# Phase 2 admin smoke — model config + AD Pro APIs（deepseek apply 需 KILO_CUSTOM_API_KEY）
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

PLATFORM_URL="${PLATFORM_URL:-http://127.0.0.1:8090}"
CONFIG_FILE="${CONFIG_FILE:-$DIR/config/generated.kilo.jsonc}"
DEV_EMAIL="${DEV_EMAIL:-admin@enterprise.local}"
PROVIDER="${SMOKE_PROVIDER:-deepseek}"
BASE="${SMOKE_API_BASE:-https://api.deepseek.com/v1}"
DEFAULT="${SMOKE_DEFAULT_MODEL:-deepseek-v4-pro}"
SMALL="${SMOKE_SMALL_MODEL:-deepseek-v4-flash}"
KEY_ENV="${SMOKE_API_KEY_ENV:-KILO_CUSTOM_API_KEY}"

tok="$(curl -sf -X POST "$PLATFORM_URL/api/v1/auth/dev-token" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$DEV_EMAIL\"}" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')"
auth="Authorization: Bearer $tok"

echo "[admin-smoke] version..."
ver="$(curl -sf "$PLATFORM_URL/api/v1/version")"
echo "$ver" | grep -q '"service":"enterprise-platform"'
echo "$ver"

echo "[admin-smoke] admin static..."
code="$(curl -s -o /dev/null -w "%{http_code}" "$PLATFORM_URL/admin/")"
[[ "$code" == "200" ]]

echo "[admin-smoke] roles..."
curl -sf "$PLATFORM_URL/api/v1/roles" -H "$auth" | grep -q '"items"'

echo "[admin-smoke] model-config get..."
curl -sf "$PLATFORM_URL/api/v1/model-config" -H "$auth" | grep -q '"provider"'

echo "[admin-smoke] model-config put $PROVIDER apiKeyEnv=$KEY_ENV..."
curl -sf -X PUT "$PLATFORM_URL/api/v1/model-config" -H "$auth" -H "Content-Type: application/json" \
  -d "{\"provider\":\"$PROVIDER\",\"apiBase\":\"$BASE\",\"defaultModel\":\"$DEFAULT\",\"smallModel\":\"$SMALL\",\"apiKeyEnv\":\"$KEY_ENV\"}"

echo "[admin-smoke] model-config apply..."
apply="$(curl -sf -X POST "$PLATFORM_URL/api/v1/model-config/apply" -H "$auth" -H "Content-Type: application/json" -d '{}')"
echo "$apply" | grep -q '"status":"ok"'
grep -q "\"provider\":\"$PROVIDER\"" <<<"$apply"

if [[ -f "$CONFIG_FILE" ]]; then
  grep -q "\"$PROVIDER/$DEFAULT\"" "$CONFIG_FILE"
  grep -q "{env:$KEY_ENV}" "$CONFIG_FILE"
  echo "[admin-smoke] generated config: $CONFIG_FILE"
else
  echo "[admin-smoke] warn: $CONFIG_FILE not on host (check platform volume mount)" >&2
fi

echo "[admin-smoke] tenants / users / usage / licenses..."
curl -sf "$PLATFORM_URL/api/v1/tenants" -H "$auth" | grep -q '"items"'
users="$(curl -sf "$PLATFORM_URL/api/v1/users" -H "$auth")"
echo "$users" | grep -q '"items"'
uid="$(echo "$users" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)"
curl -sf "$PLATFORM_URL/api/v1/users/$uid" -H "$auth" | grep -q '"email"'
curl -sf "$PLATFORM_URL/api/v1/usage/summary" -H "$auth" | grep -q licenseUsage
curl -sf "$PLATFORM_URL/api/v1/usage/detail?days=7" -H "$auth" | grep -q '"daily"'
curl -sf "$PLATFORM_URL/api/v1/licenses" -H "$auth" | grep -q '"items"'

echo "[admin-smoke] monitor / audit pagination..."
curl -sf "$PLATFORM_URL/api/v1/monitor/health" -H "$auth" | grep -q '"items"'
audit="$(curl -sf "$PLATFORM_URL/api/v1/audit/logs?page=1&pageSize=5" -H "$auth")"
echo "$audit" | grep -q '"items"'
echo "$audit" | grep -q '"total"'

echo "[admin-smoke] OK ($PROVIDER) — recreate kilo-engine to load generated.kilo.jsonc"
