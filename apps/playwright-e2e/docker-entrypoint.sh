#!/bin/bash
set -e

echo "=== Playwright CI with VSCode/Electron ==="

# Create .env.local with API key
echo "=== Setting up environment ==="
if [ -n "${OPENROUTER_API_KEY}" ]; then
    echo "OPENROUTER_API_KEY=${OPENROUTER_API_KEY}" > apps/playwright-e2e/.env.local
    echo "OPENROUTER_API_KEY configured!"
else
    echo "Warning: OPENROUTER_API_KEY not set"
    exit 1
fi

# Set up D-Bus for IPC communication (critical for VSCode webview communication)
echo "=== Setting up D-Bus for IPC ==="
export XDG_RUNTIME_DIR=/tmp/runtime-$(id -u)
mkdir -p $XDG_RUNTIME_DIR
chmod 700 $XDG_RUNTIME_DIR

# Start D-Bus session bus
eval $(dbus-launch --sh-syntax)
export DBUS_SESSION_BUS_ADDRESS
echo "D-Bus session started: $DBUS_SESSION_BUS_ADDRESS"

# Ensure test results and report directories have correct permissions
echo "=== Setting up output directories ==="
mkdir -p apps/playwright-e2e/test-results
mkdir -p apps/playwright-e2e/playwright-report
echo "Output directories created with correct ownership"

# Install pnpm deps
echo "Starting pnpm install..."
pnpm install --frozen-lockfile

echo "Dependencies installed successfully"
echo "=== Building webview for production ==="

pnpm --filter @roo-code/vscode-webview build
echo "Webview built successfully!"

# Run tests with xvfb-run for virtual display
echo "=== Running Playwright tests with xvfb-run ==="
cd apps/playwright-e2e
xvfb-run --auto-servernum --server-num=1 pnpm test:ci