#!/bin/bash

set -e # fail immediately on error

# Check if a tag is provided as an argument
if [ -z "$1" ]; then
  echo "Usage: $0 <tag> [prefix]"
  echo "Example: $0 v3.15.5"
  echo "Example with prefix: $0 v3.15.5 my_github_name"
  exit 1
fi

TAG=$1
PREFIX=$2
BRANCH_PREFIX=""
if [ -n "$PREFIX" ]; then
  BRANCH_PREFIX="$PREFIX/"
fi

echo "Fetching latest changes and tags..."
git checkout main
git pull
git fetch upstream --tags

echo "Creating branch for upstream at ${BRANCH_PREFIX}upstream-at-$TAG and resetting to tag..."
git checkout -b "${BRANCH_PREFIX}upstream-at-$TAG" upstream/main
git reset --hard "$TAG"

echo "Creating new branch ${BRANCH_PREFIX}roo-$TAG and merging upstream changes..."
git checkout main
git checkout -b "${BRANCH_PREFIX}roo-$TAG"
git merge "${BRANCH_PREFIX}upstream-at-$TAG"

echo "Merge process initiated. Please review changes in branch ${BRANCH_PREFIX}roo-$TAG."