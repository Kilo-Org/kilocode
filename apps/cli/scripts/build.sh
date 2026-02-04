#!/bin/bash
# Roo Code CLI Local Build Script
#
# Usage:
#   ./apps/cli/scripts/build.sh [options]
#
# Options:
#   --install      Install locally after building
#   --skip-verify  Skip end-to-end verification tests (faster builds)
#
# Examples:
#   ./apps/cli/scripts/build.sh              # Build for local testing
#   ./apps/cli/scripts/build.sh --install    # Build and install locally
#   ./apps/cli/scripts/build.sh --skip-verify  # Fast local build
#
# This script builds the CLI for your current platform. For official releases
# with multi-platform support, use the GitHub Actions workflow instead:
#   .github/workflows/cli-release.yml
#
# Prerequisites:
#   - pnpm installed
#   - Run from the monorepo root directory

set -e

# Parse arguments
LOCAL_INSTALL=false
SKIP_VERIFY=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --install)
            LOCAL_INSTALL=true
            shift
            ;;
        --skip-verify)
            SKIP_VERIFY=true
            shift
            ;;
        -*)
            echo "Unknown option: $1" >&2
            exit 1
            ;;
        *)
            shift
            ;;
    esac
done

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

info() { printf "${GREEN}==>${NC} %s\n" "$1"; }
warn() { printf "${YELLOW}Warning:${NC} %s\n" "$1"; }
error() { printf "${RED}Error:${NC} %s\n" "$1" >&2; exit 1; }
step() { printf "${BLUE}${BOLD}[%s]${NC} %s\n" "$1" "$2"; }

# Get script directory and repo root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
CLI_DIR="$REPO_ROOT/apps/cli"

# Detect current platform
detect_platform() {
    OS=$(uname -s | tr '[:upper:]' '[:lower:]')
    ARCH=$(uname -m)

    case "$OS" in
        darwin) OS="darwin" ;;
        linux) OS="linux" ;;
        *) error "Unsupported OS: $OS" ;;
    esac

    case "$ARCH" in
        x86_64|amd64) ARCH="x64" ;;
        arm64|aarch64) ARCH="arm64" ;;
        *) error "Unsupported architecture: $ARCH" ;;
    esac

    PLATFORM="${OS}-${ARCH}"
}

# Check prerequisites
check_prerequisites() {
    step "1/6" "Checking prerequisites..."

    if ! command -v pnpm &> /dev/null; then
        error "pnpm is not installed."
    fi

    if ! command -v node &> /dev/null; then
        error "Node.js is not installed."
    fi

    info "Prerequisites OK"
}

# Get version
get_version() {
    VERSION=$(node -p "require('$CLI_DIR/package.json').version")
    GIT_SHORT_HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
    VERSION="${VERSION}-local.${GIT_SHORT_HASH}"

    info "Version: $VERSION"
}

# Build everything
build() {
    step "2/6" "Building extension bundle..."
    cd "$REPO_ROOT"
    pnpm bundle

    step "3/6" "Building CLI..."
    pnpm --filter @roo-code/cli build

    info "Build complete"
}

# Create release tarball
create_tarball() {
    step "4/6" "Creating release tarball for $PLATFORM..."

    RELEASE_DIR="$REPO_ROOT/roo-cli-${PLATFORM}"
    TARBALL="roo-cli-${PLATFORM}.tar.gz"

    # Clean up any previous build
    rm -rf "$RELEASE_DIR"
    rm -f "$REPO_ROOT/$TARBALL"

    # Create directory structure
    mkdir -p "$RELEASE_DIR/bin"
    mkdir -p "$RELEASE_DIR/lib"
    mkdir -p "$RELEASE_DIR/extension"

    # Copy CLI dist files
    info "Copying CLI files..."
    cp -r "$CLI_DIR/dist/"* "$RELEASE_DIR/lib/"

    # Create package.json for npm install
    info "Creating package.json..."
    node -e "
      const pkg = require('$CLI_DIR/package.json');
      const newPkg = {
        name: '@roo-code/cli',
        version: '$VERSION',
        type: 'module',
        dependencies: {
          '@inkjs/ui': pkg.dependencies['@inkjs/ui'],
          '@trpc/client': pkg.dependencies['@trpc/client'],
          'commander': pkg.dependencies.commander,
          'fuzzysort': pkg.dependencies.fuzzysort,
          'ink': pkg.dependencies.ink,
          'p-wait-for': pkg.dependencies['p-wait-for'],
          'react': pkg.dependencies.react,
          'superjson': pkg.dependencies.superjson,
          'zustand': pkg.dependencies.zustand
        }
      };
      console.log(JSON.stringify(newPkg, null, 2));
    " > "$RELEASE_DIR/package.json"

    # Copy extension bundle
    info "Copying extension bundle..."
    cp -r "$REPO_ROOT/src/dist/"* "$RELEASE_DIR/extension/"

    # Add package.json to extension directory for CommonJS
    echo '{"type": "commonjs"}' > "$RELEASE_DIR/extension/package.json"

    # Find and copy ripgrep binary
    info "Looking for ripgrep binary..."
    RIPGREP_PATH=$(find "$REPO_ROOT/node_modules" -path "*/@vscode/ripgrep/bin/rg" -type f 2>/dev/null | head -1)
    if [ -n "$RIPGREP_PATH" ] && [ -f "$RIPGREP_PATH" ]; then
        info "Found ripgrep at: $RIPGREP_PATH"
        mkdir -p "$RELEASE_DIR/node_modules/@vscode/ripgrep/bin"
        cp "$RIPGREP_PATH" "$RELEASE_DIR/node_modules/@vscode/ripgrep/bin/"
        chmod +x "$RELEASE_DIR/node_modules/@vscode/ripgrep/bin/rg"
        mkdir -p "$RELEASE_DIR/bin"
        cp "$RIPGREP_PATH" "$RELEASE_DIR/bin/"
        chmod +x "$RELEASE_DIR/bin/rg"
    else
        warn "ripgrep binary not found - users will need ripgrep installed"
    fi

    # Create the wrapper script
    info "Creating wrapper script..."
    cat > "$RELEASE_DIR/bin/roo" << 'WRAPPER_EOF'
#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Set environment variables for the CLI
process.env.ROO_CLI_ROOT = join(__dirname, '..');
process.env.ROO_EXTENSION_PATH = join(__dirname, '..', 'extension');
process.env.ROO_RIPGREP_PATH = join(__dirname, 'rg');

// Import and run the actual CLI
await import(join(__dirname, '..', 'lib', 'index.js'));
WRAPPER_EOF

    chmod +x "$RELEASE_DIR/bin/roo"

    # Create empty .env file
    touch "$RELEASE_DIR/.env"

    # Create tarball
    info "Creating tarball..."
    cd "$REPO_ROOT"
    tar -czvf "$TARBALL" "$(basename "$RELEASE_DIR")"

    # Clean up release directory
    rm -rf "$RELEASE_DIR"

    # Show size
    TARBALL_PATH="$REPO_ROOT/$TARBALL"
    TARBALL_SIZE=$(ls -lh "$TARBALL_PATH" | awk '{print $5}')
    info "Created: $TARBALL ($TARBALL_SIZE)"
}

# Verify local installation
verify_local_install() {
    if [ "$SKIP_VERIFY" = true ]; then
        step "5/6" "Skipping verification (--skip-verify)"
        return
    fi

    step "5/6" "Verifying installation..."

    VERIFY_DIR="$REPO_ROOT/.verify-release"
    VERIFY_INSTALL_DIR="$VERIFY_DIR/cli"
    VERIFY_BIN_DIR="$VERIFY_DIR/bin"

    rm -rf "$VERIFY_DIR"
    mkdir -p "$VERIFY_DIR"

    TARBALL_PATH="$REPO_ROOT/$TARBALL"

    ROO_LOCAL_TARBALL="$TARBALL_PATH" \
    ROO_INSTALL_DIR="$VERIFY_INSTALL_DIR" \
    ROO_BIN_DIR="$VERIFY_BIN_DIR" \
    ROO_VERSION="$VERSION" \
    "$CLI_DIR/install.sh" || {
        rm -rf "$VERIFY_DIR"
        error "Installation verification failed!"
    }

    # Test --help
    if ! "$VERIFY_BIN_DIR/roo" --help > /dev/null 2>&1; then
        rm -rf "$VERIFY_DIR"
        error "CLI --help check failed!"
    fi
    info "CLI --help check passed"

    # Test --version
    if ! "$VERIFY_BIN_DIR/roo" --version > /dev/null 2>&1; then
        rm -rf "$VERIFY_DIR"
        error "CLI --version check failed!"
    fi
    info "CLI --version check passed"

    cd "$REPO_ROOT"
    rm -rf "$VERIFY_DIR"

    info "Verification passed!"
}

# Install locally
install_local() {
    if [ "$LOCAL_INSTALL" = false ]; then
        step "6/6" "Skipping install (use --install to auto-install)"
        return
    fi

    step "6/6" "Installing locally..."

    TARBALL_PATH="$REPO_ROOT/$TARBALL"

    ROO_LOCAL_TARBALL="$TARBALL_PATH" \
    ROO_VERSION="$VERSION" \
    "$CLI_DIR/install.sh" || {
        error "Local installation failed!"
    }

    info "Local installation complete!"
}

# Print summary
print_summary() {
    echo ""
    printf "${GREEN}${BOLD}✓ Local build complete for v$VERSION${NC}\n"
    echo ""
    echo "  Tarball: $REPO_ROOT/$TARBALL"
    echo ""

    if [ "$LOCAL_INSTALL" = true ]; then
        echo "  Installed to: ~/.roo/cli"
        echo "  Binary: ~/.local/bin/roo"
        echo ""
        echo "  Test it out:"
        echo "    roo --version"
        echo "    roo --help"
    else
        echo "  To install manually:"
        echo "    ROO_LOCAL_TARBALL=$REPO_ROOT/$TARBALL ./apps/cli/install.sh"
        echo ""
        echo "  Or re-run with --install:"
        echo "    ./apps/cli/scripts/build.sh --install"
    fi
    echo ""
    echo "  For official multi-platform releases, use the GitHub Actions workflow:"
    echo "    .github/workflows/cli-release.yml"
    echo ""
}

# Main
main() {
    echo ""
    printf "${BLUE}${BOLD}"
    echo "  ╭─────────────────────────────────╮"
    echo "  │   Roo Code CLI Local Build      │"
    echo "  ╰─────────────────────────────────╯"
    printf "${NC}"
    echo ""

    detect_platform
    check_prerequisites
    get_version
    build
    create_tarball
    verify_local_install
    install_local
    print_summary
}

main
