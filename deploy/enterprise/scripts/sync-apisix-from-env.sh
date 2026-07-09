#!/usr/bin/env bash
# Sync APISIX jwt secret + engine Basic header from deploy/enterprise/.env
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$DIR/.env"
APISIX="$DIR/apisix/apisix.yaml"

[[ -f "$ENV_FILE" ]] || { echo "[sync-apisix] missing .env" >&2; exit 1; }

# shellcheck disable=SC1090
source "$ENV_FILE"

: "${PLATFORM_JWT_SECRET:?set PLATFORM_JWT_SECRET}"
: "${KILO_SERVER_PASSWORD:?set KILO_SERVER_PASSWORD}"

basic="$(printf 'kilo:%s' "$KILO_SERVER_PASSWORD" | base64 -w0 2>/dev/null || printf 'kilo:%s' "$KILO_SERVER_PASSWORD" | base64 | tr -d '\n')"

python3 - <<PY
from pathlib import Path

p = Path("$APISIX")
text = p.read_text()
lines = text.splitlines()
out = []
secret_done = False
for line in lines:
    if not secret_done and line.strip().startswith("secret:"):
        out.append(f"        secret: $PLATFORM_JWT_SECRET")
        secret_done = True
        continue
    out.append(line.replace("__KILO_ENGINE_BASIC__", "$basic"))
p.write_text("\n".join(out) + ("\n" if text.endswith("\n") else ""))
print("[sync-apisix] patched jwt secret + engine basic header")
PY

cd "$DIR"
docker compose --profile gateway restart apisix
echo "[sync-apisix] apisix restarted"
