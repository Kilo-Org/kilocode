#!/usr/bin/env bash
# 在云机 deploy/enterprise 目录执行：./scripts/check-cloud-env.sh
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$DIR/.env"
COMPOSE="$DIR/docker-compose.yml"

echo "=== Enterprise cloud env check ==="
echo "dir: $DIR"
echo ""

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[FAIL] missing .env at $ENV_FILE"
  exit 1
fi
echo "[OK] .env exists"

required=(
  PLATFORM_JWT_SECRET
  PLATFORM_PG_PASSWORD
  KILO_SERVER_PASSWORD
  PLATFORM_OIDC_ISSUER
  PLATFORM_OIDC_CLIENT_ID
  PLATFORM_OIDC_CLIENT_SECRET
  PLATFORM_OIDC_REDIRECT_URL
)

optional_vscode=(
  PLATFORM_OIDC_VSCODE_URI
)

missing=0
for key in "${required[@]}"; do
  if grep -qE "^${key}=" "$ENV_FILE" && ! grep -qE "^${key}=$" "$ENV_FILE" && ! grep -qE "^${key}=<" "$ENV_FILE"; then
    val="$(grep -E "^${key}=" "$ENV_FILE" | head -1 | cut -d= -f2-)"
    if [[ "$key" == *SECRET* || "$key" == *PASSWORD* ]]; then
      echo "[OK] $key=*** (${#val} chars)"
    else
      echo "[OK] $key=$val"
    fi
  else
    echo "[FAIL] $key missing or placeholder in .env"
    missing=$((missing + 1))
  fi
done

for key in "${optional_vscode[@]}"; do
  if grep -qE "^${key}=" "$ENV_FILE" && ! grep -qE "^${key}=$" "$ENV_FILE"; then
    echo "[OK] $key=$(grep -E "^${key}=" "$ENV_FILE" | head -1 | cut -d= -f2-)"
  else
    echo "[WARN] $key not set — platform uses default vscode://yoyo-local.yoyo-code/enterprise/callback"
  fi
done

if ! grep -q "PLATFORM_OIDC_VSCODE_URI" "$COMPOSE"; then
  echo "[WARN] docker-compose.yml does not pass PLATFORM_OIDC_VSCODE_URI to enterprise-platform"
  echo "       add: PLATFORM_OIDC_VSCODE_URI: \${PLATFORM_OIDC_VSCODE_URI:-vscode://yoyo-local.yoyo-code/enterprise/callback}"
fi

echo ""
echo "=== Running container env (enterprise-platform) ==="
if docker compose --profile platform ps enterprise-platform 2>/dev/null | grep -q Up; then
  docker compose --profile platform exec -T enterprise-platform sh -c 'env | grep -E "^PLATFORM_OIDC|^PLATFORM_JWT|^PLATFORM_AUTH" | sort' || true
else
  echo "[WARN] enterprise-platform container not running"
fi

echo ""
echo "=== HTTP probes ==="
base="${PLATFORM_URL:-https://wab.flyfishphp.cn}"
curl -sf "$base/api/v1/auth/status" && echo ""
curl -sf "$base/api/v1/version" && echo ""
code="$(curl -s -o /dev/null -w "%{http_code}" "$base/api/v1/auth/login?client=vscode")"
echo "login?client=vscode → HTTP $code (expect 302)"

if [[ "$missing" -gt 0 ]]; then
  echo ""
  echo "[FAIL] fix $missing required .env entries, then:"
  echo "  docker compose --profile platform up -d --build enterprise-platform"
  exit 1
fi

echo ""
echo "[OK] required .env keys present. If VS Code SSO still opens /admin/, rebuild platform:"
echo "  PLATFORM_OIDC_VSCODE_URI=vscode://yoyo-local.yoyo-code/enterprise/callback"
echo "  docker compose --profile platform up -d --build enterprise-platform"
