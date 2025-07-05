#!/bin/bash

# Script to simulate GitHub CI Playwright environment locally with Chrome sandbox support
# Usage:
#   ./run-playwright-ciulation.sh           # Run tests with existing image
#   ./run-playwright-ciulation.sh --build   # Rebuild image and run tests

set -e

# Compact color output function
print() { local c='\033[0m'; case $1 in status) c='\033[0;34m🔧';; success) c='\033[0;32m✅';; error) c='\033[0;31m❌';; warning) c='\033[1;33m⚠️';; esac; echo -e "${c}\033[0m $2"; }

# Parse command line arguments
REBUILD_IMAGE=false
for arg in "$@"; do
    case $arg in
        --build)
            REBUILD_IMAGE=true
            shift
            ;;
        *)
            print error "Unknown option: $arg"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Ensure WORKSPACE_ROOT is set
if [ -z "$WORKSPACE_ROOT" ]; then
    WORKSPACE_ROOT="$(cd ../.. && pwd)"
fi

# Check if OPENROUTER_API_KEY is set
if [ -z "$OPENROUTER_API_KEY" ]; then
    print error "OPENROUTER_API_KEY environment variable is not set"
    echo "Please set it with: export OPENROUTER_API_KEY='your-api-key-here'"
    exit 1
fi

# Check if image exists and decide whether to build
IMAGE_EXISTS=$(docker images -q playwright-ci 2>/dev/null)

if [ "$REBUILD_IMAGE" = true ] || [ -z "$IMAGE_EXISTS" ]; then
    print status "Building Playwright CI simulation Docker image..."
    # Get the workspace root directory (two levels up from apps/playwright-e2e)
    docker build -f "${WORKSPACE_ROOT}/apps/playwright-e2e/Dockerfile.playwright-ci" -t playwright-ci "${WORKSPACE_ROOT}"
else
    print success "Using existing Docker image (playwright-ci)"
    echo "   • To rebuild the image, use: $0 --build"
    echo "   • Source code will be mounted from host for live updates"
    echo
fi



mkdir -p "${WORKSPACE_ROOT}/apps/playwright-e2e/test-results"
mkdir -p "${WORKSPACE_ROOT}/apps/playwright-e2e/playwright-report"

print status "Running Playwright tests in Docker with isolated node_modules..."

docker run --rm \
    -v "${WORKSPACE_ROOT}:/workspace" \
    -v "${WORKSPACE_ROOT}/apps/playwright-e2e/test-results:/workspace/apps/playwright-e2e/test-results" \
    -v "${WORKSPACE_ROOT}/apps/playwright-e2e/playwright-report:/workspace/apps/playwright-e2e/playwright-report" \
    -v "playwright-pnpm-store:/workspace/.pnpm-store" \
    -v "playwright-node-modules:/workspace/node_modules" \
    -e "OPENROUTER_API_KEY" \
    playwright-ci
