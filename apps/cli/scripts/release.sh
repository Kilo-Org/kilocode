#!/bin/bash
# Roo Code CLI Release Script
#
# Usage:
#   ./apps/cli/scripts/release.sh [options] [version]
#
# Options:
#   --dry-run    Run all steps except creating the GitHub release
#   --local      Build for local testing only (no GitHub checks, no changelog prompts)
#   --install    Install locally after building (only with --local)
#   --skip-verify Skip end-to-end verification tests (faster local builds)
#
# Examples:
#   ./apps/cli/scripts/release.sh           # Use version from package.json
#   ./apps/cli/scripts/release.sh 0.1.0     # Specify version
#   ./apps/cli/scripts/release.sh --dry-run # Test the release flow without pushing
#   ./apps/cli/scripts/release.sh --dry-run 0.1.0  # Dry run with specific version
#   ./apps/cli/scripts/release.sh --local   # Build for local testing
#   ./apps/cli/scripts/release.sh --local --install  # Build and install locally
#   ./apps/cli/scripts/release.sh --local --skip-verify  # Fast local build
#
# This script:
# 1. Builds the extension and CLI
# 2. Creates a tarball for the current platform
# 3. Creates a GitHub release and uploads the tarball (unless --dry-run or --local)
#
# Prerequisites:
#   - GitHub CLI (gh) installed and authenticated (not needed for --local)
#   - pnpm installed
#   - Run from the monorepo root directory

set -e

# Parse arguments
DRY_RUN=false
LOCAL_BUILD=false
LOCAL_INSTALL=false
SKIP_VERIFY=false
VERSION_ARG=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --local)
            LOCAL_BUILD=true
            shift
            ;;
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
            VERSION_ARG="$1"
            shift
            ;;
    esac
done

# Validate option combinations
if [ "$LOCAL_INSTALL" = true ] && [ "$LOCAL_BUILD" = false ]; then
    echo "Error: --install can only be used with --local" >&2
    exit 1
fi

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
    step "1/8" "Checking prerequisites..."
    
    # Skip GitHub CLI checks for local builds
    if [ "$LOCAL_BUILD" = false ]; then
        if ! command -v gh &> /dev/null; then
            error "GitHub CLI (gh) is not installed. Install it with: brew install gh"
        fi
        
        if ! gh auth status &> /dev/null; then
            error "GitHub CLI is not authenticated. Run: gh auth login"
        fi
    fi
    
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
    if [ -n "$VERSION_ARG" ]; then
        VERSION="$VERSION_ARG"
    else
        VERSION=$(node -p "require('$CLI_DIR/package.json').version")
    fi
    
    # For local builds, append a local suffix with git short hash
    # This creates versions like: 0.1.0-local.abc1234
    if [ "$LOCAL_BUILD" = true ]; then
        GIT_SHORT_HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
        # Only append suffix if not already a local version
        if ! echo "$VERSION" | grep -qE '\-local\.'; then
            VERSION="${VERSION}-local.${GIT_SHORT_HASH}"
        fi
    fi
    
    # Validate semver format (allow -local.hash suffix)
    if ! echo "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$'; then
        error "Invalid version format: $VERSION (expected semver like 0.1.0)"
    fi
    
    TAG="cli-v$VERSION"
    info "Version: $VERSION (tag: $TAG)"
}

# Extract changelog content for a specific version
# Returns the content between the version header and the next version header (or EOF)
get_changelog_content() {
    CHANGELOG_FILE="$CLI_DIR/CHANGELOG.md"
    
    if [ ! -f "$CHANGELOG_FILE" ]; then
        warn "No CHANGELOG.md found at $CHANGELOG_FILE"
        CHANGELOG_CONTENT=""
        return
    fi
    
    # Try to find the version section (handles both "[0.0.43]" and "[0.0.43] - date" formats)
    # Also handles "Unreleased" marker
    VERSION_PATTERN="^\#\# \[${VERSION}\]"
    
    # Check if the version exists in the changelog
    if ! grep -qE "$VERSION_PATTERN" "$CHANGELOG_FILE"; then
        warn "No changelog entry found for version $VERSION"
        # Skip prompts for local builds
        if [ "$LOCAL_BUILD" = true ]; then
            info "Skipping changelog prompt for local build"
            CHANGELOG_CONTENT=""
            return
        fi
        warn "Please add an entry to $CHANGELOG_FILE before releasing"
        echo ""
        echo "Expected format:"
        echo "  ## [$VERSION] - $(date +%Y-%m-%d)"
        echo "  "
        echo "  ### Added"
        echo "  - Your changes here"
        echo ""
        read -p "Continue without changelog content? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            error "Aborted. Please add a changelog entry and try again."
        fi
        CHANGELOG_CONTENT=""
        return
    fi
    
    # Extract content between this version and the next version header (or EOF)
    # Uses awk to capture everything between ## [VERSION] and the next ## [
    # Using index() with "[VERSION]" ensures exact matching (1.0.1 won't match 1.0.10)
    CHANGELOG_CONTENT=$(awk -v version="$VERSION" '
        BEGIN { found = 0; content = ""; target = "[" version "]" }
        /^## \[/ {
            if (found) { exit }
            if (index($0, target) > 0) { found = 1; next }
        }
        found { content = content $0 "\n" }
        END { print content }
    ' "$CHANGELOG_FILE")
    
    # Trim leading/trailing whitespace
    CHANGELOG_CONTENT=$(echo "$CHANGELOG_CONTENT" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
    
    if [ -n "$CHANGELOG_CONTENT" ]; then
        info "Found changelog content for version $VERSION"
    else
        warn "Changelog entry for $VERSION appears to be empty"
    fi
}

# Build everything
build() {
    step "2/8" "Building extension bundle..."
    cd "$REPO_ROOT"
    pnpm bundle
    
    step "3/8" "Building CLI..."
    pnpm --filter @roo-code/cli build
    
    info "Build complete"
}

# Create release tarball
create_tarball() {
    step "4/8" "Creating release tarball for $PLATFORM..."
    
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
    
    # Create package.json for npm install (runtime dependencies that can't be bundled)
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
    
    # Add package.json to extension directory to mark it as CommonJS
    # This is necessary because the main package.json has "type": "module"
    # but the extension bundle is CommonJS
    echo '{"type": "commonjs"}' > "$RELEASE_DIR/extension/package.json"
    
    # Find and copy ripgrep binary
    # The extension looks for ripgrep at: appRoot/node_modules/@vscode/ripgrep/bin/rg
    # The CLI sets appRoot to the CLI package root, so we need to put ripgrep there
    info "Looking for ripgrep binary..."
    RIPGREP_PATH=$(find "$REPO_ROOT/node_modules" -path "*/@vscode/ripgrep/bin/rg" -type f 2>/dev/null | head -1)
    if [ -n "$RIPGREP_PATH" ] && [ -f "$RIPGREP_PATH" ]; then
        info "Found ripgrep at: $RIPGREP_PATH"
        # Create the expected directory structure for the extension to find ripgrep
        mkdir -p "$RELEASE_DIR/node_modules/@vscode/ripgrep/bin"
        cp "$RIPGREP_PATH" "$RELEASE_DIR/node_modules/@vscode/ripgrep/bin/"
        chmod +x "$RELEASE_DIR/node_modules/@vscode/ripgrep/bin/rg"
        # Also keep a copy in bin/ for direct access
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
// ROO_CLI_ROOT is the installed CLI package root (where node_modules/@vscode/ripgrep is)
process.env.ROO_CLI_ROOT = join(__dirname, '..');
process.env.ROO_EXTENSION_PATH = join(__dirname, '..', 'extension');
process.env.ROO_RIPGREP_PATH = join(__dirname, 'rg');

// Import and run the actual CLI
await import(join(__dirname, '..', 'lib', 'index.js'));
WRAPPER_EOF

    chmod +x "$RELEASE_DIR/bin/roo"
    
    # Create empty .env file to suppress dotenvx warnings
    touch "$RELEASE_DIR/.env"
    
    # Create empty .env file to suppress dotenvx warnings
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
        step "5/8" "Skipping verification (--skip-verify)"
        return
    fi
    
    step "5/8" "Verifying local installation..."
    
    VERIFY_DIR="$REPO_ROOT/.verify-release"
    VERIFY_INSTALL_DIR="$VERIFY_DIR/cli"
    VERIFY_BIN_DIR="$VERIFY_DIR/bin"
    
    # Clean up any previous verification directory
    rm -rf "$VERIFY_DIR"
    mkdir -p "$VERIFY_DIR"
    
    # Run the actual install script with the local tarball
    info "Running install script with local tarball..."
    TARBALL_PATH="$REPO_ROOT/$TARBALL"
    
    ROO_LOCAL_TARBALL="$TARBALL_PATH" \
    ROO_INSTALL_DIR="$VERIFY_INSTALL_DIR" \
    ROO_BIN_DIR="$VERIFY_BIN_DIR" \
    ROO_VERSION="$VERSION" \
    "$CLI_DIR/install.sh" || {
        echo ""
        warn "Install script failed. Showing tarball contents:"
        tar -tzf "$TARBALL_PATH" 2>&1 || true
        echo ""
        rm -rf "$VERIFY_DIR"
        error "Installation verification failed! The install script could not complete successfully."
    }
    
    # Verify the CLI runs correctly with basic commands
    info "Testing installed CLI..."
    
    # Test --help
    if ! "$VERIFY_BIN_DIR/roo" --help > /dev/null 2>&1; then
        echo ""
        warn "CLI --help output:"
        "$VERIFY_BIN_DIR/roo" --help 2>&1 || true
        echo ""
        rm -rf "$VERIFY_DIR"
        error "CLI --help check failed! The release tarball may have missing dependencies."
    fi
    info "CLI --help check passed"
    
    # Test --version
    if ! "$VERIFY_BIN_DIR/roo" --version > /dev/null 2>&1; then
        echo ""
        warn "CLI --version output:"
        "$VERIFY_BIN_DIR/roo" --version 2>&1 || true
        echo ""
        rm -rf "$VERIFY_DIR"
        error "CLI --version check failed! The release tarball may have missing dependencies."
    fi
    info "CLI --version check passed"
    
    # Run a simple end-to-end test to verify the CLI actually works
    info "Running end-to-end verification test..."
    
    # Create a temporary workspace for the test
    VERIFY_WORKSPACE="$VERIFY_DIR/workspace"
    mkdir -p "$VERIFY_WORKSPACE"
    
    # Run the CLI with a simple prompt
    # Use timeout to prevent hanging if something goes wrong
    if timeout 60 "$VERIFY_BIN_DIR/roo" --yes --exit-on-complete --prompt "1+1=?" "$VERIFY_WORKSPACE" > "$VERIFY_DIR/test-output.log" 2>&1; then
        info "End-to-end test passed"
    else
        EXIT_CODE=$?
        echo ""
        warn "End-to-end test failed (exit code: $EXIT_CODE). Output:"
        cat "$VERIFY_DIR/test-output.log" 2>&1 || true
        echo ""
        rm -rf "$VERIFY_DIR"
        error "CLI end-to-end test failed! The CLI may be broken."
    fi
    
    # Clean up verification directory
    cd "$REPO_ROOT"
    rm -rf "$VERIFY_DIR"
    
    info "Local verification passed!"
}

# Create checksum
create_checksum() {
    step "6/8" "Creating checksum..."
    cd "$REPO_ROOT"
    
    if command -v sha256sum &> /dev/null; then
        sha256sum "$TARBALL" > "${TARBALL}.sha256"
    elif command -v shasum &> /dev/null; then
        shasum -a 256 "$TARBALL" > "${TARBALL}.sha256"
    else
        warn "No sha256sum or shasum found, skipping checksum"
        return
    fi
    
    info "Checksum: $(cat "${TARBALL}.sha256")"
}

# Check if release already exists
check_existing_release() {
    step "7/8" "Checking for existing release..."
    
    if gh release view "$TAG" &> /dev/null; then
        warn "Release $TAG already exists"
        read -p "Do you want to delete it and create a new one? [y/N] " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            info "Deleting existing release..."
            gh release delete "$TAG" --yes
            # Also delete the tag if it exists
            git tag -d "$TAG" 2>/dev/null || true
            git push origin ":refs/tags/$TAG" 2>/dev/null || true
        else
            error "Aborted. Use a different version or delete the existing release manually."
        fi
    fi
}

# Create GitHub release
create_release() {
    step "8/8" "Creating GitHub release..."
    cd "$REPO_ROOT"

    # Get the current commit SHA for the release target
    COMMIT_SHA=$(git rev-parse HEAD)
    
    # Verify the commit exists on GitHub before attempting to create the release
    # This prevents the "Release.target_commitish is invalid" error
    info "Verifying commit ${COMMIT_SHA:0:8} exists on GitHub..."
    git fetch origin 2>/dev/null || true
    if ! git branch -r --contains "$COMMIT_SHA" 2>/dev/null | grep -q "origin/"; then
        warn "Commit ${COMMIT_SHA:0:8} has not been pushed to GitHub"
        echo ""
        echo "The release script needs to create a release at your current commit,"
        echo "but this commit hasn't been pushed to GitHub yet."
        echo ""
        read -p "Push current branch to origin now? [Y/n] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Nn]$ ]]; then
            info "Pushing to origin..."
            git push origin HEAD || error "Failed to push to origin. Please push manually and try again."
        else
            error "Aborted. Please push your commits to GitHub and try again."
        fi
    fi
    info "Commit verified on GitHub"

    # Build the What's New section from changelog content
    WHATS_NEW_SECTION=""
    if [ -n "$CHANGELOG_CONTENT" ]; then
        WHATS_NEW_SECTION="## What's New

$CHANGELOG_CONTENT

"
    fi
    
    RELEASE_NOTES=$(cat << EOF
${WHATS_NEW_SECTION}## Installation

\`\`\`bash
curl -fsSL https://raw.githubusercontent.com/RooCodeInc/Roo-Code/main/apps/cli/install.sh | sh
\`\`\`

Or install a specific version:
\`\`\`bash
ROO_VERSION=$VERSION curl -fsSL https://raw.githubusercontent.com/RooCodeInc/Roo-Code/main/apps/cli/install.sh | sh
\`\`\`

## Requirements

- Node.js 20 or higher
- macOS (Intel or Apple Silicon) or Linux (x64 or ARM64)

## Usage

\`\`\`bash
# Set your API key
export OPENROUTER_API_KEY=sk-or-v1-...

# Run a task
roo "What is this project?" ~/my-project

# See all options
roo --help
\`\`\`

## Platform Support

This release includes:
- \`roo-cli-${PLATFORM}.tar.gz\` - Built on $(uname -s) $(uname -m)

> **Note:** Additional platforms will be added as needed. If you need a different platform, please open an issue.

## Checksum

\`\`\`
$(cat "${TARBALL}.sha256" 2>/dev/null || echo "N/A")
\`\`\`
EOF
)

    info "Creating release at commit: ${COMMIT_SHA:0:8}"
    
    # Create release (gh will create the tag automatically)
    info "Creating release..."
    RELEASE_FILES="$TARBALL"
    if [ -f "${TARBALL}.sha256" ]; then
        RELEASE_FILES="$RELEASE_FILES ${TARBALL}.sha256"
    fi
    
    gh release create "$TAG" \
        --title "Roo Code CLI v$VERSION" \
        --notes "$RELEASE_NOTES" \
        --prerelease \
        --target "$COMMIT_SHA" \
        $RELEASE_FILES
    
    info "Release created!"
}

# Cleanup
cleanup() {
    info "Cleaning up..."
    cd "$REPO_ROOT"
    rm -f "$TARBALL" "${TARBALL}.sha256"
}

# Print summary
print_summary() {
    echo ""
    printf "${GREEN}${BOLD}✓ Release v$VERSION created successfully!${NC}\n"
    echo ""
    echo "  Release URL: https://github.com/RooCodeInc/Roo-Code/releases/tag/$TAG"
    echo ""
    echo "  Install with:"
    echo "    curl -fsSL https://raw.githubusercontent.com/RooCodeInc/Roo-Code/main/apps/cli/install.sh | sh"
    echo ""
}

# Print dry-run summary
print_dry_run_summary() {
    echo ""
    printf "${YELLOW}${BOLD}✓ Dry run complete for v$VERSION${NC}\n"
    echo ""
    echo "  The following artifacts were created:"
    echo "    - $TARBALL"
    if [ -f "${TARBALL}.sha256" ]; then
        echo "    - ${TARBALL}.sha256"
    fi
    echo ""
    echo "  To complete the release, run without --dry-run:"
    echo "    ./apps/cli/scripts/release.sh $VERSION"
    echo ""
    echo "  Or manually upload the tarball to a new GitHub release."
    echo ""
}

# Print local build summary
print_local_summary() {
    echo ""
    printf "${GREEN}${BOLD}✓ Local build complete for v$VERSION${NC}\n"
    echo ""
    echo "  Tarball: $REPO_ROOT/$TARBALL"
    if [ -f "${TARBALL}.sha256" ]; then
        echo "  Checksum: $REPO_ROOT/${TARBALL}.sha256"
    fi
    echo ""
    echo "  To install manually:"
    echo "    ROO_LOCAL_TARBALL=$REPO_ROOT/$TARBALL ./apps/cli/install.sh"
    echo ""
    echo "  Or re-run with --install to install automatically:"
    echo "    ./apps/cli/scripts/release.sh --local --install"
    echo ""
}

# Install locally using the install script
install_local() {
    step "7/8" "Installing locally..."
    
    TARBALL_PATH="$REPO_ROOT/$TARBALL"
    
    ROO_LOCAL_TARBALL="$TARBALL_PATH" \
    ROO_VERSION="$VERSION" \
    "$CLI_DIR/install.sh" || {
        error "Local installation failed!"
    }
    
    info "Local installation complete!"
}

# Print local install summary
print_local_install_summary() {
    echo ""
    printf "${GREEN}${BOLD}✓ Local build installed for v$VERSION${NC}\n"
    echo ""
    echo "  Tarball: $REPO_ROOT/$TARBALL"
    echo "  Installed to: ~/.roo/cli"
    echo "  Binary: ~/.local/bin/roo"
    echo ""
    echo "  Test it out:"
    echo "    roo --version"
    echo "    roo --help"
    echo ""
}

# Main
main() {
    echo ""
    printf "${BLUE}${BOLD}"
    echo "  ╭─────────────────────────────────╮"
    echo "  │   Roo Code CLI Release Script   │"
    echo "  ╰─────────────────────────────────╯"
    printf "${NC}"
    
    if [ "$DRY_RUN" = true ]; then
        printf "${YELLOW}         (DRY RUN MODE)${NC}\n"
    elif [ "$LOCAL_BUILD" = true ]; then
        printf "${YELLOW}         (LOCAL BUILD MODE)${NC}\n"
    fi
    echo ""
    
    detect_platform
    check_prerequisites
    get_version
    get_changelog_content
    build
    create_tarball
    verify_local_install
    create_checksum
    
    if [ "$LOCAL_BUILD" = true ]; then
        step "7/8" "Skipping GitHub checks (local build)"
        if [ "$LOCAL_INSTALL" = true ]; then
            install_local
            print_local_install_summary
        else
            step "8/8" "Skipping installation (use --install to auto-install)"
            print_local_summary
        fi
    elif [ "$DRY_RUN" = true ]; then
        step "7/8" "Skipping existing release check (dry run)"
        step "8/8" "Skipping GitHub release creation (dry run)"
        print_dry_run_summary
    else
        check_existing_release
        create_release
        cleanup
        print_summary
    fi
}

main
