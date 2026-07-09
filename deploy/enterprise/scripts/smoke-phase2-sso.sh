#!/usr/bin/env bash
# Phase 2 W5 — VS Code SSO smoke（JWT 经网关访问 /kilo/*）
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

PLATFORM_URL="${PLATFORM_URL:-http://127.0.0.1:8090}"
GATEWAY_URL="${GATEWAY_URL:-http://127.0.0.1:9080}"
DEV_EMAIL="${DEV_EMAIL:-admin@enterprise.local}"

echo "[sso-smoke] dev token..."
tok="$(curl -sf -X POST "$PLATFORM_URL/api/v1/auth/dev-token" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$DEV_EMAIL\"}" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')"
if [[ -z "$tok" ]]; then
  echo "[sso-smoke] failed to get dev token" >&2
  exit 1
fi

echo "[sso-smoke] GET /api/v1/auth/me via gateway..."
me="$(curl -sf "$GATEWAY_URL/api/v1/auth/me" -H "Authorization: Bearer $tok")"
echo "$me" | grep -q '"roles"'

echo "[sso-smoke] GET /kilo/global/health with Bearer JWT..."
code="$(curl -s -o /dev/null -w "%{http_code}" "$GATEWAY_URL/kilo/global/health" -H "Authorization: Bearer $tok")"
if [[ "$code" != "200" ]]; then
  echo "[sso-smoke] expected /kilo/global/health 200, got $code (reload apisix if jwt route missing)" >&2
  exit 1
fi

echo "[sso-smoke] OIDC login URL..."
curl -sf -o /dev/null -w "%{http_code}" "$PLATFORM_URL/api/v1/auth/login?client=vscode" | grep -qE '302|303'

echo "[sso-smoke] OK — plugin: enable enterprise.sso.enabled + remoteServer.url=/kilo"
