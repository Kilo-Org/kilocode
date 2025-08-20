#!/bin/bash

# Common utility functions for build scripts
# This file provides cross-platform compatible utility functions

# Prevent multiple sourcing
if [[ -n "${_COMMON_SH_LOADED:-}" ]]; then
    return 0
fi
_COMMON_SH_LOADED=1

# Color codes for output
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[0;33m'
readonly BLUE='\033[0;34m'
readonly PURPLE='\033[0;35m'
readonly CYAN='\033[0;36m'
readonly NC='\033[0m' # No Color

# Global variables
SCRIPT_DIR=""
PROJECT_ROOT=""
VERBOSE=false
DRY_RUN=false

# Project structure constants
export VSCODE_SUBMODULE_PATH="deps/vscode"
export PLUGIN_SUBMODULE_PATH="deps/kilocode"
export EXTENSION_HOST_DIR="extension_host"

# Logging functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1" >&2
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1" >&2
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

log_debug() {
    if [[ "$VERBOSE" == "true" ]]; then
        echo -e "${BLUE}[DEBUG]${NC} $1" >&2
    fi
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1" >&2
}

log_step() {
    echo -e "${CYAN}[STEP]${NC} $1" >&2
}

# Error handling
die() {
    log_error "$1"
    exit "${2:-1}"
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check command result
check_result() {
    local exit_code=$?
    local error_msg="$1"
    local success_msg="$2"
    
    if [[ $exit_code -ne 0 ]]; then
        die "$error_msg" $exit_code
    elif [[ -n "$success_msg" ]]; then
        log_success "$success_msg"
    fi
}

# Ensure directory exists
ensure_dir() {
    local dir="$1"
    if [[ ! -d "$dir" ]]; then
        if [[ "$DRY_RUN" == "true" ]]; then
            log_debug "Would create directory: $dir"
        else
            mkdir -p "$dir"
            check_result "Failed to create directory: $dir" "Created directory: $dir"
        fi
    fi
}

# Remove directory safely
remove_dir() {
    local dir="$1"
    if [[ -d "$dir" ]]; then
        if [[ "$DRY_RUN" == "true" ]]; then
            log_debug "Would remove directory: $dir"
        else
            rm -rf "$dir"
            check_result "Failed to remove directory: $dir" "Removed directory: $dir"
        fi
    fi
}

# Copy files/directories
copy_files() {
    local src="$1"
    local dest="$2"
    local description="${3:-files}"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_debug "Would copy $description from $src to $dest"
    else
        cp -r "$src" "$dest"
        check_result "Failed to copy $description from $src to $dest" "Copied $description successfully"
    fi
}

# Execute command with logging
execute_cmd() {
    local cmd="$1"
    local description="${2:-command}"
    
    log_debug "Executing: $cmd"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_debug "Would execute: $cmd"
        return 0
    fi
    
    if [[ "$VERBOSE" == "true" ]]; then
        eval "$cmd"
    else
        eval "$cmd" >/dev/null
    fi
    
    local exit_code=$?
    if [[ $exit_code -ne 0 ]]; then
        log_error "Command execution failed with exit code $exit_code: $cmd"
        die "Failed to execute $description" $exit_code
    else
        log_success "Successfully executed $description"
    fi
}

# Find files with pattern
find_files() {
    local dir="$1"
    local pattern="$2"
    local max_depth="${3:-1}"
    
    find "$dir" -maxdepth "$max_depth" -name "$pattern" -type f 2>/dev/null
}

# Get latest file matching pattern
get_latest_file() {
    local dir="$1"
    local pattern="$2"
    
    find_files "$dir" "$pattern" | sort -r | head -n 1
}

# Platform detection
get_platform() {
    case "$(uname -s)" in
        Darwin*) echo "macos" ;;
        Linux*)  echo "linux" ;;
        CYGWIN*|MINGW*|MSYS*) echo "windows" ;;
        *) echo "unknown" ;;
    esac
}

# Check if running on specific platform
is_macos() {
    [[ "$(get_platform)" == "macos" ]]
}

is_linux() {
    [[ "$(get_platform)" == "linux" ]]
}

is_windows() {
    [[ "$(get_platform)" == "windows" ]]
}

# Validate environment
validate_environment() {
    log_step "Validating environment..."
    
    # Check required commands
    local required_commands=("git" "node" "npm")
    for cmd in "${required_commands[@]}"; do
        if ! command_exists "$cmd"; then
            die "Required command not found: $cmd"
        fi
        log_debug "Found command: $cmd"
    done
    
    # Check Node.js version
    local node_version
    node_version=$(node --version | sed 's/v//')
    local required_node_version="16.0.0"
    
    if ! version_gte "$node_version" "$required_node_version"; then
        die "Node.js version $node_version is too old. Required: $required_node_version+"
    fi
    
    log_success "Environment validation passed"
}

# Version comparison
version_gte() {
    local version1="$1"
    local version2="$2"
    
    # Simple version comparison (works for most cases)
    printf '%s\n%s\n' "$version2" "$version1" | sort -V -C
}

# Parse command line arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
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
                # Unknown option
                log_warn "Unknown option: $1"
                shift
                ;;
        esac
    done
}

# Show help (to be overridden by individual scripts)
show_help() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -v, --verbose    Enable verbose output"
    echo "  -n, --dry-run    Show what would be done without executing"
    echo "  -h, --help       Show this help message"
}

# Cleanup function (to be called on script exit)
cleanup() {
    local exit_code=$?
    if [[ $exit_code -ne 0 ]]; then
        log_error "Script failed with exit code $exit_code"
    fi
    return $exit_code
}

# Set up trap for cleanup
trap cleanup EXIT

# Initialize common variables when sourced (only if not already initialized)
if [[ -z "${_INIT_COMMON_CALLED:-}" ]]; then
    # Get the directory of the script that sourced this file
    if [[ -z "${SCRIPT_DIR:-}" ]]; then
        SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[1]}")" && pwd)"
        export SCRIPT_DIR
    fi
    # PROJECT_ROOT should be set by the main script, don't override it
    if [[ -z "${PROJECT_ROOT:-}" ]]; then
        PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
        export PROJECT_ROOT
    fi
    _INIT_COMMON_CALLED=1
fi