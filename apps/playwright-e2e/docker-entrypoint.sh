#!/bin/bash

# Docker entrypoint for Playwright E2E tests

set -euo pipefail

# Utility functions
print_status() { echo -e '\033[34m🔧\033[0m' "$1"; }
print_success() { echo -e '\033[32m✅\033[0m' "$1"; }
print_error() { echo -e '\033[31m❌\033[0m' "$1"; }
print_warning() { echo -e '\033[33m⚠️\033[0m' "$1"; }

validate_environment() {
    print_status "Starting Playwright E2E Tests in Docker"
    print_status "Working directory: $(pwd)"
    print_status "Environment: NODE_ENV=${NODE_ENV:-development}, CI=${CI:-false}"

    if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
        print_error "OPENROUTER_API_KEY not set"
        exit 1
    fi

    print_success "Environment validation passed"
}

setup_environment() {
    print_status "Setting up environment..."

    # Initialize D-Bus machine ID if it doesn't exist
    if [[ ! -f /var/lib/dbus/machine-id ]]; then
        dbus-uuidgen > /var/lib/dbus/machine-id 2>/dev/null || true
    fi

    ####### Set up D-Bus ######
    # This is necessary to enable IPC messaging between core and webview
    runtime_dir="/tmp/runtime-$(id -u)"
    if [[ ! -d "$runtime_dir" ]]; then
        mkdir -p "$runtime_dir"
        chmod 700 "$runtime_dir"
    fi
    export XDG_RUNTIME_DIR="$runtime_dir"

    # Start D-Bus session
    if command -v dbus-launch >/dev/null 2>&1; then
        if dbus_output=$(dbus-launch --sh-syntax 2>/dev/null); then
            eval "$dbus_output"
            export DBUS_SESSION_BUS_ADDRESS
        else
            print_warning "Failed to start D-Bus session, continuing anyway"
        fi
    else
        print_warning "dbus-launch not available, continuing anyway"
    fi

        print_status "Setting up keyring services for VS Code secrets API..."

    ####### Set up Keyrings ######
    # This is needed for VS Code secret storage to work properly
    mkdir -p ~/.cache ~/.local/share/keyrings

    # Set environment variables for keyring
    export XDG_CURRENT_DESKTOP=Unity
    export GNOME_KEYRING_CONTROL=1

    # Start gnome-keyring with empty password (headless mode)
    if command -v gnome-keyring-daemon >/dev/null 2>&1; then
        # Initialize keyring with empty password
        if keyring_output=$(printf '\n' | gnome-keyring-daemon --unlock 2>/dev/null); then
            eval "$keyring_output" 2>/dev/null || true
        fi
        
        # Start keyring daemon
        if keyring_start=$(printf '\n' | gnome-keyring-daemon --start 2>/dev/null); then
            eval "$keyring_start" 2>/dev/null || true
            export GNOME_KEYRING_CONTROL
            print_success "Keyring services initialized"
        else
            print_warning "Failed to start keyring daemon - VS Code will fall back to environment variables"
            export VSCODE_SECRETS_FALLBACK=true
        fi
    else
        print_warning "gnome-keyring-daemon not available - VS Code will fall back to environment variables"
        export VSCODE_SECRETS_FALLBACK=true
    fi

    # Test keyring functionality (optional debugging)
    if command -v secret-tool >/dev/null 2>&1 && [[ "${VSCODE_SECRETS_FALLBACK:-}" != "true" ]]; then
        if secret-tool store --label="test" test-key test-value 2>/dev/null; then
            secret-tool clear test-key test-value 2>/dev/null || true
            print_success "Keyring functionality verified"
        else
            print_warning "Keyring test failed - enabling fallback mode"
            export VSCODE_SECRETS_FALLBACK=true
        fi
    fi

    print_success "Environment setup complete!"
}

setup_local_env_secrets() {
    print_status "Setting up .env.local with secrets..."

    # Create .env.local with API key
    echo "OPENROUTER_API_KEY=${OPENROUTER_API_KEY}" > /tmp/.env.local

    print_success "Secrets setup in /tmp/.env.local!"
}

run_playwright_tests() {
    print_status "Running Playwright tests..."

    # Change to the playwright-e2e directory where node_modules and config are located
    cd /workspace/apps/playwright-e2e

    # Set environment variable for HTML report output directory
    export PLAYWRIGHT_HTML_REPORT="/workspace/apps/playwright-e2e/playwright-report"

    # Build test command
    test_cmd=(
        xvfb-run --auto-servernum --server-num=1
        npx dotenvx run -f /tmp/.env.local --
        playwright test
        --output /workspace/apps/playwright-e2e/test-results
    )

    # Add any additional arguments passed to the container
    test_cmd+=("$@")

    # Run the tests
    if "${test_cmd[@]}"; then
        print_success "Playwright tests completed successfully!"
        return 0
    else
        print_error "Playwright tests failed"
        return 1
    fi
}

# Signal handlers
cleanup() {
    print_warning "Received signal, shutting down gracefully"
    exit 0
}

trap cleanup SIGTERM SIGINT

# Main execution
main() {
    validate_environment
    setup_environment
    setup_local_env_secrets

    if run_playwright_tests "$@"; then
        exit_code=0
    else
        exit_code=1
    fi

    print_success "Playwright execution completed with exit code: $exit_code"
    exit $exit_code
}

# Run main function with all arguments
main "$@"
