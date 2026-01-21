#!/bin/bash
# SPDX-FileCopyrightText: 2025 Weibo, Inc.
# SPDX-License-Identifier: Apache-2.0

# Script to check command consistency between JetBrains plugin and VSCode extension
# Parses command IDs from both plugin.xml.template and package.json
# Handles naming convention differences (kilocode. vs kilo-code.)

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Paths
JETBRAINS_XML="jetbrains/plugin/src/main/resources/META-INF/plugin.xml.template"
VSCODE_PACKAGE="src/package.json"

# Commands that are intentionally platform-specific and should be excluded from comparison
# JetBrains-only commands (in kilocode. format)
JETBRAINS_ONLY_COMMANDS=(
    "kilocode.generateCommitMessage"  # JetBrains has its own commit message integration
    "kilocode.RightClickMenu"         # JetBrains-specific menu group
    "kilocode.RightClick.Chat"        # JetBrains-specific menu group
)

# VSCode-only commands (in kilocode. format for comparison)
VSCODE_ONLY_COMMANDS=(
    "kilocode.acceptInput"
    "kilocode.addToContext"
    "kilocode.agentManagerOpen"
    "kilocode.explainCode"
    "kilocode.exportSettings"
    "kilocode.fixCode"
    "kilocode.focusChatInput"
    "kilocode.generateTerminalCommand"
    "kilocode.helpButtonClicked"
    "kilocode.importSettings"
    "kilocode.improveCode"
    "kilocode.marketplaceButtonClicked"
    "kilocode.newTask"
    "kilocode.open"
    "kilocode.openInNewTab"
    "kilocode.popoutButtonClicked"
    "kilocode.promptsButtonClicked"
    "kilocode.setCustomStoragePath"
    "kilocode.terminalAddToContext"
    "kilocode.terminalExplainCommand"
    "kilocode.terminalFixCommand"
    "kilocode.toggleAutoApprove"
)

# Function to check if a command is in an exclusion list
is_excluded() {
    local cmd="$1"
    shift
    local exclusions=("$@")
    for excluded in "${exclusions[@]}"; do
        if [[ "$cmd" == "$excluded" ]]; then
            return 0
        fi
    done
    return 1
}

# Check if files exist
if [[ ! -f "$JETBRAINS_XML" ]]; then
    echo -e "${RED}Error: JetBrains plugin.xml.template not found at $JETBRAINS_XML${NC}"
    exit 1
fi

if [[ ! -f "$VSCODE_PACKAGE" ]]; then
    echo -e "${RED}Error: VSCode package.json not found at $VSCODE_PACKAGE${NC}"
    exit 1
fi

echo "Checking command consistency between JetBrains plugin and VSCode extension..."
echo ""

# Extract JetBrains commands (action id attributes with kilocode. prefix)
# JetBrains uses kilocode. prefix (with dot, no hyphen)
JETBRAINS_COMMANDS=$(grep -oE 'id="kilocode\.[a-zA-Z0-9][a-zA-Z0-9_-]*"' "$JETBRAINS_XML" 2>/dev/null | sed 's/id="//;s/"$//' | grep -v '^$' | sort -u || true)

if [[ -z "$JETBRAINS_COMMANDS" ]]; then
    echo -e "${YELLOW}Warning: No commands found in JetBrains plugin.xml.template${NC}"
    JETBRAINS_COMMANDS=""
fi

# Extract VSCode commands (command field in JSON with kilo-code. prefix)
# VSCode uses kilo-code. prefix (with hyphen)
VSCODE_COMMANDS=$(grep -oE '"command":\s*"kilo-code\.[a-zA-Z0-9][a-zA-Z0-9_-]*"' "$VSCODE_PACKAGE" 2>/dev/null | sed -E 's/"command":[[:space:]]*"//;s/"$//' | grep -v '^$' | sort -u || true)

if [[ -z "$VSCODE_COMMANDS" ]]; then
    echo -e "${YELLOW}Warning: No commands found in VSCode package.json${NC}"
    VSCODE_COMMANDS=""
fi

echo "Found JetBrains commands:"
if [[ -n "$JETBRAINS_COMMANDS" ]]; then
    echo "$JETBRAINS_COMMANDS" | sed 's/^/  - /'
else
    echo "  (none)"
fi
echo ""

echo "Found VSCode commands:"
if [[ -n "$VSCODE_COMMANDS" ]]; then
    echo "$VSCODE_COMMANDS" | sed 's/^/  - /'
else
    echo "  (none)"
fi
echo ""

# Function to convert JetBrains command to VSCode format
# kilocode.xxx -> kilo-code.xxx
convert_to_vscode_format() {
    echo "$1" | sed 's/^kilocode\./kilo-code./'
}

# Function to convert VSCode command to JetBrains format
# kilo-code.xxx -> kilocode.xxx
convert_to_jetbrains_format() {
    echo "$1" | sed 's/^kilo-code\./kilocode./'
}

# Normalize commands to JetBrains format for comparison
# Only convert VSCode commands (kilo-code. -> kilocode.) for comparison
echo "Normalizing commands for comparison..."
echo ""

# Create temporary files for normalized commands
JETBRAINS_NORMALIZED=$(echo "$JETBRAINS_COMMANDS" | sort -u)

VSCODE_NORMALIZED=$(echo "$VSCODE_COMMANDS" | while read cmd; do
    # Convert VSCode kilo-code. to kilocode. for comparison
    convert_to_jetbrains_format "$cmd"
done | sort -u)

# Find missing commands (in JetBrains but not in VSCode)
MISSING_IN_VSCODE_RAW=$(comm -23 <(echo "$JETBRAINS_NORMALIZED") <(echo "$VSCODE_NORMALIZED"))

# Find extra commands (in VSCode but not in JetBrains)
EXTRA_IN_VSCODE_RAW=$(comm -13 <(echo "$JETBRAINS_NORMALIZED") <(echo "$VSCODE_NORMALIZED"))

# Filter out excluded commands
MISSING_IN_VSCODE=""
while IFS= read -r cmd; do
    [[ -z "$cmd" ]] && continue
    if ! is_excluded "$cmd" "${JETBRAINS_ONLY_COMMANDS[@]}"; then
        MISSING_IN_VSCODE="${MISSING_IN_VSCODE}${cmd}"$'\n'
    fi
done <<< "$MISSING_IN_VSCODE_RAW"
MISSING_IN_VSCODE=$(echo "$MISSING_IN_VSCODE" | grep -v '^$' || true)

EXTRA_IN_VSCODE=""
while IFS= read -r cmd; do
    [[ -z "$cmd" ]] && continue
    if ! is_excluded "$cmd" "${VSCODE_ONLY_COMMANDS[@]}"; then
        EXTRA_IN_VSCODE="${EXTRA_IN_VSCODE}${cmd}"$'\n'
    fi
done <<< "$EXTRA_IN_VSCODE_RAW"
EXTRA_IN_VSCODE=$(echo "$EXTRA_IN_VSCODE" | grep -v '^$' || true)

# Report results
echo "=========================================="
echo "Command Consistency Check Results"
echo "=========================================="
echo ""

# Show excluded commands info
echo -e "${YELLOW}Platform-specific commands (excluded from comparison):${NC}"
echo "  JetBrains-only: ${#JETBRAINS_ONLY_COMMANDS[@]} commands"
echo "  VSCode-only: ${#VSCODE_ONLY_COMMANDS[@]} commands"
echo ""

# Check for issues
HAS_ISSUES=0

if [[ -n "$MISSING_IN_VSCODE" ]]; then
    HAS_ISSUES=1
    echo -e "${RED}Commands missing in VSCode (present in JetBrains):${NC}"
    echo "$MISSING_IN_VSCODE" | while read cmd; do
        [[ -z "$cmd" ]] && continue
        vscode_version=$(convert_to_vscode_format "$cmd")
        echo "  - JetBrains: $cmd"
        echo "    Expected in VSCode: $vscode_version"
    done
    echo ""
fi

if [[ -n "$EXTRA_IN_VSCODE" ]]; then
    HAS_ISSUES=1
    echo -e "${RED}Extra commands in VSCode (not present in JetBrains):${NC}"
    echo "$EXTRA_IN_VSCODE" | while read cmd; do
        [[ -z "$cmd" ]] && continue
        # Convert back to VSCode format for display
        vscode_original=$(convert_to_vscode_format "$cmd")
        jetbrains_version=$(convert_to_jetbrains_format "$vscode_original")
        echo "  - VSCode: $vscode_original"
        echo "    Missing in JetBrains: $jetbrains_version"
    done
    echo ""
fi

if [[ $HAS_ISSUES -eq 0 ]]; then
    echo -e "${GREEN}✓ All commands are consistent between JetBrains and VSCode!${NC}"
    echo ""
    echo "JetBrains commands: $(echo "$JETBRAINS_COMMANDS" | grep -c '^' || echo 0)"
    echo "VSCode commands: $(echo "$VSCODE_COMMANDS" | grep -c '^' || echo 0)"
    echo ""
    exit 0
else
    echo -e "${RED}✗ Command consistency check failed!${NC}"
    echo ""
    echo "Missing in VSCode: $(echo "$MISSING_IN_VSCODE" | grep -c '^' || echo 0) commands"
    echo "Extra in VSCode: $(echo "$EXTRA_IN_VSCODE" | grep -c '^' || echo 0) commands"
    echo ""
    echo "Please update the missing commands in the appropriate configuration file."
    echo "Or add them to the exclusion lists if they are intentionally platform-specific."
    exit 1
fi
