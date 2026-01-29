#!/bin/bash

# Fix branding in locale/i18n files after merge
# This script restores Kilo branding that may have been overwritten by upstream
#
# Run this AFTER the cleanup script (04) and package.json resolution (05)

set -e

echo "=== Fixing Kilo branding in locale files ==="
echo ""

# Get the locale file from dev to use as reference for key restoration
LOCALE_DIR="packages/app/src/i18n"

# List of specific keys that MUST have Kilo branding
# These are user-facing strings that should say "Kilo" not "OpenCode"

echo "Checking and fixing specific branding keys in en.ts..."

EN_FILE="$LOCALE_DIR/en.ts"

if [ ! -f "$EN_FILE" ]; then
  echo "  ⚠ $EN_FILE not found!"
  exit 1
fi

# Function to check if a key exists and has correct value
check_and_warn() {
  local key="$1"
  local expected="$2"
  if grep -q "$key" "$EN_FILE"; then
    if grep "$key" "$EN_FILE" | grep -q "$expected"; then
      echo "  ✓ $key has correct Kilo branding"
    else
      echo "  ⚠ $key exists but may have wrong branding"
      grep "$key" "$EN_FILE" | head -1
    fi
  else
    echo "  ✗ $key is MISSING"
  fi
}

echo ""
echo "=== Checking critical Kilo branding keys ==="

check_and_warn "dialog.provider.kilo.note" "Access 500+ AI models"
check_and_warn "dialog.model.unpaid.freeModels.title" "Kilo CLI"
check_and_warn "provider.connect.kiloGateway.line1" "Kilo Gateway"
check_and_warn "provider.connect.kiloGateway.visit.link" "kilo.ai"
check_and_warn "dialog.server.description" "Kilo CLI"
check_and_warn "toast.update.description" "Kilo CLI"
check_and_warn "error.page.report.prefix" "Kilo CLI"
check_and_warn "sidebar.gettingStarted.line1" "Kilo CLI"

echo ""
echo "=== Checking for OpenCode references that should be Kilo ==="

# Find user-facing strings that say "OpenCode" but should say "Kilo CLI"
# Exclude: opencode.ai URLs, opencode.json config references, @opencode-ai packages
OPENCODE_REFS=$(grep -n "OpenCode" "$EN_FILE" 2>/dev/null | grep -v "opencode.ai\|opencode.json\|@opencode-ai" || true)

if [ -n "$OPENCODE_REFS" ]; then
  echo "Found potential OpenCode references that may need to be changed to Kilo CLI:"
  echo "$OPENCODE_REFS"
  echo ""
  echo "Review these manually - user-facing strings should say 'Kilo CLI'"
else
  echo "  ✓ No obvious OpenCode references found in user-facing strings"
fi

echo ""
echo "=== Checking for opencodeZen references (should be kiloGateway) ==="

ZENREFS=$(grep -rn "opencodeZen" "$LOCALE_DIR" 2>/dev/null || true)
if [ -n "$ZENREFS" ]; then
  echo "  ⚠ Found opencodeZen references that should be kiloGateway:"
  echo "$ZENREFS"
else
  echo "  ✓ No opencodeZen references found"
fi

echo ""
echo "=== Branding check complete ==="
echo ""
echo "If any issues were found above, you need to manually fix them:"
echo "1. Restore missing keys from git show origin/dev:$EN_FILE"
echo "2. Replace 'OpenCode' with 'Kilo CLI' in user-facing strings"
echo "3. Replace 'opencodeZen' with 'kiloGateway' if found"
echo ""
echo "To see what the correct en.ts looks like, run:"
echo "  git show origin/dev:$EN_FILE | grep -A2 -B2 'kilo'"
