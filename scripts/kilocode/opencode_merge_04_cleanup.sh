#!/bin/bash

# Cleanup script to run after resolving merge conflicts
# This resets files we maintain separately and removes deleted files

# Don't fail on individual command errors - we want to process all
set +e

echo "=== Cleaning up merge artifacts ==="

# Reset files we maintain separately (use our versions from dev)
echo "Resetting Kilo-specific files..."
git checkout origin/dev -- README.md 2>/dev/null
git checkout origin/dev -- CHANGELOG.md 2>/dev/null
git checkout origin/dev -- .github 2>/dev/null
git checkout origin/dev -- AGENTS.md 2>/dev/null

# Remove files that were deleted in our branch but added/modified upstream
echo "Removing files deleted in our branch..."
git status | grep 'deleted by us' | perl -pe 's/.*?://' | grep -E '\.md$' | xargs -n1 -I{} git rm "{}" 2>/dev/null
git status | grep 'deleted by us' | perl -pe 's/.*?://' | grep ".github/" | xargs -n1 -I{} git rm "{}" 2>/dev/null

# Ensure Kilo-specific packages are preserved (shouldn't be touched, but verify)
echo "Verifying Kilo-specific directories..."
if [ -d "packages/kilo-gateway" ]; then
  echo "  ✓ packages/kilo-gateway exists"
else
  echo "  ⚠ packages/kilo-gateway missing - may need to restore from dev"
fi

if [ -d "packages/kilo-telemetry" ]; then
  echo "  ✓ packages/kilo-telemetry exists"
else
  echo "  ⚠ packages/kilo-telemetry missing - may need to restore from dev"
fi

if [ -d "packages/opencode/src/kilocode" ]; then
  echo "  ✓ packages/opencode/src/kilocode exists"
else
  echo "  ⚠ packages/opencode/src/kilocode missing - may need to restore from dev"
fi

echo ""
echo "=== Cleanup complete ==="
echo ""
echo "Next steps:"
echo "1. Review remaining conflicts with: git status"
echo "2. Run: bun install"
echo "3. Run: bun run build"
echo "4. Run: bun run test"
echo "5. If all passes, commit and create PR"
