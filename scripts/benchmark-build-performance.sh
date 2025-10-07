#!/bin/bash

# TypeScript Project References Build Performance Benchmark
# This script compares build performance before and after project references migration

set -e

echo "🔍 TypeScript Project References Build Performance Benchmark"
echo "============================================================="

# Check if hyperfine is installed
if ! command -v hyperfine &> /dev/null; then
    echo "❌ hyperfine is required but not installed."
    echo "   Install with: brew install hyperfine (macOS) or cargo install hyperfine"
    exit 1
fi

# Get current branch
CURRENT_BRANCH=$(git branch --show-current)
echo "📋 Current branch: $CURRENT_BRANCH"

# Create results directory
mkdir -p benchmark-results
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
RESULTS_FILE="benchmark-results/build-performance-$TIMESTAMP.txt"

echo "📊 Results will be saved to: $RESULTS_FILE"
echo "" | tee "$RESULTS_FILE"
echo "TypeScript Project References Build Performance Benchmark" | tee -a "$RESULTS_FILE"
echo "Timestamp: $(date)" | tee -a "$RESULTS_FILE"
echo "=========================================================" | tee -a "$RESULTS_FILE"

# Function to run benchmark
run_benchmark() {
    local branch_name=$1
    local description=$2
    
    echo "" | tee -a "$RESULTS_FILE"
    echo "🚀 Testing: $description (branch: $branch_name)" | tee -a "$RESULTS_FILE"
    echo "-------------------------------------------" | tee -a "$RESULTS_FILE"
    
    # Switch to branch
    git checkout "$branch_name" 2>/dev/null
    
    # Clean build benchmark
    echo "🧹 Clean Build Performance:" | tee -a "$RESULTS_FILE"
    hyperfine --warmup 1 --runs 3 --export-markdown "$RESULTS_FILE.tmp" \
        "pnpm clean && pnpm turbo run build" 2>&1 | tee -a "$RESULTS_FILE"
    
    # Add markdown table if it exists
    if [ -f "$RESULTS_FILE.tmp" ]; then
        cat "$RESULTS_FILE.tmp" >> "$RESULTS_FILE"
        rm "$RESULTS_FILE.tmp"
    fi
    
    # Incremental build benchmark (make a small change)
    echo "" | tee -a "$RESULTS_FILE"
    echo "⚡ Incremental Build Performance (after small change):" | tee -a "$RESULTS_FILE"
    
    # Make a small change to types package
    echo "export const BENCHMARK_CHANGE_$TIMESTAMP = 'test'" >> packages/types/src/index.ts
    
    hyperfine --warmup 1 --runs 2 --export-markdown "$RESULTS_FILE.tmp" \
        "pnpm turbo run build" 2>&1 | tee -a "$RESULTS_FILE"
    
    # Add markdown table if it exists
    if [ -f "$RESULTS_FILE.tmp" ]; then
        cat "$RESULTS_FILE.tmp" >> "$RESULTS_FILE"
        rm "$RESULTS_FILE.tmp"
    fi
    
    # Revert the change
    git checkout -- packages/types/src/index.ts 2>/dev/null || true
}

# Benchmark main branch (before project references)
echo "🔄 Benchmarking main branch (before project references)..."
if git show-ref --verify --quiet refs/heads/main; then
    run_benchmark "main" "Before: Individual TypeScript Compilation"
else
    echo "⚠️  Main branch not found, skipping baseline benchmark"
fi

# Benchmark current branch (after project references)
echo "🔄 Benchmarking current branch (project references)..."
run_benchmark "$CURRENT_BRANCH" "After: TypeScript Project References"

# Return to original branch
git checkout "$CURRENT_BRANCH" 2>/dev/null

echo "" | tee -a "$RESULTS_FILE"
echo "✅ Benchmark completed!" | tee -a "$RESULTS_FILE"
echo "📊 Results saved to: $RESULTS_FILE" | tee -a "$RESULTS_FILE"

# Display summary
echo ""
echo "📋 Summary:"
echo "- Clean build performance shows overall compilation time"
echo "- Incremental build performance shows TypeScript's project references benefits"
echo "- Look for significant improvements in incremental builds (50-80% faster expected)"
echo "- VSCode error detection improvements are qualitative (immediate vs delayed feedback)"

echo ""
echo "🔍 To view detailed results: cat $RESULTS_FILE"