/** Default POSIX template for worktree setup scripts. */
export const SETUP_SCRIPT_TEMPLATE = `#!/bin/sh
# Kilo Code Worktree Setup Script
# This script runs before the agent starts in a worktree (new sessions only).
#
# Available environment variables:
#   WORKTREE_PATH  - Absolute path to the worktree directory
#   REPO_PATH      - Absolute path to the main repository
#
# Kilo already copies root-level .env and .env.* files before this script runs.
# Use this script for dependencies, nested env files, local config, databases,
# certificates, or other project-specific setup that is not committed to git.
#
# Example tasks:
#   - Copy nested env files from main repo
#   - Install dependencies
#   - Run database migrations
#   - Set up local configuration

set -e  # Exit on error

echo "Setting up worktree: $WORKTREE_PATH"

# Uncomment and modify as needed:

# Copy a nested environment file
# if [ -f "$REPO_PATH/apps/web/.env.local" ] && [ ! -f "$WORKTREE_PATH/apps/web/.env.local" ]; then
#     cp "$REPO_PATH/apps/web/.env.local" "$WORKTREE_PATH/apps/web/.env.local"
#     echo "Copied apps/web/.env.local"
# fi

# Install dependencies (Node.js)
# if [ -f "$WORKTREE_PATH/package.json" ]; then
#     cd "$WORKTREE_PATH"
#     npm install
# fi

# Install dependencies (Python)
# if [ -f "$WORKTREE_PATH/requirements.txt" ]; then
#     cd "$WORKTREE_PATH"
#     pip install -r requirements.txt
# fi

echo "Setup complete!"
`

/** Default PowerShell template for worktree setup scripts on Windows. */
export const SETUP_SCRIPT_TEMPLATE_POWERSHELL = `# Kilo Code Worktree Setup Script
# This script runs before the agent starts in a worktree (new sessions only).
#
# Available environment variables:
#   $env:WORKTREE_PATH  - Absolute path to the worktree directory
#   $env:REPO_PATH      - Absolute path to the main repository
#
# Kilo already copies root-level .env and .env.* files before this script runs.
# Use this script for dependencies, nested env files, local config, databases,
# certificates, or other project-specific setup that is not committed to git.
#
# Example tasks:
#   - Copy nested env files from main repo
#   - Install dependencies
#   - Run database migrations
#   - Set up local configuration

$ErrorActionPreference = "Stop"

Write-Host "Setting up worktree: $env:WORKTREE_PATH"

# Uncomment and modify as needed:

# Copy a nested environment file
# if ((Test-Path "$env:REPO_PATH/apps/web/.env.local") -and !(Test-Path "$env:WORKTREE_PATH/apps/web/.env.local")) {
#   Copy-Item "$env:REPO_PATH/apps/web/.env.local" "$env:WORKTREE_PATH/apps/web/.env.local"
#   Write-Host "Copied apps/web/.env.local"
# }

# Install dependencies (Node.js)
# if (Test-Path "$env:WORKTREE_PATH/package.json") {
#   Set-Location "$env:WORKTREE_PATH"
#   npm install
# }

# Install dependencies (Python)
# if (Test-Path "$env:WORKTREE_PATH/requirements.txt") {
#   Set-Location "$env:WORKTREE_PATH"
#   pip install -r requirements.txt
# }

Write-Host "Setup complete!"
`
