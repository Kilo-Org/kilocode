/** Default POSIX template for worktree setup scripts. */
export const SETUP_SCRIPT_TEMPLATE = `#!/bin/sh
# Kilo Code Worktree Setup Script
# This script runs before the agent starts in a worktree (new sessions only).
#
# Available environment variables:
#   WORKTREE_PATH  - Absolute path to the worktree directory
#   REPO_PATH      - Absolute path to the main repository
#
# Example tasks:
#   - Copy .env files from main repo
#   - Install dependencies
#   - Run database migrations
#   - Set up local configuration

set -e  # Exit on error

echo "Setting up worktree: $WORKTREE_PATH"

# Uncomment and modify as needed:

# Copy environment files
# if [ -f "$REPO_PATH/.env" ]; then
#     cp "$REPO_PATH/.env" "$WORKTREE_PATH/.env"
#     echo "Copied .env"
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
# Example tasks:
#   - Copy .env files from main repo
#   - Install dependencies
#   - Run database migrations
#   - Set up local configuration

$ErrorActionPreference = "Stop"

Write-Host "Setting up worktree: $env:WORKTREE_PATH"

# Uncomment and modify as needed:

# Copy environment files
# if (Test-Path "$env:REPO_PATH/.env") {
#   Copy-Item "$env:REPO_PATH/.env" "$env:WORKTREE_PATH/.env" -Force
#   Write-Host "Copied .env"
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
