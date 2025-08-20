#!/bin/bash

# Clean script for RunVSAgent project
# This script cleans build artifacts and temporary files

set -euo pipefail

# Source common utilities
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"
source "$SCRIPT_DIR/lib/build.sh"

# Script configuration
readonly SCRIPT_NAME="clean.sh"
readonly SCRIPT_VERSION="1.0.0"

# Clean targets
readonly TARGET_ALL="all"
readonly TARGET_BUILD="build"
readonly TARGET_DEPS="deps"
readonly TARGET_CACHE="cache"
readonly TARGET_LOGS="logs"
readonly TARGET_TEMP="temp"

# Clean configuration
CLEAN_TARGET="$TARGET_BUILD"
FORCE_CLEAN=false
KEEP_LOGS=false

# Show help for this script
show_help() {
    cat << EOF
$SCRIPT_NAME - Clean RunVSAgent project artifacts

USAGE:
    $SCRIPT_NAME [OPTIONS] [TARGET]

DESCRIPTION:
    This script cleans various types of project artifacts:
    - Build artifacts (compiled files, distributions)
    - Dependencies (node_modules, package locks)
    - Cache files (npm, gradle, temp files)
    - Log files
    - Temporary files

TARGETS:
    build       Clean build artifacts only (default)
    deps        Clean dependencies (node_modules, locks)
    cache       Clean cache files and temporary directories
    logs        Clean log files
    temp        Clean temporary files
    all         Clean everything

OPTIONS:
    -f, --force           Force clean without confirmation
    -k, --keep-logs       Keep log files when cleaning
    -v, --verbose         Enable verbose output
    -n, --dry-run         Show what would be cleaned without executing
    -h, --help            Show this help message

EXAMPLES:
    $SCRIPT_NAME                    # Clean build artifacts
    $SCRIPT_NAME all                # Clean everything
    $SCRIPT_NAME --force deps       # Force clean dependencies
    $SCRIPT_NAME --dry-run all      # Show what would be cleaned

SAFETY:
    - By default, only build artifacts are cleaned
    - Use --force to skip confirmation prompts
    - Use --dry-run to preview what will be cleaned
    - Log files are preserved unless --keep-logs=false

EXIT CODES:
    0    Success
    1    General error
    2    User cancelled
    3    Invalid arguments

EOF
}

# Parse command line arguments
parse_clean_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -f|--force)
                FORCE_CLEAN=true
                shift
                ;;
            -k|--keep-logs)
                KEEP_LOGS=true
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
                CLEAN_TARGET="$1"
                shift
                ;;
        esac
    done
    
    # Validate clean target
    case "$CLEAN_TARGET" in
        "$TARGET_ALL"|"$TARGET_BUILD"|"$TARGET_DEPS"|"$TARGET_CACHE"|"$TARGET_LOGS"|"$TARGET_TEMP")
            ;;
        *)
            log_error "Invalid clean target: $CLEAN_TARGET"
            log_info "Valid targets: $TARGET_ALL, $TARGET_BUILD, $TARGET_DEPS, $TARGET_CACHE, $TARGET_LOGS, $TARGET_TEMP"
            exit 3
            ;;
    esac
}

# Confirm clean operation
confirm_clean() {
    if [[ "$FORCE_CLEAN" == "true" || "$DRY_RUN" == "true" ]]; then
        return 0
    fi
    
    echo ""
    log_warn "This will clean: $CLEAN_TARGET"
    
    case "$CLEAN_TARGET" in
        "$TARGET_ALL")
            log_warn "  - All build artifacts"
            log_warn "  - All dependencies (node_modules)"
            log_warn "  - All cache files"
            log_warn "  - All temporary files"
            [[ "$KEEP_LOGS" != "true" ]] && log_warn "  - All log files"
            ;;
        "$TARGET_BUILD")
            log_warn "  - VSCode extension build files"
            log_warn "  - Base extension build files"
            log_warn "  - IDEA plugin build files"
            log_warn "  - Generated VSIX files"
            ;;
        "$TARGET_DEPS")
            log_warn "  - All node_modules directories"
            log_warn "  - Package lock files"
            log_warn "  - Gradle cache"
            ;;
        "$TARGET_CACHE")
            log_warn "  - npm cache"
            log_warn "  - Gradle cache"
            log_warn "  - Temporary build files"
            ;;
        "$TARGET_LOGS")
            log_warn "  - All log files"
            ;;
        "$TARGET_TEMP")
            log_warn "  - Temporary directories"
            log_warn "  - Build temp files"
            ;;
    esac
    
    echo ""
    read -p "Are you sure you want to continue? [y/N] " -n 1 -r
    echo ""
    
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Clean operation cancelled"
        exit 2
    fi
}

# Clean build artifacts
clean_build_artifacts() {
    if [[ "$CLEAN_TARGET" != "$TARGET_BUILD" && "$CLEAN_TARGET" != "$TARGET_ALL" ]]; then
        return 0
    fi
    
    log_step "Cleaning build artifacts..."
    
    # Clean VSCode extension build
    local vscode_dir="$PROJECT_ROOT/$VSCODE_SUBMODULE_PATH"
    if [[ -d "$vscode_dir" ]]; then
        log_info "Cleaning VSCode extension build..."
        remove_dir "$vscode_dir/bin"
        remove_dir "$vscode_dir/src/dist"
        remove_dir "$vscode_dir/src/webview-ui/build"
        remove_dir "$vscode_dir/out"
        
        # Clean any .vsix files in root
        find "$vscode_dir" -maxdepth 1 -name "*.vsix" -type f -exec rm -f {} \; 2>/dev/null || true
    fi
    
    # Clean base extension build
    local base_dir="$PROJECT_ROOT/$EXTENSION_HOST_DIR"
    if [[ -d "$base_dir" ]]; then
        log_info "Cleaning base extension build..."
        remove_dir "$base_dir/dist"
        remove_dir "$base_dir/out"
    fi
    
    # Clean IDEA plugin build
    local idea_dir="$PROJECT_ROOT/$IDEA_DIR"
    if [[ -d "$idea_dir" ]]; then
        log_info "Cleaning IDEA plugin build..."
        remove_dir "$idea_dir/build"
        remove_dir "$idea_dir/kilocode"
        [[ -f "$idea_dir/prodDep.txt" ]] && rm -f "$idea_dir/prodDep.txt"
    fi
    
    # Clean debug resources
    remove_dir "$PROJECT_ROOT/debug-resources"
    
    # Clean any build directories in project root
    remove_dir "$PROJECT_ROOT/build"
    remove_dir "$PROJECT_ROOT/dist"
    
    log_success "Build artifacts cleaned"
}

# Clean dependencies
clean_dependencies() {
    if [[ "$CLEAN_TARGET" != "$TARGET_DEPS" && "$CLEAN_TARGET" != "$TARGET_ALL" ]]; then
        return 0
    fi
    
    log_step "Cleaning dependencies..."
    
    # Clean base dependencies
    local base_dir="$PROJECT_ROOT/$EXTENSION_HOST_DIR"
    if [[ -d "$base_dir" ]]; then
        log_info "Cleaning base dependencies..."
        remove_dir "$base_dir/node_modules"
        [[ -f "$base_dir/package-lock.json" ]] && rm -f "$base_dir/package-lock.json"
        [[ -f "$base_dir/pnpm-lock.yaml" ]] && rm -f "$base_dir/pnpm-lock.yaml"
    fi
    
    # Clean VSCode extension dependencies
    local vscode_dir="$PROJECT_ROOT/$VSCODE_SUBMODULE_PATH"
    if [[ -d "$vscode_dir" ]]; then
        log_info "Cleaning VSCode extension dependencies..."
        remove_dir "$vscode_dir/node_modules"
        [[ -f "$vscode_dir/package-lock.json" ]] && rm -f "$vscode_dir/package-lock.json"
        [[ -f "$vscode_dir/pnpm-lock.yaml" ]] && rm -f "$vscode_dir/pnpm-lock.yaml"
    fi
    
    # Clean Gradle cache
    local idea_dir="$PROJECT_ROOT/$IDEA_DIR"
    if [[ -d "$idea_dir" ]]; then
        log_info "Cleaning Gradle cache..."
        remove_dir "$idea_dir/.gradle"
        remove_dir "$idea_dir/build"
    fi
    
    # Clean global Gradle cache (user's home directory)
    if [[ -d "$HOME/.gradle/caches" ]]; then
        log_info "Cleaning global Gradle cache..."
        if [[ "$DRY_RUN" == "true" ]]; then
            log_debug "Would clean: $HOME/.gradle/caches"
        else
            find "$HOME/.gradle/caches" -type f -name "*.lock" -delete 2>/dev/null || true
            find "$HOME/.gradle/caches" -type d -name "tmp" -exec rm -rf {} + 2>/dev/null || true
        fi
    fi
    
    log_success "Dependencies cleaned"
}

# Clean cache files
clean_cache() {
    if [[ "$CLEAN_TARGET" != "$TARGET_CACHE" && "$CLEAN_TARGET" != "$TARGET_ALL" ]]; then
        return 0
    fi
    
    log_step "Cleaning cache files..."
    
    # Clean npm cache
    if command_exists "npm"; then
        log_info "Cleaning npm cache..."
        if [[ "$DRY_RUN" == "true" ]]; then
            log_debug "Would run: npm cache clean --force"
        else
            npm cache clean --force 2>/dev/null || true
        fi
    fi
    
    # Clean pnpm cache
    if command_exists "pnpm"; then
        log_info "Cleaning pnpm cache..."
        if [[ "$DRY_RUN" == "true" ]]; then
            log_debug "Would run: pnpm store prune"
        else
            pnpm store prune 2>/dev/null || true
        fi
    fi
    
    # Clean system temp directories
    log_info "Cleaning temporary build files..."
    find /tmp -name "${TEMP_PREFIX}*" -type d -exec rm -rf {} + 2>/dev/null || true
    
    # Clean project temp directory
    remove_dir "$PROJECT_ROOT/tmp"
    
    # Clean OS-specific cache directories
    case "$(get_platform)" in
        "macos")
            # Clean macOS specific caches
            [[ -d "$HOME/Library/Caches/npm" ]] && remove_dir "$HOME/Library/Caches/npm"
            ;;
        "linux")
            # Clean Linux specific caches
            [[ -d "$HOME/.cache/npm" ]] && remove_dir "$HOME/.cache/npm"
            ;;
        "windows")
            # Clean Windows specific caches
            [[ -d "$HOME/AppData/Local/npm-cache" ]] && remove_dir "$HOME/AppData/Local/npm-cache"
            ;;
    esac
    
    log_success "Cache files cleaned"
}

# Clean log files
clean_logs() {
    if [[ "$CLEAN_TARGET" != "$TARGET_LOGS" && "$CLEAN_TARGET" != "$TARGET_ALL" ]]; then
        return 0
    fi
    
    if [[ "$KEEP_LOGS" == "true" ]]; then
        log_info "Keeping log files (--keep-logs specified)"
        return 0
    fi
    
    log_step "Cleaning log files..."
    
    # Clean project log directory
    if [[ -d "$PROJECT_ROOT/logs" ]]; then
        log_info "Cleaning project logs..."
        find "$PROJECT_ROOT/logs" -name "*.log" -type f -exec rm -f {} \; 2>/dev/null || true
        find "$PROJECT_ROOT/logs" -name "*.log.*" -type f -exec rm -f {} \; 2>/dev/null || true
    fi
    
    # Clean npm debug logs
    find "$PROJECT_ROOT" -name "npm-debug.log*" -type f -exec rm -f {} \; 2>/dev/null || true
    find "$PROJECT_ROOT" -name ".npm/_logs" -type d -exec rm -rf {} \; 2>/dev/null || true
    
    # Clean Gradle logs
    local idea_dir="$PROJECT_ROOT/$IDEA_DIR"
    if [[ -d "$idea_dir" ]]; then
        find "$idea_dir" -name "*.log" -type f -exec rm -f {} \; 2>/dev/null || true
    fi
    
    log_success "Log files cleaned"
}

# Clean temporary files
clean_temp() {
    if [[ "$CLEAN_TARGET" != "$TARGET_TEMP" && "$CLEAN_TARGET" != "$TARGET_ALL" ]]; then
        return 0
    fi
    
    log_step "Cleaning temporary files..."
    
    # Clean project temporary files
    find "$PROJECT_ROOT" -name ".DS_Store" -type f -exec rm -f {} \; 2>/dev/null || true
    find "$PROJECT_ROOT" -name "Thumbs.db" -type f -exec rm -f {} \; 2>/dev/null || true
    find "$PROJECT_ROOT" -name "*.tmp" -type f -exec rm -f {} \; 2>/dev/null || true
    find "$PROJECT_ROOT" -name "*.temp" -type f -exec rm -f {} \; 2>/dev/null || true
    
    # Clean editor temporary files
    find "$PROJECT_ROOT" -name "*~" -type f -exec rm -f {} \; 2>/dev/null || true
    find "$PROJECT_ROOT" -name "*.swp" -type f -exec rm -f {} \; 2>/dev/null || true
    find "$PROJECT_ROOT" -name "*.swo" -type f -exec rm -f {} \; 2>/dev/null || true
    
    # Clean system temporary directories
    find /tmp -name "${TEMP_PREFIX}*" -type d -exec rm -rf {} + 2>/dev/null || true
    
    log_success "Temporary files cleaned"
}

# Show clean summary
show_clean_summary() {
    log_step "Clean Summary"
    
    echo ""
    log_success "Clean operation completed!"
    log_info "Target: $CLEAN_TARGET"
    log_info "Platform: $(get_platform)"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "Mode: DRY RUN (no files were actually deleted)"
    fi
    
    echo ""
    log_info "What was cleaned:"
    
    case "$CLEAN_TARGET" in
        "$TARGET_ALL")
            log_info "  ✓ Build artifacts"
            log_info "  ✓ Dependencies"
            log_info "  ✓ Cache files"
            log_info "  ✓ Temporary files"
            [[ "$KEEP_LOGS" != "true" ]] && log_info "  ✓ Log files"
            ;;
        "$TARGET_BUILD")
            log_info "  ✓ Build artifacts"
            ;;
        "$TARGET_DEPS")
            log_info "  ✓ Dependencies"
            ;;
        "$TARGET_CACHE")
            log_info "  ✓ Cache files"
            ;;
        "$TARGET_LOGS")
            log_info "  ✓ Log files"
            ;;
        "$TARGET_TEMP")
            log_info "  ✓ Temporary files"
            ;;
    esac
    
    echo ""
    log_info "Next steps:"
    if [[ "$CLEAN_TARGET" == "$TARGET_ALL" || "$CLEAN_TARGET" == "$TARGET_DEPS" ]]; then
        log_info "  1. Run './scripts/setup.sh' to reinstall dependencies"
        log_info "  2. Run './scripts/build.sh' to rebuild the project"
    elif [[ "$CLEAN_TARGET" == "$TARGET_BUILD" ]]; then
        log_info "  1. Run './scripts/build.sh' to rebuild the project"
    fi
    
    echo ""
}

# Main clean function
main() {
    log_info "Starting RunVSAgent clean process..."
    log_info "Script: $SCRIPT_NAME v$SCRIPT_VERSION"
    log_info "Platform: $(get_platform)"
    log_info "Project root: $PROJECT_ROOT"
    
    # Parse arguments
    parse_clean_args "$@"
    
    log_info "Clean configuration:"
    log_info "  Target: $CLEAN_TARGET"
    log_info "  Force: $FORCE_CLEAN"
    log_info "  Keep logs: $KEEP_LOGS"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_warn "DRY RUN MODE - No files will be deleted"
    fi
    
    # Confirm operation
    confirm_clean
    
    # Run clean operations
    clean_build_artifacts
    clean_dependencies
    clean_cache
    clean_logs
    clean_temp
    
    # Show summary
    show_clean_summary
    
    log_success "Clean process completed successfully!"
}

# Run main function with all arguments
main "$@"