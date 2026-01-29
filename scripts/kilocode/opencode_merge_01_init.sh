#!/bin/bash

set -e # fail immediately on error

# Check if a version/tag is provided as an argument
if [ -z "$1" ]; then
  echo "Usage: $0 <version> [prefix]"
  echo "Example: $0 v1.1.42"
  echo "Example with prefix: $0 v1.1.42 my_github_name"
  exit 1
fi

VERSION=$1
PREFIX=$2
BRANCH_PREFIX=""
if [ -n "$PREFIX" ]; then
  BRANCH_PREFIX="$PREFIX/"
fi

# Ensure upstream remote exists
echo "Ensuring upstream remote is configured..."
git remote add upstream git@github.com:sst/opencode.git 2>/dev/null || true

echo "Fetching latest changes and tags..."
git checkout dev
git pull
git fetch upstream --tags

echo "Creating branch for upstream at ${BRANCH_PREFIX}upstream-at-$VERSION and resetting to version..."
git checkout -b "${BRANCH_PREFIX}upstream-at-$VERSION" upstream/dev
git reset --hard "$VERSION" 2>/dev/null || git reset --hard "upstream/dev"

echo "Creating preparation branch ${BRANCH_PREFIX}upstream-prepared-$VERSION for pre-merge transformations..."
git checkout -b "${BRANCH_PREFIX}upstream-prepared-$VERSION"

echo ""
echo "=== NEXT STEPS ==="
echo "1. Run: ./scripts/kilocode/opencode_merge_02_prepare.sh"
echo "   This will apply naming transformations on the preparation branch"
echo ""
echo "2. Then run: ./scripts/kilocode/opencode_merge_03_start_merge.sh $VERSION $PREFIX"
echo "   This will create the merge branch and start the actual merge"
