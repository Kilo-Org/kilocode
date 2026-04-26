#!/usr/bin/env bash
# DaveAI: register the package.json branding-preserving merge driver in this
# clone's LOCAL git config. Git config cannot be committed, so every fresh
# clone of kilocode-Azure2 must run this script once before cherry-picking
# upstream release commits that touch packages/kilo-vscode/package.json.
#
# Usage (from the kilocode-Azure2 repo root):
#     bash scripts/setup-merge-drivers.sh
#
# Idempotent: re-running just overwrites the same two config keys.

set -euo pipefail

DRIVER_NAME='daveai-package-json-branding'
DRIVER_DESC='DaveAI package.json branding-preserving merge'
DRIVER_CMD='node scripts/merge-package-json-branding.cjs %O %A %B %P'

# 1. Register the driver name (used in error messages / git output).
git config "merge.${DRIVER_NAME}.name" "${DRIVER_DESC}"

# 2. Register the actual driver command. %O = ancestor, %A = current/ours,
#    %B = incoming/theirs, %P = pathname. Git invokes the driver per file
#    that .gitattributes maps to merge=daveai-package-json-branding.
git config "merge.${DRIVER_NAME}.driver" "${DRIVER_CMD}"

echo "[setup-merge-drivers] DaveAI merge driver '${DRIVER_NAME}' set up."
echo ""
echo "Verification:"
echo "  merge.${DRIVER_NAME}.name   = $(git config --get "merge.${DRIVER_NAME}.name")"
echo "  merge.${DRIVER_NAME}.driver = $(git config --get "merge.${DRIVER_NAME}.driver")"
echo ""
echo "Next step: confirm .gitattributes contains the line"
echo "  packages/kilo-vscode/package.json    merge=${DRIVER_NAME}"
echo "and then cherry-pick an upstream release commit to test (e.g. 9bbef875)."
