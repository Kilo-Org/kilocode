#!/bin/bash

# Kilo Code Extension Debug Script
# This script compiles the extension and launches it in Trae for debugging

set -e  # Exit on any error

echo "🔧 Starting Kilo Code extension debug process..."

# Get the script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "📁 Working directory: $SCRIPT_DIR"

# Change to the project root
cd "$SCRIPT_DIR"

# Step 1: Clean and rebuild the project
echo "🧹 Cleaning and rebuilding the project..."
pnpm run bundle

if [ $? -ne 0 ]; then
    echo "❌ Build failed! Please check the errors above."
    exit 1
fi

echo "✅ Build completed successfully!"

# Step 2: Check if extension.js exists and is recent
EXTENSION_JS="$SCRIPT_DIR/src/dist/extension.js"
if [ ! -f "$EXTENSION_JS" ]; then
    echo "❌ extension.js not found at $EXTENSION_JS"
    exit 1
fi

echo "📦 Extension bundle found: $EXTENSION_JS"
echo "📅 Bundle timestamp: $(stat -f "%Sm" "$EXTENSION_JS")"

# Step 3: Launch Trae with the extension
echo "🚀 Launching Trae with Kilo Code extension..."
echo "📍 Extension path: $SCRIPT_DIR/src"

# Launch Trae in extension development mode
code --extensionDevelopmentPath="$SCRIPT_DIR/src" --new-window --verbose

echo "🎉 Trae launched! Check the new window for the Kilo Code extension."
echo "💡 If you encounter issues, check the Developer Console (Help > Toggle Developer Tools)"