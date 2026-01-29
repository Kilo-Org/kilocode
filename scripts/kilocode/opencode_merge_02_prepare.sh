#!/bin/bash

# This script prepares the upstream branch by applying naming transformations
# Run this on the upstream-prepared-<version> branch BEFORE merging into dev
# This reduces merge conflicts by aligning package names ahead of time

set -e

echo "=== Preparing upstream branch with Kilo naming conventions ==="

# Run the TypeScript transformation script for package.json files
echo "Applying package.json transformations..."
bun run ./scripts/kilocode/opencode_merge_transform_packages.ts

# Apply bin/command renaming
echo "Renaming bin entries..."
if [ -f "packages/opencode/bin/opencode" ]; then
  git mv packages/opencode/bin/opencode packages/opencode/bin/kilo 2>/dev/null || true
fi

# Stage all changes
git add -A

# Commit the preparation changes
git commit -m "chore: prepare upstream for kilo merge (rename packages)" || echo "No changes to commit"

echo ""
echo "=== Preparation complete ==="
echo "The upstream branch has been prepared with Kilo naming conventions."
echo ""
echo "Next step: Run ./scripts/kilocode/opencode_merge_03_start_merge.sh <version> [prefix]"
