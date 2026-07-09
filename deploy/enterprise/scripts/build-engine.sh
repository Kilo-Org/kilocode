#!/usr/bin/env bash
set -euo pipefail
TAG="${1:-kilo-engine:local}"
PLATFORM="${2:-linux/amd64}"
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/../../.." && pwd)"
OPencode="$ROOT/packages/opencode"

# shellcheck disable=SC1091
source "$DIR/build-env.sh"

echo "[build-engine] Building CLI..."
if [[ "${KILO_SKIP_BUILD_ENV:-0}" != "1" ]]; then
  prepare_build_env
else
  export PATH="${HOME}/.local/node/bin:${HOME}/.bun/bin:${PATH}"
  echo "[build-engine] skipped prepare_build_env (KILO_SKIP_BUILD_ENV=1)"
fi

if [[ ! -d "$ROOT/node_modules" ]] || [[ ! -e "$ROOT/node_modules/@opencode-ai/ui" ]] || [[ ! -e "$ROOT/node_modules/@opencode-ai/llm" ]]; then
  echo "[build-engine] Installing workspace deps..."
  (cd "$ROOT" && bun install --ignore-scripts)
fi

ver="$(grep -m1 '"version"' "$OPencode/package.json" | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
export KILO_CHANNEL=latest
export KILO_VERSION="$ver"
# Bundled snapshot — avoid fetching models.dev on cloud (slow/blocked)
export MODELS_DEV_API_JSON="$OPencode/src/provider/models-snapshot.json"
echo "[build-engine] KILO_VERSION=$KILO_VERSION (offline/cloud build)"
echo "[build-engine] compiling CLI — first log line is 'Loaded N migrations' (10–20 min on small VMs is normal)"
echo "[build-engine] PATH node=$(command -v node 2>/dev/null || echo missing) bun=$(command -v bun 2>/dev/null || echo missing)"

(cd "$OPencode" && bun script/build.ts --docker --skip-install)

bin="$OPencode/dist/@kilocode/cli-linux-x64-baseline-musl/bin/kilo"
if [[ ! -x "$bin" ]]; then
  echo "[build-engine] missing binary: $bin" >&2
  exit 1
fi
echo "[build-engine] Built CLI: $($bin --version)"

echo "[build-engine] Docker build $TAG ($PLATFORM)"
docker build --platform "$PLATFORM" -t "$TAG" -f "$OPencode/Dockerfile" "$OPencode"
echo "[build-engine] Done: $TAG"
