#!/usr/bin/env bash
# Ensure bun is on PATH (needed for build-engine.sh on cloud)
set -euo pipefail

export PATH="${HOME}/.bun/bin:${PATH}"

if command -v bun >/dev/null 2>&1; then
  echo "[bun] $(bun --version)"
  exit 0
fi

echo "[bun] Not found — installing..."
curl -fsSL https://bun.sh/install | bash
export PATH="${HOME}/.bun/bin:${PATH}"

if ! grep -q '\.bun/bin' ~/.bashrc 2>/dev/null; then
  echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.bashrc
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "[bun] Install failed. Try manually:" >&2
  echo "  curl -fsSL https://bun.sh/install | bash" >&2
  echo "  export PATH=\"\$HOME/.bun/bin:\$PATH\"" >&2
  exit 1
fi

echo "[bun] Installed: $(bun --version)"
