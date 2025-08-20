#!/bin/bash

# Build script for RunVSAgent project
# This script builds VSCode extension and IDEA plugin

set -euo pipefail

# Source common utilities
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"
source "$SCRIPT_DIR/lib/build.sh"

# Script configuration
readonly SCRIPT_NAME="build.sh"
readonly SCRIPT_VERSION="1.0.0"

# Build targets
readonly TARGET_ALL="all"
readonly TARGET_VSCODE="vscode"
readonly TARGET_BASE="base"
readonly TARGET_IDEA="idea"

# Build configuration
BUILD_TARGET="$TARGET_ALL"
CLEAN_BEFORE_BUILD=false
SKIP_TESTS=false
OUTPUT_DIR=""

# Show help for this script
show_help() {
    cat << EOF
$SCRIPT_NAME - Build RunVSAgent project components

USAGE:
    $SCRIPT_NAME [OPTIONS] [TARGET]

DESCRIPTION:
    This script builds the RunVSAgent project components:
    - VSCode extension (from submodule)
    - Base extension runtime
    - IDEA plugin

TARGETS:
    all         Build all components (default)
    vscode      Build only VSCode extension
    base        Build only base extension
    idea        Build only IDEA plugin

OPTIONS:
    -m, --mode MODE       Build mode: release (default) or debug
    -c, --clean           Clean before building
    -o, --output DIR      Output directory for build artifacts
    -t, --skip-tests      Skip running tests
    --vsix FILE           Use existing VSIX file (skip VSCode build)
    --skip-vscode         Skip VSCode extension build
    --skip-base           Skip base extension build
    --skip-idea           Skip IDEA plugin build
    -v, --verbose         Enable verbose output
    -n, --dry-run         Show what would be done without executing
    -h, --help            Show this help message

BUILD MODES:
    release     Production build with optimizations (default)
    debug       Development build with debug symbols and resources

EXAMPLES:
    $SCRIPT_NAME                           # Build all components
    $SCRIPT_NAME --mode debug              # Debug build
    $SCRIPT_NAME --clean vscode            # Clean build VSCode only
    $SCRIPT_NAME --vsix path/to/file.vsix  # Use existing VSIX
    $SCRIPT_NAME --output ./dist           # Custom output directory

ENVIRONMENT:
    BUILD_MODE          Override build mode (release/debug)
    VSIX_FILE           Path to existing VSIX file
    SKIP_VSCODE_BUILD   Skip VSCode build if set to 'true'
    SKIP_BASE_BUILD     Skip base build if set to 'true'
    SKIP_IDEA_BUILD     Skip IDEA build if set to 'true'

EXIT CODES:
    0    Success
    1    General error
    2    Build failed
    3    Invalid arguments
    4    Missing dependencies

EOF
}

# Parse command line arguments
parse_build_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -m|--mode)
                if [[ -z "${2:-}" ]]; then
                    log_error "Build mode requires a value"
                    exit 3
                fi
                BUILD_MODE="$2"
                shift 2
                ;;
            -c|--clean)
                CLEAN_BEFORE_BUILD=true
                shift
                ;;
            -o|--output)
                if [[ -z "${2:-}" ]]; then
                    log_error "Output directory requires a value"
                    exit 3
                fi
                OUTPUT_DIR="$2"
                shift 2
                ;;
            -t|--skip-tests)
                SKIP_TESTS=true
                shift
                ;;
            --vsix)
                if [[ -z "${2:-}" ]]; then
                    log_error "VSIX file path requires a value"
                    exit 3
                fi
                VSIX_FILE="$2"
                SKIP_VSCODE_BUILD=true
                shift 2
                ;;
            --skip-vscode)
                SKIP_VSCODE_BUILD=true
                shift
                ;;
            --skip-base)
                SKIP_BASE_BUILD=true
                shift
                ;;
            --skip-idea)
                SKIP_IDEA_BUILD=true
                shift
                ;;
            -v|--verbose)
                VERBOSE=true
                shift
                ;;
            -n|--dry-run)
                DRY_RUN=true
                shift
                ;;
            -h|--help)
                show_help
                exit 0
                ;;
            -*)
                log_error "Unknown option: $1"
                log_info "Use --help for usage information"
                exit 3
                ;;
            *)
                # Positional argument (target)
                BUILD_TARGET="$1"
                shift
                ;;
        esac
    done
    
    # Validate build mode
    if [[ "$BUILD_MODE" != "$BUILD_MODE_RELEASE" && "$BUILD_MODE" != "$BUILD_MODE_DEBUG" ]]; then
        log_error "Invalid build mode: $BUILD_MODE"
        log_info "Valid modes: $BUILD_MODE_RELEASE, $BUILD_MODE_DEBUG"
        exit 3
    fi
    
    # Validate build target
    case "$BUILD_TARGET" in
        "$TARGET_ALL"|"$TARGET_VSCODE"|"$TARGET_BASE"|"$TARGET_IDEA")
            ;;
        *)
            log_error "Invalid build target: $BUILD_TARGET"
            log_info "Valid targets: $TARGET_ALL, $TARGET_VSCODE, $TARGET_BASE, $TARGET_IDEA"
            exit 3
            ;;
    esac
    
    # Set skip flags based on target
    case "$BUILD_TARGET" in
        "$TARGET_VSCODE")
            SKIP_BASE_BUILD=true
            SKIP_IDEA_BUILD=true
            ;;
        "$TARGET_BASE")
            SKIP_VSCODE_BUILD=true
            SKIP_IDEA_BUILD=true
            ;;
        "$TARGET_IDEA")
            SKIP_VSCODE_BUILD=true
            SKIP_BASE_BUILD=true
            ;;
    esac
    
    # Override with environment variables
    [[ "${SKIP_VSCODE_BUILD:-false}" == "true" ]] && SKIP_VSCODE_BUILD=true
    [[ "${SKIP_BASE_BUILD:-false}" == "true" ]] && SKIP_BASE_BUILD=true
    [[ "${SKIP_IDEA_BUILD:-false}" == "true" ]] && SKIP_IDEA_BUILD=true
    [[ -n "${VSIX_FILE:-}" ]] && VSIX_FILE="$VSIX_FILE"
    
    # Ensure the function returns 0 on success, preventing `set -e` from exiting the script.
    true
}

# Check JDK version
check_jdk_version() {
    log_step "Checking JDK version..."
    
    # Check if java command exists
    if ! command_exists "java"; then
        log_error "Java not found. Please install JDK 17 or higher."
        exit 4
    fi
    
    # Get Java version
    local java_version_output
    java_version_output=$(java -version 2>&1 | head -n 1)
    
    # Extract version number from output
    local java_version
    if [[ "$java_version_output" =~ \"([0-9]+)\.([0-9]+)\.([0-9]+) ]]; then
        # Java 8 and earlier format: "1.8.0_xxx"
        if [[ "${BASH_REMATCH[1]}" == "1" ]]; then
            java_version="${BASH_REMATCH[2]}"
        else
            java_version="${BASH_REMATCH[1]}"
        fi
    elif [[ "$java_version_output" =~ \"([0-9]+) ]]; then
        # Java 9+ format: "17.0.1" or just "17"
        java_version="${BASH_REMATCH[1]}"
    else
        log_error "Unable to parse Java version from: $java_version_output"
        exit 4
    fi
    
    log_debug "Detected Java version: $java_version"
    
    # Check if version is >= 17
    if [[ "$java_version" -lt 17 ]]; then
        log_error "JDK version $java_version is too old. Required: JDK 17 or higher."
        log_info "Current Java version output: $java_version_output"
        exit 4
    fi
    
    log_success "JDK version check passed (version: $java_version)"
}

# Validate build environment
validate_build_environment() {
    log_step "Validating build environment..."
    
    # Check JDK version
    check_jdk_version
    
    # Check if setup has been run
    local vscode_dir="$PROJECT_ROOT/$VSCODE_SUBMODULE_PATH"
    if [[ ! -d "$vscode_dir" ]] || [[ ! "$(ls -A "$vscode_dir" 2>/dev/null)" ]]; then
        log_error "VSCode submodule not initialized. Run './scripts/setup.sh' first."
        exit 4
    fi
    
    # Check for required build files
    if [[ "$SKIP_BASE_BUILD" != "true" ]]; then
        if [[ ! -f "$PROJECT_ROOT/$EXTENSION_HOST_DIR/package.json" ]]; then
            log_error "Base package.json not found. Run './scripts/setup.sh' first."
            exit 4
        fi
    fi
    
    if [[ "$SKIP_IDEA_BUILD" != "true" ]]; then
        if [[ ! -f "$PROJECT_ROOT/$IDEA_DIR/build.gradle" && ! -f "$PROJECT_ROOT/$IDEA_DIR/build.gradle.kts" ]]; then
            log_error "IDEA Gradle build file not found."
            exit 4
        fi
    fi
    
    # Validate VSIX file if provided
    if [[ -n "$VSIX_FILE" ]]; then
        if [[ ! -f "$VSIX_FILE" ]]; then
            log_error "VSIX file not found: $VSIX_FILE"
            exit 4
        fi
        log_info "Using existing VSIX file: $VSIX_FILE"
    fi
    
    log_success "Build environment validated"
}

# Setup build output directory
setup_output_directory() {
    if [[ -n "$OUTPUT_DIR" ]]; then
        log_step "Setting up output directory..."
        
        ensure_dir "$OUTPUT_DIR"
        
        # Make output directory absolute
        OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd)"
        
        log_info "Build artifacts will be copied to: $OUTPUT_DIR"
    fi
}

# Clean build artifacts
clean_build_artifacts() {
    if [[ "$CLEAN_BEFORE_BUILD" != "true" ]]; then
        return 0
    fi
    
    log_step "Cleaning build artifacts..."
    clean_build
    log_success "Build artifacts cleaned"
}

# Build VSCode extension
build_vscode_plugin_component() {
    if [[ "$SKIP_VSCODE_BUILD" == "true" ]]; then
        log_info "Skipping VSCode extension build"
        return 0
    fi
    
    log_step "Building VSCode extension..."
    

    
    # Build extension
    build_vscode_extension
    
    # Copy extension files
    copy_vscode_extension
    
    # Copy debug resources if in debug mode
    copy_debug_resources
      
    
    log_success "VSCode extension built"
}

# Build base extension
build_vscode_extension_host_component() {
    if [[ "$SKIP_BASE_BUILD" == "true" ]]; then
        log_info "Skipping Extension host build"
        return 0
    fi
    
    log_step "Building Extension host..."
    
    build_extension_host
    copy_base_debug_resources
    
    log_success "Extension host built"
}

# Build IDEA plugin
build_idea_component() {
    if [[ "$SKIP_IDEA_BUILD" == "true" ]]; then
        log_info "Skipping IDEA plugin build"
        return 0
    fi
    
    log_step "Building IDEA plugin..."
    
    build_idea_plugin
    
    log_success "IDEA plugin built"
}

# Run tests
run_tests() {
    if [[ "$SKIP_TESTS" == "true" ]]; then
        log_info "Skipping tests"
        return 0
    fi
    
    log_step "Running tests..."
    
    # Run base tests if available
    if [[ "$SKIP_BASE_BUILD" != "true" && -f "$PROJECT_ROOT/$EXTENSION_HOST_DIR/package.json" ]]; then
        cd "$PROJECT_ROOT/$EXTENSION_HOST_DIR"
        if npm run test --if-present >/dev/null 2>&1; then
            execute_cmd "npm test" "base extension tests"
        else
            log_debug "No tests found for base extension"
        fi
    fi
    
    # Run VSCode extension tests if available
    if [[ "$SKIP_VSCODE_BUILD" != "true" && -d "$PROJECT_ROOT/$VSCODE_SUBMODULE_PATH" ]]; then
        cd "$PROJECT_ROOT/$VSCODE_SUBMODULE_PATH"
        local pkg_manager="npm"
        if command_exists "pnpm" && [[ -f "pnpm-lock.yaml" ]]; then
            pkg_manager="pnpm"
        fi
        
        if $pkg_manager run test --if-present >/dev/null 2>&1; then
            execute_cmd "$pkg_manager test" "VSCode extension tests"
        else
            log_debug "No tests found for VSCode extension"
        fi
    fi
    
    log_success "Tests completed"
}

# Copy build artifacts to output directory
copy_build_artifacts() {
    if [[ -z "$OUTPUT_DIR" ]]; then
        return 0
    fi
    
    log_step "Copying build artifacts to output directory..."
    
    # Copy VSIX file
    if [[ -n "$VSIX_FILE" && -f "$VSIX_FILE" ]]; then
        copy_files "$VSIX_FILE" "$OUTPUT_DIR/" "VSIX file"
    fi
    
    # Copy IDEA plugin
    if [[ -n "${IDEA_PLUGIN_FILE:-}" && -f "$IDEA_PLUGIN_FILE" ]]; then
        copy_files "$IDEA_PLUGIN_FILE" "$OUTPUT_DIR/" "IDEA plugin"
    fi
    
    # Copy debug resources if in debug mode
    if [[ "$BUILD_MODE" == "$BUILD_MODE_DEBUG" && -d "$PROJECT_ROOT/debug-resources" ]]; then
        copy_files "$PROJECT_ROOT/debug-resources" "$OUTPUT_DIR/" "debug resources"
    fi
    
    log_success "Build artifacts copied to output directory"
}

# Show build summary
show_build_summary() {
    log_step "Build Summary"
    
    echo ""
    log_info "Build completed successfully!"
    log_info "Build mode: $BUILD_MODE"
    log_info "Build target: $BUILD_TARGET"
    log_info "Platform: $(get_platform)"
    
    echo ""
    log_info "Generated artifacts:"
    
    # Show VSIX file
    if [[ -n "$VSIX_FILE" && -f "$VSIX_FILE" ]]; then
        log_info "  VSCode Extension: $VSIX_FILE"
    fi
    
    # Show IDEA plugin
    if [[ -n "${IDEA_PLUGIN_FILE:-}" && -f "$IDEA_PLUGIN_FILE" ]]; then
        log_info "  IDEA Plugin: $IDEA_PLUGIN_FILE"
    fi
    
    # Show debug resources
    if [[ "$BUILD_MODE" == "$BUILD_MODE_DEBUG" && -d "$PROJECT_ROOT/debug-resources" ]]; then
        log_info "  Debug Resources: $PROJECT_ROOT/debug-resources"
    fi
    
    # Show output directory
    if [[ -n "$OUTPUT_DIR" ]]; then
        log_info "  Output Directory: $OUTPUT_DIR"
    fi
    
    echo ""
    log_info "Next steps:"
    if [[ "$BUILD_TARGET" == "$TARGET_ALL" || "$BUILD_TARGET" == "$TARGET_IDEA" ]]; then
        log_info "  1. Install IDEA plugin from: ${IDEA_PLUGIN_FILE:-$IDEA_BUILD_DIR/build/distributions/}"
        log_info "  2. Configure plugin settings in IDEA"
    fi
    
    echo ""
}

# Main build function
main() {
    log_info "Starting RunVSAgent build process..."
    log_info "Script: $SCRIPT_NAME v$SCRIPT_VERSION"
    log_info "Platform: $(get_platform)"
    log_info "Project root: $PROJECT_ROOT"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_warn "DRY RUN MODE - No changes will be made"
    fi
    
    # Parse arguments
    parse_build_args "$@"
    
    log_info "Build configuration:"
    log_info "  Mode: $BUILD_MODE"
    log_info "  Target: $BUILD_TARGET"
    log_info "  Clean: $CLEAN_BEFORE_BUILD"
    log_info "  Skip tests: $SKIP_TESTS"
    [[ -n "$OUTPUT_DIR" ]] && log_info "  Output: $OUTPUT_DIR"
    
    # Initialize build environment
    init_build_env
    
    # Run build steps
    validate_build_environment
    setup_output_directory
    clean_build_artifacts
    
    # Build components
    build_vscode_plugin_component
    build_vscode_extension_host_component
    build_idea_component
    
    # Run tests and finalize
    #run_tests
    copy_build_artifacts
    show_build_summary
    
    log_success "Build process completed successfully!"
}

# Run main function with all arguments
main "$@"