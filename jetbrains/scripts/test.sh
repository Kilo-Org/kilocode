#!/bin/bash

# Test script for RunVSAgent project
# This script runs various tests and validations

set -euo pipefail

# Source common utilities
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

# Script configuration
readonly SCRIPT_NAME="test.sh"
readonly SCRIPT_VERSION="1.0.0"

# Test types
readonly TEST_ALL="all"
readonly TEST_UNIT="unit"
readonly TEST_INTEGRATION="integration"
readonly TEST_LINT="lint"
readonly TEST_BUILD="build"
readonly TEST_ENV="env"

# Test configuration
TEST_TYPE="$TEST_ALL"
FAIL_FAST=false
COVERAGE=false
WATCH_MODE=false

# Show help for this script
show_help() {
    cat << EOF
$SCRIPT_NAME - Run tests for RunVSAgent project

USAGE:
    $SCRIPT_NAME [OPTIONS] [TEST_TYPE]

DESCRIPTION:
    This script runs various types of tests and validations:
    - Unit tests for individual components
    - Integration tests for component interactions
    - Linting and code quality checks
    - Build validation tests
    - Environment validation

TEST TYPES:
    all           Run all tests (default)
    unit          Run unit tests only
    integration   Run integration tests only
    lint          Run linting and code quality checks
    build         Run build validation tests
    env           Run environment validation tests

OPTIONS:
    -f, --fail-fast       Stop on first test failure
    -c, --coverage        Generate test coverage reports
    -w, --watch           Run tests in watch mode
    -v, --verbose         Enable verbose output
    -n, --dry-run         Show what tests would be run
    -h, --help            Show this help message

EXAMPLES:
    $SCRIPT_NAME                    # Run all tests
    $SCRIPT_NAME unit               # Run unit tests only
    $SCRIPT_NAME --coverage lint    # Run linting with coverage
    $SCRIPT_NAME --fail-fast        # Stop on first failure

ENVIRONMENT:
    CI                    Set to 'true' for CI environment
    TEST_TIMEOUT          Test timeout in seconds (default: 300)
    COVERAGE_THRESHOLD    Minimum coverage percentage (default: 80)

EXIT CODES:
    0    All tests passed
    1    General error
    2    Test failures
    3    Invalid arguments
    4    Environment issues

EOF
}

# Parse command line arguments
parse_test_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -f|--fail-fast)
                FAIL_FAST=true
                shift
                ;;
            -c|--coverage)
                COVERAGE=true
                shift
                ;;
            -w|--watch)
                WATCH_MODE=true
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
                # Positional argument (test type)
                TEST_TYPE="$1"
                shift
                ;;
        esac
    done
    
    # Validate test type
    case "$TEST_TYPE" in
        "$TEST_ALL"|"$TEST_UNIT"|"$TEST_INTEGRATION"|"$TEST_LINT"|"$TEST_BUILD"|"$TEST_ENV")
            ;;
        *)
            log_error "Invalid test type: $TEST_TYPE"
            log_info "Valid types: $TEST_ALL, $TEST_UNIT, $TEST_INTEGRATION, $TEST_LINT, $TEST_BUILD, $TEST_ENV"
            exit 3
            ;;
    esac
}

# Setup test environment
setup_test_environment() {
    log_step "Setting up test environment..."
    
    # Set CI environment variables
    if [[ "${CI:-false}" == "true" ]]; then
        log_info "Running in CI environment"
        export NODE_ENV="test"
        export CI="true"
    fi
    
    # Set test timeout
    export TEST_TIMEOUT="${TEST_TIMEOUT:-300}"
    
    # Set coverage threshold
    export COVERAGE_THRESHOLD="${COVERAGE_THRESHOLD:-80}"
    
    # Create test output directories
    ensure_dir "$PROJECT_ROOT/test-results"
    ensure_dir "$PROJECT_ROOT/coverage"
    
    log_success "Test environment set up"
}

# Run environment validation tests
run_env_tests() {
    if [[ "$TEST_TYPE" != "$TEST_ENV" && "$TEST_TYPE" != "$TEST_ALL" ]]; then
        return 0
    fi
    
    log_step "Running environment validation tests..."
    
    local test_failures=0
    
    # Test 1: Validate system requirements
    log_info "Testing system requirements..."
    if validate_environment 2>/dev/null; then
        log_success "✓ System requirements test passed"
    else
        log_error "✗ System requirements test failed"
        ((test_failures++))
        [[ "$FAIL_FAST" == "true" ]] && return $test_failures
    fi
    
    # Test 2: Check project structure
    log_info "Testing project structure..."
    local required_dirs=("$EXTENSION_HOST_DIR" "$IDEA_DIR" "scripts")
    local structure_ok=true
    
    for dir in "${required_dirs[@]}"; do
        if [[ ! -d "$PROJECT_ROOT/$dir" ]]; then
            log_error "Required directory missing: $dir"
            structure_ok=false
        fi
    done
    
    if [[ "$structure_ok" == "true" ]]; then
        log_success "✓ Project structure test passed"
    else
        log_error "✗ Project structure test failed"
        ((test_failures++))
        [[ "$FAIL_FAST" == "true" ]] && return $test_failures
    fi
    
    # Test 3: Check Git configuration
    log_info "Testing Git configuration..."
    if git rev-parse --git-dir >/dev/null 2>&1; then
        log_success "✓ Git configuration test passed"
    else
        log_error "✗ Git configuration test failed"
        ((test_failures++))
        [[ "$FAIL_FAST" == "true" ]] && return $test_failures
    fi
    
    log_info "Environment tests completed with $test_failures failures"
    return $test_failures
}

# Run linting tests
run_lint_tests() {
    if [[ "$TEST_TYPE" != "$TEST_LINT" && "$TEST_TYPE" != "$TEST_ALL" ]]; then
        return 0
    fi
    
    log_step "Running linting tests..."
    
    local test_failures=0
    
    # Test shell scripts with shellcheck if available
    if command_exists "shellcheck"; then
        log_info "Running shellcheck on shell scripts..."
        local shell_files
        shell_files=$(find "$PROJECT_ROOT/scripts" -name "*.sh" -type f)
        
        if [[ -n "$shell_files" ]]; then
            if [[ "$DRY_RUN" == "true" ]]; then
                log_debug "Would run: shellcheck on shell scripts"
            else
                if echo "$shell_files" | xargs shellcheck; then
                    log_success "✓ Shell script linting passed"
                else
                    log_error "✗ Shell script linting failed"
                    ((test_failures++))
                    [[ "$FAIL_FAST" == "true" ]] && return $test_failures
                fi
            fi
        fi
    else
        log_warn "shellcheck not found, skipping shell script linting"
    fi
    
    # Test base extension linting
    local base_dir="$PROJECT_ROOT/$EXTENSION_HOST_DIR"
    if [[ -f "$base_dir/package.json" ]]; then
        log_info "Running base extension linting..."
        cd "$base_dir"
        
        if npm run lint --if-present >/dev/null 2>&1; then
            if [[ "$DRY_RUN" == "true" ]]; then
                log_debug "Would run: npm run lint in base directory"
            else
                if npm run lint; then
                    log_success "✓ Base extension linting passed"
                else
                    log_error "✗ Base extension linting failed"
                    ((test_failures++))
                    [[ "$FAIL_FAST" == "true" ]] && return $test_failures
                fi
            fi
        else
            log_debug "No lint script found in base extension"
        fi
    fi
    
    # Test VSCode extension linting
    local vscode_dir="$PROJECT_ROOT/$VSCODE_SUBMODULE_PATH"
    if [[ -d "$vscode_dir" && -f "$vscode_dir/package.json" ]]; then
        log_info "Running VSCode extension linting..."
        cd "$vscode_dir"
        
        local pkg_manager="npm"
        if command_exists "pnpm" && [[ -f "pnpm-lock.yaml" ]]; then
            pkg_manager="pnpm"
        fi
        
        if $pkg_manager run lint --if-present >/dev/null 2>&1; then
            if [[ "$DRY_RUN" == "true" ]]; then
                log_debug "Would run: $pkg_manager run lint in VSCode directory"
            else
                if $pkg_manager run lint; then
                    log_success "✓ VSCode extension linting passed"
                else
                    log_error "✗ VSCode extension linting failed"
                    ((test_failures++))
                    [[ "$FAIL_FAST" == "true" ]] && return $test_failures
                fi
            fi
        else
            log_debug "No lint script found in VSCode extension"
        fi
    fi
    
    log_info "Linting tests completed with $test_failures failures"
    return $test_failures
}

# Run unit tests
run_unit_tests() {
    if [[ "$TEST_TYPE" != "$TEST_UNIT" && "$TEST_TYPE" != "$TEST_ALL" ]]; then
        return 0
    fi
    
    log_step "Running unit tests..."
    
    local test_failures=0
    
    # Run base extension unit tests
    local base_dir="$PROJECT_ROOT/$EXTENSION_HOST_DIR"
    if [[ -f "$base_dir/package.json" ]]; then
        log_info "Running base extension unit tests..."
        cd "$base_dir"
        
        local test_cmd="npm test"
        if [[ "$COVERAGE" == "true" ]]; then
            test_cmd="npm run test:coverage"
        fi
        
        if npm run test --if-present >/dev/null 2>&1; then
            if [[ "$DRY_RUN" == "true" ]]; then
                log_debug "Would run: $test_cmd in base directory"
            else
                if eval "$test_cmd"; then
                    log_success "✓ Base extension unit tests passed"
                else
                    log_error "✗ Base extension unit tests failed"
                    ((test_failures++))
                    [[ "$FAIL_FAST" == "true" ]] && return $test_failures
                fi
            fi
        else
            log_debug "No test script found in base extension"
        fi
    fi
    
    # Run VSCode extension unit tests
    local vscode_dir="$PROJECT_ROOT/$VSCODE_SUBMODULE_PATH"
    if [[ -d "$vscode_dir" && -f "$vscode_dir/package.json" ]]; then
        log_info "Running VSCode extension unit tests..."
        cd "$vscode_dir"
        
        local pkg_manager="npm"
        if command_exists "pnpm" && [[ -f "pnpm-lock.yaml" ]]; then
            pkg_manager="pnpm"
        fi
        
        local test_cmd="$pkg_manager test"
        if [[ "$COVERAGE" == "true" ]]; then
            test_cmd="$pkg_manager run test:coverage"
        fi
        
        if $pkg_manager run test --if-present >/dev/null 2>&1; then
            if [[ "$DRY_RUN" == "true" ]]; then
                log_debug "Would run: $test_cmd in VSCode directory"
            else
                if eval "$test_cmd"; then
                    log_success "✓ VSCode extension unit tests passed"
                else
                    log_error "✗ VSCode extension unit tests failed"
                    ((test_failures++))
                    [[ "$FAIL_FAST" == "true" ]] && return $test_failures
                fi
            fi
        else
            log_debug "No test script found in VSCode extension"
        fi
    fi
    
    log_info "Unit tests completed with $test_failures failures"
    return $test_failures
}

# Run integration tests
run_integration_tests() {
    if [[ "$TEST_TYPE" != "$TEST_INTEGRATION" && "$TEST_TYPE" != "$TEST_ALL" ]]; then
        return 0
    fi
    
    log_step "Running integration tests..."
    
    local test_failures=0
    
    # Test 1: Build integration test
    log_info "Testing build integration..."
    if [[ "$DRY_RUN" == "true" ]]; then
        log_debug "Would run: build integration test"
    else
        # Try a minimal build to test integration
        local temp_dir
        temp_dir=$(mktemp -d)
        
        if "$SCRIPT_DIR/build.sh" --dry-run >/dev/null 2>&1; then
            log_success "✓ Build integration test passed"
        else
            log_error "✗ Build integration test failed"
            ((test_failures++))
            [[ "$FAIL_FAST" == "true" ]] && return $test_failures
        fi
        
        rm -rf "$temp_dir"
    fi
    
    # Test 2: Script integration test
    log_info "Testing script integration..."
    local scripts=("setup.sh" "build.sh" "clean.sh")
    
    for script in "${scripts[@]}"; do
        if [[ -f "$SCRIPT_DIR/$script" ]]; then
            if [[ "$DRY_RUN" == "true" ]]; then
                log_debug "Would test: $script --help"
            else
                if "$SCRIPT_DIR/$script" --help >/dev/null 2>&1; then
                    log_debug "✓ $script help test passed"
                else
                    log_error "✗ $script help test failed"
                    ((test_failures++))
                    [[ "$FAIL_FAST" == "true" ]] && return $test_failures
                fi
            fi
        fi
    done
    
    if [[ $test_failures -eq 0 ]]; then
        log_success "✓ Script integration tests passed"
    fi
    
    log_info "Integration tests completed with $test_failures failures"
    return $test_failures
}

# Run build validation tests
run_build_tests() {
    if [[ "$TEST_TYPE" != "$TEST_BUILD" && "$TEST_TYPE" != "$TEST_ALL" ]]; then
        return 0
    fi
    
    log_step "Running build validation tests..."
    
    local test_failures=0
    
    # Test 1: Validate build script syntax
    log_info "Testing build script syntax..."
    if [[ "$DRY_RUN" == "true" ]]; then
        log_debug "Would validate: build script syntax"
    else
        if bash -n "$SCRIPT_DIR/build.sh"; then
            log_success "✓ Build script syntax test passed"
        else
            log_error "✗ Build script syntax test failed"
            ((test_failures++))
            [[ "$FAIL_FAST" == "true" ]] && return $test_failures
        fi
    fi
    
    # Test 2: Validate required build files
    log_info "Testing required build files..."
    local required_files=(
        "$PROJECT_ROOT/$EXTENSION_HOST_DIR/package.json"
        "$PROJECT_ROOT/$IDEA_DIR/build.gradle"
    )
    
    local files_ok=true
    for file in "${required_files[@]}"; do
        if [[ ! -f "$file" && ! -f "${file%.gradle}.kts" ]]; then
            log_error "Required build file missing: $file"
            files_ok=false
        fi
    done
    
    if [[ "$files_ok" == "true" ]]; then
        log_success "✓ Required build files test passed"
    else
        log_error "✗ Required build files test failed"
        ((test_failures++))
        [[ "$FAIL_FAST" == "true" ]] && return $test_failures
    fi
    
    log_info "Build validation tests completed with $test_failures failures"
    return $test_failures
}

# Generate test report
generate_test_report() {
    local total_failures="$1"
    
    log_step "Generating test report..."
    
    local report_file="$PROJECT_ROOT/test-results/test-report.txt"
    ensure_dir "$(dirname "$report_file")"
    
    cat > "$report_file" << EOF
RunVSAgent Test Report
=====================

Date: $(date)
Test Type: $TEST_TYPE
Platform: $(get_platform)
Total Failures: $total_failures

Test Configuration:
- Fail Fast: $FAIL_FAST
- Coverage: $COVERAGE
- Watch Mode: $WATCH_MODE
- Verbose: $VERBOSE
- Dry Run: $DRY_RUN

Environment:
- Node Version: $(node --version 2>/dev/null || echo "Not found")
- NPM Version: $(npm --version 2>/dev/null || echo "Not found")
- Git Version: $(git --version 2>/dev/null || echo "Not found")

Test Results:
$(if [[ $total_failures -eq 0 ]]; then echo "✓ All tests passed"; else echo "✗ $total_failures test(s) failed"; fi)

EOF
    
    log_info "Test report generated: $report_file"
}

# Show test summary
show_test_summary() {
    local total_failures="$1"
    
    log_step "Test Summary"
    
    echo ""
    if [[ $total_failures -eq 0 ]]; then
        log_success "All tests passed!"
    else
        log_error "$total_failures test(s) failed"
    fi
    
    log_info "Test type: $TEST_TYPE"
    log_info "Platform: $(get_platform)"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "Mode: DRY RUN (no tests were actually executed)"
    fi
    
    echo ""
    log_info "Test report: $PROJECT_ROOT/test-results/test-report.txt"
    
    if [[ "$COVERAGE" == "true" ]]; then
        log_info "Coverage reports: $PROJECT_ROOT/coverage/"
    fi
    
    echo ""
}

# Main test function
main() {
    log_info "Starting RunVSAgent test process..."
    log_info "Script: $SCRIPT_NAME v$SCRIPT_VERSION"
    log_info "Platform: $(get_platform)"
    log_info "Project root: $PROJECT_ROOT"
    
    # Parse arguments
    parse_test_args "$@"
    
    log_info "Test configuration:"
    log_info "  Type: $TEST_TYPE"
    log_info "  Fail fast: $FAIL_FAST"
    log_info "  Coverage: $COVERAGE"
    log_info "  Watch mode: $WATCH_MODE"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_warn "DRY RUN MODE - No tests will be executed"
    fi
    
    # Setup test environment
    setup_test_environment
    
    # Run tests
    local total_failures=0
    
    run_env_tests
    ((total_failures += $?))
    
    run_lint_tests
    ((total_failures += $?))
    
    run_unit_tests
    ((total_failures += $?))
    
    run_integration_tests
    ((total_failures += $?))
    
    run_build_tests
    ((total_failures += $?))
    
    # Generate report and show summary
    generate_test_report "$total_failures"
    show_test_summary "$total_failures"
    
    if [[ $total_failures -eq 0 ]]; then
        log_success "Test process completed successfully!"
        exit 0
    else
        log_error "Test process completed with failures!"
        exit 2
    fi
}

# Run main function with all arguments
main "$@"