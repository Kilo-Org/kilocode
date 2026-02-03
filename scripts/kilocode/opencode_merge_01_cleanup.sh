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

# P0: Reset critical branding files - ALWAYS keep Kilo versions
echo ""
echo "=== Resetting CRITICAL branding files (P0) ==="
echo "These files MUST always use Kilo versions, never upstream:"

# Logo file - contains Kilo ASCII art
if git checkout origin/dev -- packages/opencode/src/cli/logo.ts 2>/dev/null; then
  echo "  ✓ Reset packages/opencode/src/cli/logo.ts (Kilo logo)"
  git add packages/opencode/src/cli/logo.ts
else
  echo "  ⚠ Could not reset logo.ts - verify manually!"
fi

# UI file - references the logo
if git checkout origin/dev -- packages/opencode/src/cli/ui.ts 2>/dev/null; then
  echo "  ✓ Reset packages/opencode/src/cli/ui.ts"
  git add packages/opencode/src/cli/ui.ts
else
  echo "  ⚠ Could not reset ui.ts - verify manually!"
fi

# Provider configuration - kilo must be first in preferredProviders
if git checkout origin/dev -- packages/app/src/hooks/use-providers.ts 2>/dev/null; then
  echo "  ✓ Reset packages/app/src/hooks/use-providers.ts (kilo first in preferredProviders)"
  git add packages/app/src/hooks/use-providers.ts
else
  echo "  ⚠ Could not reset use-providers.ts - verify manually!"
fi

# Remove unwanted README translations
echo ""
echo "=== Removing unwanted README translations ==="
for readme in README.it.md README.th.md; do
  if [ -f "$readme" ]; then
    git rm -f "$readme" 2>/dev/null && echo "  ✓ Removed $readme" || echo "  ⚠ Could not remove $readme"
  fi
done

# Remove files that were deleted in our branch but added/modified upstream
echo ""
echo "Removing files deleted in our branch..."
git status | grep 'deleted by us' | perl -pe 's/.*?://' | grep -E '\.md$' | xargs -n1 -I{} git rm "{}" 2>/dev/null
git status | grep 'deleted by us' | perl -pe 's/.*?://' | grep ".github/" | xargs -n1 -I{} git rm "{}" 2>/dev/null

# Ensure Kilo-specific packages are preserved (shouldn't be touched, but verify)
echo ""
echo "=== Verifying Kilo-specific directories ==="
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
echo "=== Running branding verification ==="
echo ""

# Verify root package.json name
ROOT_NAME=$(grep '"name":' package.json | head -1)
if echo "$ROOT_NAME" | grep -q "@kilocode/cli"; then
  echo "  ✓ Root package.json has correct name: @kilocode/cli"
else
  echo "  ⚠ Root package.json name is WRONG: $ROOT_NAME"
  echo "    Should be: \"name\": \"@kilocode/cli\""
fi

# Verify logo has Kilo branding
if grep -q "KILO\|kilo" packages/opencode/src/cli/logo.ts 2>/dev/null; then
  echo "  ✓ logo.ts contains Kilo branding"
else
  echo "  ⚠ logo.ts may not have Kilo branding - verify manually!"
fi

# Verify preferredProviders has kilo first
FIRST_PROVIDER=$(grep -A1 "preferredProviders" packages/app/src/hooks/use-providers.ts 2>/dev/null | grep '"' | head -1)
if echo "$FIRST_PROVIDER" | grep -q '"kilo"'; then
  echo "  ✓ preferredProviders has 'kilo' first"
else
  echo "  ⚠ preferredProviders does NOT have 'kilo' first: $FIRST_PROVIDER"
fi

# Check for kiloGateway keys in locale
if grep -q "kiloGateway" packages/app/src/i18n/en.ts 2>/dev/null; then
  echo "  ✓ Locale files have kiloGateway keys"
else
  echo "  ⚠ kiloGateway keys may be missing from locale files - verify manually!"
fi

# Check for kilo.note key
if grep -q "dialog.provider.kilo.note" packages/app/src/i18n/en.ts 2>/dev/null; then
  echo "  ✓ dialog.provider.kilo.note key exists"
else
  echo "  ⚠ dialog.provider.kilo.note key is MISSING - must restore!"
fi

echo ""
echo "=== Cleanup complete ==="
echo ""
echo "Next steps:"
echo "1. Review remaining conflicts with: git status"
echo "2. Fix any ⚠ warnings above"
echo "3. Run: bun run ./scripts/kilocode/opencode_merge_02_package_json.ts"
echo "4. Run: bun install"
echo "5. Run: bun run build"
echo "6. Run: bun run typecheck"
echo "7. Run: cd packages/opencode && bun run test"
echo "8. If all passes, commit and create PR"
