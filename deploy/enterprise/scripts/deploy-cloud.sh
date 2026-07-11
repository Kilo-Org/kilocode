#!/usr/bin/env bash
# Cloud server: install deps hint + build + FullChain compose + smoke
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

FULL=0
BUILD=0
for arg in "$@"; do
  case "$arg" in
    --full-chain) FULL=1 ;;
    --build) BUILD=1 ;;
  esac
done

if [[ ! -f .env ]]; then
  if [[ -f "$DIR/env/test.cloud.api.env.sample" ]]; then
    cp "$DIR/env/test.cloud.api.env.sample" .env
    echo "[deploy-cloud] Created .env from env/test.cloud.api.env.sample"
  else
    cp .env.cloud.example .env
  fi
  echo "[deploy-cloud] Edit .env: KILO_SERVER_PASSWORD, KILO_CUSTOM_API_KEY"
fi

mkdir -p logs/apisix

if [[ "$BUILD" -eq 1 ]]; then
  "$DIR/scripts/build-engine.sh"
fi

profiles=(license)
services=(kilo-engine qdrant license-mock)
if [[ "$FULL" -eq 1 ]]; then
  profiles=(gateway license)
  services=(kilo-engine qdrant enterprise-bridge apisix license-mock)
fi

args=(compose)
for p in "${profiles[@]}"; do
  args+=(--profile "$p")
done
args+=(up -d)
if [[ "$BUILD" -eq 1 ]]; then
  args+=(--force-recreate --no-deps kilo-engine)
fi
args+=("${services[@]}")

echo "[deploy-cloud] docker ${args[*]}"
docker "${args[@]}"

if [[ "$FULL" -eq 1 ]]; then
  "$DIR/scripts/sync-apisix-from-env.sh"
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

if [[ "$FULL" -eq 1 ]]; then
  "$DIR/scripts/e2e-smoke.sh" --full-chain
else
  "$DIR/scripts/e2e-smoke.sh"
fi

echo "[deploy-cloud] Done. Plugin gateway: http://<云服务器公网IP>:9080/kilo"
