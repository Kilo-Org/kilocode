#!/bin/bash

# Script to remove all directories in /apps which match configurable search patterns
# Default patterns: "web-" (configurable via SEARCH_PATTERNS variable)

set -e  # Exit on any error

# Configuration - Add multiple patterns separated by spaces (example: "web- vscode-nightly")
SEARCH_PATTERNS="web- vscode-nightly"

# Define the target directory (relative to project root)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
APP_DIR="$PROJECT_ROOT/apps"

if [ ! -d "$APP_DIR" ]; then
    echo "Error: Directory $APP_DIR does not exist"
    exit 1
fi

echo "Searching for directories matching patterns: $SEARCH_PATTERNS in $APP_DIR..."

MATCHING_DIRS=""
for pattern in $SEARCH_PATTERNS; do
    FOUND_DIRS=$(find "$APP_DIR" -maxdepth 1 -type d -name "*$pattern*" 2>/dev/null || true)
    if [ -n "$FOUND_DIRS" ]; then
        if [ -z "$MATCHING_DIRS" ]; then
            MATCHING_DIRS="$FOUND_DIRS"
        else
            MATCHING_DIRS="$MATCHING_DIRS
$FOUND_DIRS"
        fi
    fi
done

if [ -z "$MATCHING_DIRS" ]; then
    echo "No directories matching patterns '$SEARCH_PATTERNS' found in $APP_DIR"
    exit 0
fi

echo "Found the following directories to remove:"
echo "$MATCHING_DIRS"
echo

# Confirmation prompt
read -p "Are you sure you want to remove these directories? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Operation cancelled."
    exit 0
fi

# Remove the directories
echo "Removing directories..."
for dir in $MATCHING_DIRS; do
    if [ -d "$dir" ]; then
        echo "Removing: $dir"
        rm -rf "$dir"
        if [ $? -eq 0 ]; then
            echo "Successfully removed: $dir"
        else
            echo "Error removing: $dir"
        fi
    fi
done

echo "Operation completed."

