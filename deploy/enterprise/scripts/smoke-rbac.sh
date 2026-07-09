#!/usr/bin/env bash
# RBAC 三员互斥验收（HTTP，不拉 golang 镜像）
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLATFORM_URL="${PLATFORM_URL:-http://127.0.0.1:8090}"
DEV_EMAIL="${DEV_EMAIL:-admin@enterprise.local}"

tok="$(curl -sf -X POST "$PLATFORM_URL/api/v1/auth/dev-token" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$DEV_EMAIL\"}" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')"
auth="Authorization: Bearer $tok"

if command -v go >/dev/null 2>&1 && [[ -f "$DIR/platform/go.mod" ]]; then
  echo "[rbac-smoke] host go test..."
  (
    cd "$DIR/platform"
    export GOPROXY="${GOPROXY:-https://goproxy.cn,direct}"
    go test ./internal/rbac/...
  )
  echo "[rbac-smoke] OK (go test)"
  exit 0
fi

echo "[rbac-smoke] HTTP three-admin mutex..."
users="$(curl -sf "$PLATFORM_URL/api/v1/users" -H "$auth")"
uid="$(printf '%s' "$users" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for u in data.get('items', []):
    roles = u.get('roles') or []
    if 'developer' in roles and not any(r in roles for r in ('sys_admin', 'security_admin', 'audit_admin')):
        print(u['id'])
        break
else:
    for u in data.get('items', []):
        if u.get('id'):
            print(u['id'])
            break
")"
if [[ -z "$uid" ]]; then
  echo "[rbac-smoke] no test user in /api/v1/users" >&2
  exit 1
fi
echo "[rbac-smoke] user $uid"

code="$(curl -s -o /dev/null -w "%{http_code}" -X POST "$PLATFORM_URL/api/v1/users/$uid/roles" \
  -H "$auth" -H "Content-Type: application/json" -d '{"role":"sys_admin"}')"
if [[ "$code" != "200" ]]; then
  echo "[rbac-smoke] assign sys_admin expected 200, got $code" >&2
  exit 1
fi

code="$(curl -s -o /dev/null -w "%{http_code}" -X POST "$PLATFORM_URL/api/v1/users/$uid/roles" \
  -H "$auth" -H "Content-Type: application/json" -d '{"role":"audit_admin"}')"
if [[ "$code" != "409" ]]; then
  echo "[rbac-smoke] assign audit_admin expected 409 mutex, got $code" >&2
  exit 1
fi

echo "[rbac-smoke] OK (HTTP mutex 409)"
