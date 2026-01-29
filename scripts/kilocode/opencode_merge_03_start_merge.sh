#!/bin/bash

set -e

# Check if a version is provided
if [ -z "$1" ]; then
  echo "Usage: $0 <version> [prefix]"
  echo "Example: $0 v1.1.42"
  exit 1
fi

VERSION=$1
PREFIX=$2
BRANCH_PREFIX=""
if [ -n "$PREFIX" ]; then
  BRANCH_PREFIX="$PREFIX/"
fi

echo "Creating merge branch ${BRANCH_PREFIX}opencode-$VERSION from dev..."
git checkout dev
git checkout -b "${BRANCH_PREFIX}opencode-$VERSION"

echo "Merging prepared upstream branch..."
git merge "${BRANCH_PREFIX}upstream-prepared-$VERSION" --no-edit || true

echo ""
echo "=== MERGE STARTED ==="
echo ""
echo "If there are conflicts, resolve them following these guidelines:"
echo ""
echo "1. Priority order:"
echo "   - package.json files (preserve Kilo naming)"
echo "   - Lock files (run 'bun install' after package.json is resolved)"
echo "   - Files with 'kilocode_change' markers (ALWAYS preserve)"
echo "   - Config files (generally keep Kilo versions)"
echo "   - Documentation (keep Kilo versions)"
echo ""
echo "2. After resolving conflicts:"
echo "   - Run: ./scripts/kilocode/opencode_merge_04_cleanup.sh"
echo "   - Then: bun install"
echo "   - Then: bun run build"
echo "   - Then: bun run test"
echo ""
echo "3. To complete the merge:"
echo "   - git merge --continue (if still in merge state)"
echo "   - Or commit your changes if merge completed"
