#!/bin/bash

# Fix branding in locale/i18n files and other user-facing strings
# Run this after resolving conflicts to ensure consistent Kilo branding

set -e

echo "=== Fixing branding in locale files ==="

# Fix i18n locale files in packages/app
echo "Fixing packages/app/src/i18n/*.ts files..."
find packages/app/src/i18n -name "*.ts" -type f -exec sed -i '' -E 's/(^|[^a-zA-Z])opencode([^a-zA-Z]|$)/\1Kilo\2/gi' {} \; 2>/dev/null || true

# Fix any JSON locale files
echo "Fixing JSON locale files..."
find . -path ./node_modules -prune -o -name "*.json" -type f -print | xargs grep -l -i "opencode" 2>/dev/null | while read file; do
  # Skip package.json files (handled separately) and node_modules
  if [[ "$file" != *"package.json"* ]] && [[ "$file" != *"node_modules"* ]]; then
    echo "  Checking: $file"
    # Only replace user-facing strings, not code references
    sed -i '' -E 's/"opencode"/"Kilo"/gi' "$file" 2>/dev/null || true
  fi
done

echo ""
echo "=== Checking for remaining 'opencode' references ==="
echo ""

# Show remaining occurrences (excluding expected locations)
echo "User-facing occurrences to review:"
grep -r -i "opencode" \
  --include="*.ts" \
  --include="*.tsx" \
  --include="*.json" \
  --exclude-dir=node_modules \
  --exclude-dir=.git \
  --exclude="*package*.json" \
  . 2>/dev/null | grep -v "@opencode-ai" | head -20 || echo "  None found"

echo ""
echo "=== Branding fix complete ==="
echo ""
echo "Please manually review any remaining occurrences listed above."
echo "Some 'opencode' references are intentional (e.g., directory names, internal code)."
