#!/bin/bash
# Repackages a pre-built Kilo CLI release archive (see packages/opencode/script/build.ts)
# into a conda environment. No compilation happens here -- the archive already
# contains a finished, platform-specific `kilo` binary plus its runtime assets
# (tree-sitter grammars, sandbox helpers, and on Linux, bwrap + licenses).
#
# `interpreter: bash` is forced in recipe.yaml, so this script always runs
# through bash on the build machine even when cross-building for a different
# target platform (e.g. building the win-64 package from a Linux CI runner).
set -euo pipefail

mkdir -p "$PREFIX/lib/kilo"
cp -a "$SRC_DIR"/. "$PREFIX/lib/kilo/"

if [ -f "$PREFIX/lib/kilo/kilo.exe" ]; then
  chmod +x "$PREFIX/lib/kilo/kilo.exe"
  mkdir -p "$PREFIX/Scripts"
  cat > "$PREFIX/Scripts/kilo.bat" <<'BATCH'
@echo off
setlocal
set "KILO_TREE_SITTER_WASM_DIR=%~dp0..\lib\kilo\tree-sitter"
"%~dp0..\lib\kilo\kilo.exe" %*
BATCH
else
  chmod +x "$PREFIX/lib/kilo/kilo"
  if [ -f "$PREFIX/lib/kilo/bwrap" ]; then
    chmod +x "$PREFIX/lib/kilo/bwrap"
  fi
  mkdir -p "$PREFIX/bin"
  cat > "$PREFIX/bin/kilo" <<'SHELL'
#!/usr/bin/env bash
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export KILO_TREE_SITTER_WASM_DIR="$here/../lib/kilo/tree-sitter"
exec "$here/../lib/kilo/kilo" "$@"
SHELL
  chmod +x "$PREFIX/bin/kilo"
fi
