#!/bin/bash

# Main entry point script for RunVSAgent project
# This script provides a unified interface to all project operations

set -euo pipefail

# Source common utilities
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

# Script configuration
readonly SCRIPT_NAME="run.sh"
readonly SCRIPT_VERSION="1.0.0"

# Available commands
readonly CMD_SETUP="setup"
readonly CMD_BUILD="build"
readonly CMD_CLEAN="clean"
readonly CMD_TEST="test"
readonly CMD_HELP="help"
readonly CMD_VERSION="version"

# Show main help
show_main_help() {
    cat << EOF
$SCRIPT_NAME - RunVSAgent Project Management Tool

USAGE:
    $SCRIPT_NAME <command> [options]

DESCRIPTION:
    This is the main entry point for RunVSAgent project operations.
    It provides a unified interface to setup, build, test, and maintain
    the project components.

COMMANDS:
    setup       Initialize development environment
    build       Build project components
    clean       Clean build artifacts and temporary files
    test        Run tests and validations
    help        Show help for commands
    version     Show version information

GLOBAL OPTIONS:
    -v, --verbose    Enable verbose output
    -h, --help       Show this help message

EXAMPLES:
    $SCRIPT_NAME setup                    # Initialize development environment
    $SCRIPT_NAME build                    # Build all components
    $SCRIPT_NAME build --mode debug       # Debug build
    $SCRIPT_NAME clean all                # Clean everything
    $SCRIPT_NAME test                     # Run all tests
    $SCRIPT_NAME help build               # Show build command help

GETTING STARTED:
    1. $SCRIPT_NAME setup                 # First time setup
    2. $SCRIPT_NAME build                 # Build the project
    3. $SCRIPT_NAME test                  # Validate the build

For detailed help on any command, use:
    $SCRIPT_NAME help <command>

PROJECT STRUCTURE:
    base/           Base extension runtime
    idea/           IDEA plugin source
    deps/           Dependencies and submodules
    scripts/        Build and maintenance scripts

ENVIRONMENT:
    Set these environment variables to customize behavior:
    - VERBOSE=true          Enable verbose output
    - DRY_RUN=true         Show what would be done
    - BUILD_MODE=debug     Set build mode
    - SKIP_VALIDATION=true Skip environment validation

EOF
}

# Show command-specific help
show_command_help() {
    local command="$1"
    
    case "$command" in
        "$CMD_SETUP")
            "$SCRIPT_DIR/setup.sh" --help
            ;;
        "$CMD_BUILD")
            "$SCRIPT_DIR/build.sh" --help
            ;;
        "$CMD_CLEAN")
            "$SCRIPT_DIR/clean.sh" --help
            ;;
        "$CMD_TEST")
            "$SCRIPT_DIR/test.sh" --help
            ;;
        *)
            log_error "Unknown command: $command"
            log_info "Available commands: $CMD_SETUP, $CMD_BUILD, $CMD_CLEAN, $CMD_TEST"
            exit 1
            ;;
    esac
}

# Show version information
show_version() {
    cat << EOF
$SCRIPT_NAME version $SCRIPT_VERSION

RunVSAgent Project Management Tool
Platform: $(get_platform)
Shell: $SHELL
Project Root: $PROJECT_ROOT

Component Versions:
- Node.js: $(node --version 2>/dev/null || echo "Not found")
- NPM: $(npm --version 2>/dev/null || echo "Not found")
- Git: $(git --version 2>/dev/null || echo "Not found")
- Gradle: $(gradle --version 2>/dev/null | head -n 1 || echo "Not found")

Build Tools:
- pnpm: $(command_exists "pnpm" && echo "Available" || echo "Not found")
- shellcheck: $(command_exists "shellcheck" && echo "Available" || echo "Not found")

EOF
}

# Validate command
validate_command() {
    local command="$1"
    
    case "$command" in
        "$CMD_SETUP"|"$CMD_BUILD"|"$CMD_CLEAN"|"$CMD_TEST"|"$CMD_HELP"|"$CMD_VERSION")
            return 0
            ;;
        *)
            log_error "Unknown command: $command"
            log_info "Available commands: $CMD_SETUP, $CMD_BUILD, $CMD_CLEAN, $CMD_TEST, $CMD_HELP, $CMD_VERSION"
            log_info "Use '$SCRIPT_NAME help' for more information"
            return 1
            ;;
    esac
}

# Execute command
execute_command() {
    local command="$1"
    shift
    
    case "$command" in
        "$CMD_SETUP")
            exec "$SCRIPT_DIR/setup.sh" "$@"
            ;;
        "$CMD_BUILD")
            exec "$SCRIPT_DIR/build.sh" "$@"
            ;;
        "$CMD_CLEAN")
            exec "$SCRIPT_DIR/clean.sh" "$@"
            ;;
        "$CMD_TEST")
            exec "$SCRIPT_DIR/test.sh" "$@"
            ;;
        "$CMD_HELP")
            if [[ $# -gt 0 ]]; then
                show_command_help "$1"
            else
                show_main_help
            fi
            ;;
        "$CMD_VERSION")
            show_version
            ;;
        *)
            log_error "Command execution failed: $command"
            exit 1
            ;;
    esac
}

# Parse global options
parse_global_options() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -v|--verbose)
                VERBOSE=true
                export VERBOSE
                shift
                ;;
            -h|--help)
                show_main_help
                exit 0
                ;;
            -*)
                # Unknown global option, pass it to the command
                break
                ;;
            *)
                # Not an option, must be a command
                break
                ;;
        esac
    done
    
    # Return remaining arguments
    echo "$@"
}

# Check for first-time setup
check_first_time_setup() {
    local vscode_dir="$PROJECT_ROOT/$VSCODE_SUBMODULE_PATH"
    local base_node_modules="$PROJECT_ROOT/$EXTENSION_HOST_DIR/node_modules"
    
    # Check if this looks like a first-time run
    if [[ ! -d "$vscode_dir" ]] || [[ ! "$(ls -A "$vscode_dir" 2>/dev/null)" ]] || [[ ! -d "$base_node_modules" ]]; then
        log_warn "It looks like this is your first time running the project."
        log_info "You may need to run setup first:"
        log_info "  $SCRIPT_NAME setup"
        echo ""
    fi
}

# Main function
main() {
    # Parse global options first
    local remaining_args
    remaining_args=$(parse_global_options "$@")
    eval set -- "$remaining_args"
    
    # Check if we have a command
    if [[ $# -eq 0 ]]; then
        log_info "RunVSAgent Project Management Tool v$SCRIPT_VERSION"
        log_info "Platform: $(get_platform)"
        log_info "Project root: $PROJECT_ROOT"
        echo ""
        
        check_first_time_setup
        
        log_error "No command specified"
        log_info "Use '$SCRIPT_NAME help' for usage information"
        exit 1
    fi
    
    local command="$1"
    shift
    
    # Validate and execute command
    if validate_command "$command"; then
        if [[ "$VERBOSE" == "true" ]]; then
            log_debug "Executing command: $command with args: $*"
        fi
        execute_command "$command" "$@"
    else
        exit 1
    fi
}

# Run main function with all arguments
main "$@"