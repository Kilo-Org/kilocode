#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf '%s\n' 'Usage: bash .kilo/skills/jetbrains-sandbox/script/setup.sh [command] [options]

Commands:
  install       Install IntelliJ, MCP Steroid, and desktop dependencies (default)
  up            Install, then run the desktop in the foreground
  run           Run an already installed desktop; Ctrl+C stops it
  stop          Stop this sandbox only
  status        Show supervisor, viewer, and MCP status
  mcp           Call an MCP tool
  screenshot    Capture the IDE window
  serve         Serve a captured screenshot
  help          Show this help

All options are forwarded to the checked-in Bun installer. Examples:
  bash .kilo/skills/jetbrains-sandbox/script/setup.sh install --host 0.0.0.0
  bash .kilo/skills/jetbrains-sandbox/script/setup.sh up --host 0.0.0.0 --with-kilo
  bash .kilo/skills/jetbrains-sandbox/script/setup.sh run
  bash .kilo/skills/jetbrains-sandbox/script/setup.sh install --help

Requires Bun and a Linux x86-64 Debian 13 environment. Install as root, or use
--skip-deps when dependencies are already installed. Paths are relative to this
worktree root. State defaults to .kilo-dev/jetbrains-sandbox/.

Only expose 0.0.0.0 behind authenticated sandbox port forwarding. The viewer
defaults to http://localhost:6080/; raw VNC and MCP stay on loopback.
JetBrains agreements and authentication must be completed manually.'
}

case "${1:-install}" in
  help|-h|--help)
    usage
    exit 0
    ;;
  -*)
    cmd=install
    ;;
  *)
    cmd="${1:-install}"
    if (( $# > 0 )); then
      shift
    fi
    ;;
esac

dir="$(dirname -- "$(realpath -- "${BASH_SOURCE[0]}")")"
cd -- "$dir/../../../.."

bun="$(command -v bun || true)"
if [[ -z "$bun" && -x "${HOME:-}/.bun/bin/bun" ]]; then
  bun="${HOME}/.bun/bin/bun"
fi
if [[ -z "$bun" ]]; then
  printf '%s\n' 'Bun is required. Install Bun and rerun this script.' >&2
  exit 1
fi

if [[ "$cmd" == up ]]; then
  for arg in "$@"; do
    if [[ "$arg" == --help || "$arg" == -h ]]; then
      exec "$bun" "$dir/setup.ts" install --help
    fi
  done
  "$bun" "$dir/setup.ts" install "$@"
  exec "$bun" "$dir/setup.ts" run "$@"
fi

exec "$bun" "$dir/setup.ts" "$cmd" "$@"
