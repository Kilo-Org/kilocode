#!/bin/bash

# Setup script for RunVSAgent project
# This script initializes the development environment and dependencies

set -euo pipefail

# Source common utilities
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"
source "$SCRIPT_DIR/lib/build.sh"

# Script configuration
readonly SCRIPT_NAME="setup.sh"
readonly SCRIPT_VERSION="1.0.0"
readonly PATCH_FILE="deps/patches/vscode/feature-cline-ai.patch"

# Setup options
FORCE_REINSTALL=false
SKIP_SUBMODULES=false
SKIP_DEPENDENCIES=false
APPLY_PATCHES=true

# Show help for this script
show_help() {
    cat << EOF
$SCRIPT_NAME - Setup development environment for RunVSAgent

USAGE:
    $SCRIPT_NAME [OPTIONS]

DESCRIPTION:
    This script initializes the development environment by:
    - Validating system requirements
    - Initializing git submodules
    - Installing project dependencies
    - Applying necessary patches
    - Setting up build environment

OPTIONS:
    -f, --force           Force reinstall of dependencies
    -s, --skip-submodules Skip git submodule initialization
    -d, --skip-deps       Skip dependency installation
    -p, --no-patches      Skip applying patches
    -v, --verbose         Enable verbose output
    -n, --dry-run         Show what would be done without executing
    -h, --help            Show this help message

EXAMPLES:
    $SCRIPT_NAME                    # Full setup
    $SCRIPT_NAME --force            # Force reinstall everything
    $SCRIPT_NAME --skip-deps        # Skip dependency installation
    $SCRIPT_NAME --verbose          # Verbose output

ENVIRONMENT:
    NODE_VERSION_MIN    Minimum Node.js version (default: 16.0.0)
    SKIP_VALIDATION     Skip environment validation if set to 'true'

EXIT CODES:
    0    Success
    1    General error
    2    Environment validation failed
    3    Dependency installation failed
    4    Patch application failed

EOF
}

# Parse command line arguments
parse_setup_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -f|--force)
                FORCE_REINSTALL=true
                shift
                ;;
            -s|--skip-submodules)
                SKIP_SUBMODULES=true
                shift
                ;;
            -d|--skip-deps)
                SKIP_DEPENDENCIES=true
                shift
                ;;
            -p|--no-patches)
                APPLY_PATCHES=false
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
            *)
                log_error "Unknown option: $1"
                log_info "Use --help for usage information"
                exit 1
                ;;
        esac
    done
}

# Validate system requirements
validate_system_requirements() {
    log_step "Validating system requirements..."
    
    # Skip validation if requested
    if [[ "${SKIP_VALIDATION:-false}" == "true" ]]; then
        log_warn "Skipping environment validation (SKIP_VALIDATION=true)"
        return 0
    fi
    
    # Validate basic environment
    validate_environment
    
    # Check for additional development tools
    local dev_tools=("git" "unzip" "curl")
    for tool in "${dev_tools[@]}"; do
        if ! command_exists "$tool"; then
            die "Required development tool not found: $tool" 2
        fi
        log_debug "Found development tool: $tool"
    done
    
    # Check Git configuration
    if ! git config user.name >/dev/null 2>&1; then
        log_warn "Git user.name not configured. Run: git config --global user.name 'Your Name'"
    fi
    
    if ! git config user.email >/dev/null 2>&1; then
        log_warn "Git user.email not configured. Run: git config --global user.email 'your.email@example.com'"
    fi
    
    # Check available disk space (at least 2GB)
    local available_space
    if is_macos; then
        available_space=$(df -g "$PROJECT_ROOT" | awk 'NR==2 {print $4}')
    else
        available_space=$(df -BG "$PROJECT_ROOT" | awk 'NR==2 {print $4}' | sed 's/G//')
    fi
    
    if [[ "$available_space" -lt 2 ]]; then
        log_warn "Low disk space: ${available_space}GB available. At least 2GB recommended."
    fi
    
    log_success "System requirements validated"
}

# Initialize git submodules
setup_submodules() {
    if [[ "$SKIP_SUBMODULES" == "true" ]]; then
        log_info "Skipping git submodule initialization"
        return 0
    fi
    
    log_step "Setting up git submodules..."
    
    cd "$PROJECT_ROOT"
    
    # Check if .gitmodules exists
    if [[ ! -f ".gitmodules" ]]; then
        log_warn "No .gitmodules file found, skipping submodule setup"
        return 0
    fi
    
    # Initialize and update submodules
    if [[ "$FORCE_REINSTALL" == "true" ]]; then
        log_info "Force reinstalling submodules..."
        execute_cmd "git submodule deinit --all -f" "submodule deinit"
    fi
    
    execute_cmd "git submodule init" "submodule init"
    execute_cmd "git submodule update --recursive" "submodule update"
    
    # Switch to development branch if specified
    local vscode_dir="$PROJECT_ROOT/$VSCODE_SUBMODULE_PATH"
    if [[ -d "$vscode_dir" ]]; then
        cd "$vscode_dir"
        if git show-ref --verify --quiet "refs/heads/$VSCODE_BRANCH"; then
            execute_cmd "git checkout $VSCODE_BRANCH" "checkout $VSCODE_BRANCH"
        elif git show-ref --verify --quiet "refs/remotes/origin/$VSCODE_BRANCH"; then
            execute_cmd "git checkout -b $VSCODE_BRANCH origin/$VSCODE_BRANCH" "checkout $VSCODE_BRANCH"
        else
            log_warn "Branch $VSCODE_BRANCH not found, staying on current branch"
        fi
    fi
    
    log_success "Git submodules set up"
}

# Install project dependencies
install_dependencies() {
    if [[ "$SKIP_DEPENDENCIES" == "true" ]]; then
        log_info "Skipping dependency installation"
        return 0
    fi
    
    log_step "Installing project dependencies..."
    
    # Install extension host dependencies
    if [[ -d "$PROJECT_ROOT/$EXTENSION_HOST_DIR" && -f "$PROJECT_ROOT/$EXTENSION_HOST_DIR/package.json" ]]; then
        log_info "Installing extension host dependencies..."
        cd "$PROJECT_ROOT/$EXTENSION_HOST_DIR"
        
        if [[ "$FORCE_REINSTALL" == "true" ]]; then
            remove_dir "node_modules"
            [[ -f "package-lock.json" ]] && rm -f "package-lock.json"
        fi
        
        execute_cmd "npm install" "extension host dependencies installation"
    fi
    
    # Install VSCode extension dependencies
    local vscode_dir="$PROJECT_ROOT/$PLUGIN_SUBMODULE_PATH"
    if [[ -d "$vscode_dir" && -f "$vscode_dir/package.json" ]]; then
        log_info "Installing VSCode extension dependencies..."
        cd "$vscode_dir"
        
        if [[ "$FORCE_REINSTALL" == "true" ]]; then
            remove_dir "node_modules"
            [[ -f "package-lock.json" ]] && rm -f "package-lock.json"
            [[ -f "pnpm-lock.yaml" ]] && rm -f "pnpm-lock.yaml"
        fi
        
        # Use pnpm if available and lock file exists
        local pkg_manager="npm"
        if command_exists "pnpm" && [[ -f "pnpm-lock.yaml" ]]; then
            pkg_manager="pnpm"
        fi
        
        execute_cmd "$pkg_manager install" "VSCode extension dependencies installation"
    fi
    
    log_success "Dependencies installed"
}

# Apply project patches and copy VSCode files
apply_patches() {
    if [[ "$APPLY_PATCHES" != "true" ]]; then
        log_info "Skipping patch application"
        return 0
    fi
    
    log_step "Applying project patches..."
    
    local patch_file="$PROJECT_ROOT/$PATCH_FILE"
    if [[ ! -f "$patch_file" ]]; then
        log_warn "Patch file not found: $patch_file"
        return 0
    fi
    
    # Use deps/vscode as the source directory (like init.sh)
    local vscode_source_dir="$PROJECT_ROOT/deps/vscode"
    local vscode_target_dir="$PROJECT_ROOT/$EXTENSION_HOST_DIR/vscode"
    
    if [[ ! -d "$vscode_source_dir" ]]; then
        log_warn "VSCode source directory not found: $vscode_source_dir"
        return 0
    fi
    
    cd "$vscode_source_dir"
    execute_cmd "git clean -dfx && git reset --hard" "reset VSCode source"
 
    # Check if patch can be applied
    if git apply --check "$patch_file" 2>/dev/null; then
        log_info "Applying patch to VSCode source..."
        execute_cmd "git apply '$patch_file'" "patch application"
        
        # Copy src/* to target directory (exactly like init.sh)
        log_info "Copying src/* to $vscode_target_dir..."
        # Use the same logic as init.sh: mkdir -p $TARGET_DIR || rm -rf "$TARGET_DIR"/*
        if [[ ! -d "$vscode_target_dir" ]]; then
            ensure_dir "$vscode_target_dir"
        else
            rm -rf "$vscode_target_dir"/*
        fi
        
        if [[ -d "$vscode_source_dir/src" ]]; then
            execute_cmd "cp -r src/* '$vscode_target_dir/'" "VSCode files copy"
        else
            log_error "VSCode src directory not found in $vscode_source_dir"
            exit 4
        fi
        
        # Reset the source repository (like init.sh)
        log_info "Resetting VSCode source repository..."
        execute_cmd "git reset --hard" "git reset"
        execute_cmd "git clean -fd" "git clean"
        
        log_success "Patch applied and VSCode files copied successfully"
    else
        # Check if patch is already applied
        if git apply --reverse --check "$patch_file" 2>/dev/null; then
            log_info "Patch appears to already be applied, copying files..."
            
            # Still copy the files even if patch is already applied
            # Use the same logic as init.sh: mkdir -p $TARGET_DIR || rm -rf "$TARGET_DIR"/*
            if [[ ! -d "$vscode_target_dir" ]]; then
                ensure_dir "$vscode_target_dir"
            else
                rm -rf "$vscode_target_dir"/*
            fi
            
            if [[ -d "$vscode_source_dir/src" ]]; then
                execute_cmd "cp -r src/* '$vscode_target_dir/'" "VSCode files copy"
                log_success "VSCode files copied successfully"
            else
                log_error "VSCode src directory not found in $vscode_source_dir"
                exit 4
            fi
        else
            log_error "Patch cannot be applied (conflicts may exist)"
            log_info "You may need to resolve conflicts manually"
            exit 4
        fi
    fi
}

# Setup development environment
setup_dev_environment() {
    log_step "Setting up development environment..."
    
    # Create necessary directories
    local dirs_to_create=(
        "$PROJECT_ROOT/logs"
        "$PROJECT_ROOT/tmp"
        "$PROJECT_ROOT/build"
    )
    
    for dir in "${dirs_to_create[@]}"; do
        ensure_dir "$dir"
    done
    
    # Set up Git hooks if they exist
    local hooks_dir="$PROJECT_ROOT/.githooks"
    if [[ -d "$hooks_dir" ]]; then
        log_info "Setting up Git hooks..."
        execute_cmd "git config core.hooksPath .githooks" "Git hooks setup"
        
        # Make hooks executable
        find "$hooks_dir" -type f -exec chmod +x {} \;
    fi
    
    # Create environment file template if it doesn't exist
    local env_file="$PROJECT_ROOT/.env.local"
    if [[ ! -f "$env_file" ]]; then
        log_info "Creating environment file template..."
        cat > "$env_file" << 'EOF'
# Local environment configuration
# Copy this file to .env.local and customize as needed

# Build configuration
# BUILD_MODE=release
# VERBOSE=false

# Development settings
# SKIP_VALIDATION=false
# USE_DEBUG_BUILD=false

# Paths (usually auto-detected)
# PROJECT_ROOT=
# VSCODE_DIR=
EOF
        log_info "Created $env_file - customize as needed"
    fi
    
    log_success "Development environment set up"
}

# Verify setup
verify_setup() {
    log_step "Verifying setup..."
    
    local errors=0
    
    # Check critical directories
    local critical_dirs=(
        "$PROJECT_ROOT/$EXTENSION_HOST_DIR"
        "$PROJECT_ROOT/$IDEA_DIR"
    )
    
    for dir in "${critical_dirs[@]}"; do
        if [[ ! -d "$dir" ]]; then
            log_error "Critical directory missing: $dir"
            ((errors++))
        fi
    done
    
    # Check for VSCode submodule
    local vscode_dir="$PROJECT_ROOT/$VSCODE_SUBMODULE_PATH"
    if [[ ! -d "$vscode_dir" ]] || [[ ! "$(ls -A "$vscode_dir" 2>/dev/null)" ]]; then
        log_error "VSCode submodule not properly initialized: $vscode_dir"
        ((errors++))
    fi
    
    # Check for package.json files
    local package_files=(
        "$PROJECT_ROOT/$EXTENSION_HOST_DIR/package.json"
    )
    
    for file in "${package_files[@]}"; do
        if [[ ! -f "$file" ]]; then
            log_error "Package file missing: $file"
            ((errors++))
        fi
    done
    
    # Check for build tools
    if [[ -d "$PROJECT_ROOT/$IDEA_DIR" ]]; then
        if [[ ! -f "$PROJECT_ROOT/$IDEA_DIR/build.gradle" && ! -f "$PROJECT_ROOT/$IDEA_DIR/build.gradle.kts" ]]; then
            log_warn "No Gradle build file found in IDEA directory"
        fi
    fi
    
    if [[ $errors -gt 0 ]]; then
        log_error "Setup verification failed with $errors errors"
        exit 3
    fi
    
    log_success "Setup verification passed"
}

# Main setup function
main() {
    log_info "Starting RunVSAgent development environment setup..."
    log_info "Script: $SCRIPT_NAME v$SCRIPT_VERSION"
    log_info "Platform: $(get_platform)"
    log_info "Project root: $PROJECT_ROOT"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_warn "DRY RUN MODE - No changes will be made"
    fi
    
    # Parse arguments
    parse_setup_args "$@"
    
    # Run setup steps
    validate_system_requirements
    setup_submodules
    install_dependencies
    apply_patches
    setup_dev_environment
    verify_setup
    
    log_success "Setup completed successfully!"
    log_info ""
    log_info "Next steps:"
    log_info "  1. Run './scripts/build.sh' to build the project"
    log_info "  2. Run './scripts/build.sh --help' for build options"
    log_info "  3. Check the generated files in the idea/ directory"
    log_info ""
    log_info "For more information, see the project documentation."
}

# Run main function with all arguments
main "$@"