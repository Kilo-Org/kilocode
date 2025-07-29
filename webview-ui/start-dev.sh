#!/bin/bash

# Kilocode Development Startup Script
# This script helps start all necessary processes for development

echo "🚀 Starting Kilocode Development Environment..."

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check prerequisites
echo "Checking prerequisites..."

if ! command_exists node; then
    echo -e "${RED}❌ Node.js is not installed${NC}"
    exit 1
fi

if ! command_exists npm; then
    echo -e "${RED}❌ npm is not installed${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Prerequisites check passed${NC}"

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ Not in the right directory. Please run from webview-ui directory${NC}"
    exit 1
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}📦 Installing dependencies...${NC}"
    npm install
fi

# Check parent directory node_modules
if [ ! -d "../node_modules" ]; then
    echo -e "${YELLOW}📦 Installing extension dependencies...${NC}"
    (cd .. && npm install)
fi

echo -e "${GREEN}✅ Dependencies installed${NC}"

# Start the webview dev server
echo -e "${YELLOW}🌐 Starting webview dev server...${NC}"
echo "Access the webview at: http://localhost:5173"
echo ""
echo "To start the extension:"
echo "1. Open VS Code in the extension root directory"
echo "2. Press F5 to start debugging"
echo ""
echo -e "${GREEN}Starting Vite dev server...${NC}"

# Start the dev server
npm run dev