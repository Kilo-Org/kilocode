#!/usr/bin/env bash
# Phase 2 W3 smoke — JWT + users API (+ optional APISIX jwt-auth)
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

PLATFORM_URL="${PLATFORM_URL:-http://127.0.0.1:8090}"
GATEWAY_URL="${GATEWAY_URL:-http://127.0.0.1:9080}"
DEV_EMAIL="${DEV_EMAIL:-admin@enterprise.local}"

echo "[w3-smoke] dev token..."
tok="$(curl -sf -X POST "$PLATFORM_URL/api/v1/auth/dev-token" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$DEV_EMAIL\"}" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')"
if [[ -z "$tok" ]]; then
  echo "[w3-smoke] failed to get dev token (set PLATFORM_AUTH_DEV=1)" >&2
  exit 1
fi
echo "[w3-smoke] token ok (${#tok} chars)"

echo "[w3-smoke] GET /api/v1/auth/me..."
me="$(curl -sf "$PLATFORM_URL/api/v1/auth/me" -H "Authorization: Bearer $tok")"
echo "[w3-smoke] me: $me"
echo "$me" | grep -q '"roles"'

echo "[w3-smoke] GET /api/v1/users..."
users="$(curl -sf "$PLATFORM_URL/api/v1/users" -H "Authorization: Bearer $tok")"
echo "[w3-smoke] users: $users"
echo "$users" | grep -q '"items"'

ver="$(curl -sf "$PLATFORM_URL/api/v1/version")"
echo "[w3-smoke] version: $ver"
echo "$ver" | grep -qE '"phase":"2-w[34]"'

gateway_up() {
  local code
  code="$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 3 \
    -X POST "$GATEWAY_URL/api/v1/license/verify" \
    -H "Content-Type: application/json" \
    -d '{"key":"__smoke_probe__"}' 2>/dev/null || true)"
  [[ "$code" == "403" || "$code" == "200" || "$code" == "401" || "$code" == "502" ]]
}

if gateway_up; then
  :
else
  echo "[w3-smoke] gateway skip (APISIX not reachable on $GATEWAY_URL)" >&2
  echo "[w3-smoke] OK (platform only)"
  exit 0
fi

echo "[w3-smoke] APISIX jwt-auth /api/v1/auth/me..."
gw="$(curl -sf "$GATEWAY_URL/api/v1/auth/me" -H "Authorization: Bearer $tok")"
echo "[w3-smoke] gateway me: $gw"

code="$(curl -s -o /dev/null -w "%{http_code}" "$GATEWAY_URL/api/v1/users")"
if [[ "$code" != "401" ]]; then
  echo "[w3-smoke] expected 401 without token on gateway, got $code" >&2
  exit 1
fi
echo "[w3-smoke] gateway rejects anonymous: HTTP $code"

echo "[w3-smoke] OK"
