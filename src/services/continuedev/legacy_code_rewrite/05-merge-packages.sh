#!/bin/bash
set -e

echo "=== Phase 8 Extension: Package Merge Script ==="
echo "This script merges all @continuedev/* packages into core/"
echo ""

# Already completed:
# - config-types merged to core/config-types/
# - fetch merged to core/fetch/
# - llm-info merged to core/llm-info/
# - openai-adapters merged to core/llm/openai-adapters/

echo "Step 1: Handle config-yaml (special case - overlaps with existing core/config/yaml/)"
echo "-----------------------------------------------------------------------"

# Rename existing core/config/yaml/ to core/config/yaml-loader/
if [ -d "core/config/yaml" ]; then
    echo "Renaming core/config/yaml/ to core/config/yaml-loader/"
    mv core/config/yaml core/config/yaml-loader
    
    # Update imports that reference the old path
    find core/ -name "*.ts" -type f -exec sed -i.bak 's|from "\([./]*\)config/yaml"|from "\1config/yaml-loader"|g' {} \;
    find core/ -name "*.ts" -type f -exec sed -i.bak 's|from "\([./]*\)config/yaml/|from "\1config/yaml-loader/|g' {} \;
fi

# Copy config-yaml package content
echo "Copying packages/config-yaml/src to core/config/yaml/"
cp -r packages/config-yaml/src core/config/yaml

echo ""
echo "Step 2: Update all package imports systematically"
echo "-----------------------------------------------------------------------"

# Function to calculate relative path depth
update_imports() {
    local dir=$1
    local depth=$2
    local package=$3
    local target=$4
    
    echo "Updating $package imports in $dir (depth: $depth)"
    
    case $depth in
        1) prefix="../" ;;
        2) prefix="../../" ;;
        3) prefix="../../../" ;;
        *) prefix="../" ;;
    esac
    
    find "$dir" -maxdepth 1 -name "*.ts" -type f -exec sed -i.bak "s|from \"@continuedev/$package\"|from \"${prefix}${target}\"|g" {} \;
}

# Update llm-info imports
echo "Updating @continuedev/llm-info imports..."
find core/llm/llms/ -name "*.ts" -type f -exec sed -i.bak 's|from "@continuedev/llm-info"|from "../../llm-info"|g' {} \;
find core/llm/ -maxdepth 1 -name "*.ts" -type f -exec sed -i.bak 's|from "@continuedev/llm-info"|from "../llm-info"|g' {} \;

# Update openai-adapters imports  
echo "Updating @continuedev/openai-adapters imports..."
find core/llm/llms/ -name "*.ts" -type f -exec sed -i.bak 's|from "@continuedev/openai-adapters"|from "../openai-adapters"|g' {} \;
find core/llm/ -maxdepth 1 -name "*.ts" -type f -exec sed -i.bak 's|from "@continuedev/openai-adapters"|from "./openai-adapters"|g' {} \;

# Update config-yaml imports (most complex)
echo "Updating @continuedev/config-yaml imports..."
find core/ -name "*.ts" -type f -exec sed -i.bak 's|from "@continuedev/config-yaml"|from "../config/yaml"|g' {} \;
# Fix depths for nested directories
find core/config/ -name "*.ts" -type f -exec sed -i.bak 's|from "../config/yaml"|from "./yaml"|g' {} \;
find core/llm/ -name "*.ts" -type f -exec sed -i.bak 's|from "../config/yaml"|from "../../config/yaml"|g' {} \;
find core/autocomplete/ -name "*.ts" -type f -exec sed -i.bak 's|from "../config/yaml"|from "../../config/yaml"|g' {} \;

# Update extensions/vscode imports
echo "Updating imports in extensions/vscode/..."
find extensions/vscode/src/ -name "*.ts" -type f -exec sed -i.bak 's|from "@continuedev/config-types"|from "../../../core/config-types"|g' {} \;
find extensions/vscode/src/ -name "*.ts" -type f -exec sed -i.bak 's|from "@continuedev/fetch"|from "../../../core/fetch"|g' {} \;

echo ""
echo "Step 3: Clean up backup files"
echo "-----------------------------------------------------------------------"
find core/ extensions/vscode/src/ -name "*.bak" -delete

echo ""
echo "Step 4: Remove package dependencies from package.json"
echo "-----------------------------------------------------------------------"

# This step requires manual editing or jq, documenting for now
echo "TODO: Remove from package.json files:"
echo "  - core/package.json: @continuedev/config-types, @continuedev/config-yaml, @continuedev/fetch, @continuedev/llm-info, @continuedev/openai-adapters"
echo "  - extensions/vscode/package.json: @continuedev/config-types, @continuedev/fetch"
echo "  - root package.json: (check if any)"

echo ""
echo "Step 5: Verification"
echo "-----------------------------------------------------------------------"
echo "Checking for remaining @continuedev/ imports..."
remaining=$(grep -r "@continuedev/" core/ extensions/vscode/src/ --include="*.ts" 2>/dev/null | grep -v node_modules | wc -l)
echo "Found $remaining remaining @continuedev/ imports"

if [ "$remaining" -gt 0 ]; then
    echo "Remaining imports:"
    grep -r "@continuedev/" core/ extensions/vscode/src/ --include="*.ts" 2>/dev/null | grep -v node_modules
fi

echo ""
echo "=== Package Merge Script Complete ==="
echo ""
echo "Next steps:"
echo "1. Manually update package.json files to remove @continuedev/* dependencies"
echo "2. Run: npm install (in core/, extensions/vscode/, and root)"
echo "3. Run: ./test-autocomplete.sh"
echo "4. If tests pass, commit changes"
echo "5. Update knip.json to remove packages/** from ignore"
echo "6. Re-run Knip analysis"