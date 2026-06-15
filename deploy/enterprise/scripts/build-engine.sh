#!/usr/bin/env bash
set -euo pipefail
TAG="${1:-kilo-engine:local}"
PLATFORM="${2:-linux/amd64}"
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
OPencode="$ROOT/packages/opencode"

ensure_bun() {
  export PATH="${HOME}/.bun/bin:${PATH}"
  if command -v bun >/dev/null 2>&1; then
    echo "[build-engine] bun $(bun --version)"
    return 0
  fi
  echo "[build-engine] bun not found — installing..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="${HOME}/.bun/bin:${PATH}"
  grep -q '\.bun/bin' ~/.bashrc 2>/dev/null || echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.bashrc
  command -v bun >/dev/null 2>&1 || { echo "[build-engine] bun install failed" >&2; exit 1; }
  echo "[build-engine] bun $(bun --version)"
}

echo "[build-engine] Building CLI..."
ensure_bun

if [[ ! -d "$ROOT/node_modules" ]]; then
  echo "[build-engine] Installing workspace deps (first run)..."
  (cd "$ROOT" && bun install --ignore-scripts)
fi

# Cloud tarball has no .git — avoid git/npm version lookup in packages/script
ver="$(grep -m1 '"version"' "$OPencode/package.json" | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
export KILO_CHANNEL=latest
export KILO_VERSION="$ver"
echo "[build-engine] KILO_VERSION=$KILO_VERSION (offline/cloud build)"

(cd "$OPencode" && bun run script/build.ts --docker --skip-install)

echo "[build-engine] Docker build $TAG ($PLATFORM)"
docker build --platform "$PLATFORM" -t "$TAG" -f "$OPencode/Dockerfile" "$OPencode"
echo "[build-engine] Done: $TAG"
