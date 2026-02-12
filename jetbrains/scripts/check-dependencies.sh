#!/bin/bash

# JetBrains Plugin Dependency Check Script
# This script verifies and sets up all required dependencies for building the JetBrains plugin

# Note: Removed 'set -e' to prevent silent failures in CI
# We'll handle errors explicitly in each function

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
JETBRAINS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo -e "${BLUE}🔍 JetBrains Plugin Dependency Check${NC}"
echo "Project root: $PROJECT_ROOT"
echo "JetBrains dir: $JETBRAINS_DIR"
echo ""

# Track issues found
ISSUES_FOUND=0
FIXES_APPLIED=0

# Function to print status messages
print_status() {
    echo -e "${BLUE}[CHECK]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[⚠]${NC} $1"
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
    ((ISSUES_FOUND++))
}

print_fix() {
    echo -e "${GREEN}[FIX]${NC} $1"
    ((FIXES_APPLIED++))
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check Java version
check_java() {
    print_status "Checking Java installation..."
    
    if ! command_exists java; then
        print_error "Java is not installed or not in PATH"
        echo "  Install Java 21 (recommended - SDKMAN):"
        echo "  - curl -s \"https://get.sdkman.io\" | bash"
        echo "  - source ~/.sdkman/bin/sdkman-init.sh"
        echo "  - sdk install java 21.0.5-tem"
        echo "  - sdk use java 21.0.5-tem"
        echo ""
        echo "  Alternative installations:"
        echo "  - macOS: brew install openjdk@21"
        echo "  - Linux: sudo apt install openjdk-21-jdk"
        echo "  - Windows: Download from https://openjdk.org/projects/jdk/21/"
        return 1
    fi
    
    JAVA_VERSION=$(java -version 2>&1 | head -n1 | cut -d'"' -f2 | cut -d'.' -f1)
    if [[ "$JAVA_VERSION" != "21" ]]; then
        print_error "Java version is $JAVA_VERSION, but Java 21 is required"
        echo "  Current Java: $(java -version 2>&1 | head -n1)"
        echo "  Recommended fix (SDKMAN):"
        echo "  - sdk install java 21.0.5-tem"
        echo "  - sdk use java 21.0.5-tem"
        echo ""
        echo "  Alternative: Set JAVA_HOME to Java 21 installation"
        return 1
    fi
    
    print_success "Java 21 is installed and active"
    java -version 2>&1 | head -n1 | sed 's/^/  /'
    return 0
}

# Check Node.js version
check_node() {
    print_status "Checking Node.js installation..."
    
    if ! command_exists node; then
        print_error "Node.js is not installed"
        echo "  Install Node.js 20.x:"
        echo "  - Use nvm: nvm install 20 && nvm use 20"
        echo "  - Or download from: https://nodejs.org/"
        return 1
    fi
    
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [[ "$NODE_VERSION" != "20" ]]; then
        print_warning "Node.js version is $NODE_VERSION, recommended version is 20.x"
        echo "  Current Node.js: $(node -v)"
    else
        print_success "Node.js 20.x is installed"
        echo "  Version: $(node -v)"
    fi
    return 0
}

# Check pnpm installation
check_pnpm() {
    print_status "Checking pnpm installation..."
    
    if ! command_exists pnpm; then
        print_error "pnpm is not installed"
        echo "  Install pnpm: npm install -g pnpm"
        return 1
    fi
    
    print_success "pnpm is installed"
    echo "  Version: $(pnpm -v)"
    return 0
}

# Check and initialize VSCode submodule
check_vscode_submodule() {
    print_status "Checking VSCode submodule..."
    
    VSCODE_DIR="$PROJECT_ROOT/deps/vscode"
    
    if [[ ! -d "$VSCODE_DIR" ]]; then
        print_error "VSCode submodule directory not found: $VSCODE_DIR"
        return 1
    fi
    
    if [[ ! -d "$VSCODE_DIR/src" ]] || [[ -z "$(ls -A "$VSCODE_DIR/src" 2>/dev/null)" ]]; then
        print_warning "VSCode submodule is not initialized"
        echo "  Initializing VSCode submodule..."
        
        cd "$PROJECT_ROOT"
        if git submodule update --init --recursive; then
            print_fix "VSCode submodule initialized successfully"
            # Ensure filesystem sync in CI environments
            sleep 2
            # Force filesystem sync
            sync 2>/dev/null || true
        else
            print_error "Failed to initialize VSCode submodule"
            return 1
        fi
    else
        print_success "VSCode submodule is initialized"
    fi
    
    # Check if submodule has content - with retry for CI environments
    EXPECTED_FILE="$VSCODE_DIR/src/vs/code/electron-main/main.ts"
    RETRY_COUNT=0
    MAX_RETRIES=3
    
    while [[ $RETRY_COUNT -lt $MAX_RETRIES ]]; do
        if [[ -f "$EXPECTED_FILE" ]]; then
            print_success "VSCode submodule contains expected files"
            break
        else
            if [[ $RETRY_COUNT -eq 0 ]]; then
                print_warning "VSCode submodule file check failed, retrying..."
            fi
            ((RETRY_COUNT++))
            if [[ $RETRY_COUNT -lt $MAX_RETRIES ]]; then
                echo "  Waiting 2 seconds before retry $RETRY_COUNT/$MAX_RETRIES..."
                sleep 2
            else
                print_error "VSCode submodule appears to be incomplete after $MAX_RETRIES attempts"
                echo "  Expected file: $EXPECTED_FILE"
                echo "  Directory contents:"
                ls -la "$VSCODE_DIR/src/vs/code/electron-main/" 2>/dev/null || echo "    Directory does not exist"
                echo "  Try: git submodule update --init --recursive --force"
                return 1
            fi
        fi
    done
    return 0
}

# Check Gradle wrapper
check_gradle() {
    print_status "Checking Gradle wrapper..."
    
    GRADLE_WRAPPER="$JETBRAINS_DIR/plugin/gradlew"
    
    if [[ ! -f "$GRADLE_WRAPPER" ]]; then
        print_error "Gradle wrapper not found: $GRADLE_WRAPPER"
        return 1
    fi
    
    if [[ ! -x "$GRADLE_WRAPPER" ]]; then
        print_warning "Gradle wrapper is not executable, fixing..."
        chmod +x "$GRADLE_WRAPPER"
        print_fix "Made Gradle wrapper executable"
    fi
    
    print_success "Gradle wrapper is available"
    return 0
}

# Check project dependencies
check_project_dependencies() {
    print_status "Checking project dependencies..."
    
    cd "$PROJECT_ROOT"
    
    if [[ ! -d "node_modules" ]] || [[ ! -f "pnpm-lock.yaml" ]]; then
        print_warning "Project dependencies not installed"
        echo "  Installing dependencies with pnpm..."
        
        if pnpm install; then
            print_fix "Project dependencies installed successfully"
        else
            print_error "Failed to install project dependencies"
            return 1
        fi
    else
        print_success "Project dependencies are installed"
    fi
    
    return 0
}

# Check JetBrains host dependencies
check_jetbrains_host_deps() {
    print_status "Checking JetBrains host dependencies..."
    
    HOST_DIR="$JETBRAINS_DIR/host"
    cd "$HOST_DIR"
    
    # Quick check - verify package.json and dist directory exist or can be built
    if [[ -f "package.json" ]] && [[ -f "tsconfig.json" ]]; then
        print_success "JetBrains host is configured"
    else
        print_error "JetBrains host configuration files are missing"
        echo "  Missing files: package.json or tsconfig.json"
        return 1
    fi
    
    return 0
}

# Check build system
check_build_system() {
    print_status "Checking build system..."
    
    cd "$JETBRAINS_DIR/plugin"
    
    # Quick check - just verify Gradle wrapper and build files exist
    if [[ -f "./gradlew" ]] && [[ -f "build.gradle.kts" ]] && [[ -f "gradle.properties" ]]; then
        print_success "Gradle build system is configured"
    else
        print_error "Gradle build system files are missing"
        echo "  Missing files: gradlew, build.gradle.kts, or gradle.properties"
        return 1
    fi
    
    return 0
}


# Main execution
main() {
    echo "Starting dependency checks..."
    echo ""
    
    # Run all checks with error handling
    check_java || echo "Warning: Java check had issues"
    check_node || echo "Warning: Node check had issues"
    check_pnpm || echo "Warning: pnpm check had issues"
    check_vscode_submodule || echo "Warning: VSCode submodule check had issues"
    check_gradle || echo "Warning: Gradle check had issues"
    check_project_dependencies || echo "Warning: Project dependencies check had issues"
    check_jetbrains_host_deps || echo "Warning: JetBrains host deps check had issues"
    check_build_system || echo "Warning: Build system check had issues"
    
    echo ""
    echo "=================================="
    
    if [[ $ISSUES_FOUND -eq 0 ]]; then
        print_success "All dependencies are properly configured!"
        echo ""
        echo "You can now build the JetBrains plugin:"
        echo "  Development: pnpm jetbrains:run"
        echo "  Production:  cd jetbrains/plugin && ./gradlew buildPlugin -PdebugMode=release"
    else
        print_error "Found $ISSUES_FOUND issue(s) that need to be resolved"
        if [[ $FIXES_APPLIED -gt 0 ]]; then
            echo -e "${GREEN}Applied $FIXES_APPLIED automatic fix(es)${NC}"
        fi
        echo ""
        echo "Please resolve the issues above and run this script again."
        exit 1
    fi
    
    echo ""
    echo "For more information, see jetbrains/README.md"
}

# Run main function
main "$@"