#!/bin/sh
set -eu

root=$(CDPATH= cd "$(dirname "$0")/../.." && pwd)

if command -v direnv >/dev/null 2>&1 && [ -f "$root/.envrc" ]; then
  exec direnv exec "$root" bun "$@"
fi

exec bun "$@"
