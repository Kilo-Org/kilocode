/**
 * SetupScriptService - Manages worktree setup scripts
 *
 * Handles reading, creating, and checking for setup scripts stored in .kilocode/setup-script.
 * Setup scripts run before an agent starts in a worktree (new sessions only).
 */

import * as vscode from "vscode"
import * as fs from "node:fs"
import * as path from "node:path"

const SETUP_SCRIPT_FILENAME = "setup-script"
const KILOCODE_DIR = ".kilocode"

/**
 * Default template for the setup script with helpful comments
 */
const DEFAULT_SCRIPT_TEMPLATE = `#!/bin/bash
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

export class SetupScriptService {
	private readonly projectRoot: string
	private readonly scriptPath: string

	constructor(projectRoot: string) {
		this.projectRoot = projectRoot
		this.scriptPath = path.join(projectRoot, KILOCODE_DIR, SETUP_SCRIPT_FILENAME)
	}

	/**
	 * Get the path to the setup script
	 */
	getScriptPath(): string {
		return this.scriptPath
	}

	/**
	 * Check if a setup script exists
	 */
	hasScript(): boolean {
		return fs.existsSync(this.scriptPath)
	}

	/**
	 * Read the setup script content
	 * @returns Script content if exists, null otherwise
	 */
	async getScript(): Promise<string | null> {
		if (!this.hasScript()) {
			return null
		}

		try {
			return await fs.promises.readFile(this.scriptPath, "utf-8")
		} catch {
			return null
		}
	}

	/**
	 * Create a default setup script with helpful comments and open it in VS Code
	 */
	async createDefaultScript(): Promise<void> {
		// Ensure .kilocode directory exists
		const kilocodeDir = path.join(this.projectRoot, KILOCODE_DIR)
		if (!fs.existsSync(kilocodeDir)) {
			await fs.promises.mkdir(kilocodeDir, { recursive: true })
		}

		// Write the default template
		await fs.promises.writeFile(this.scriptPath, DEFAULT_SCRIPT_TEMPLATE, "utf-8")

		// Make executable on Unix systems
		if (process.platform !== "win32") {
			await fs.promises.chmod(this.scriptPath, 0o755)
		}
	}

	/**
	 * Open the setup script in VS Code editor
	 * Creates the default script if it doesn't exist
	 */
	async openInEditor(): Promise<void> {
		if (!this.hasScript()) {
			await this.createDefaultScript()
		}

		const document = await vscode.workspace.openTextDocument(this.scriptPath)
		await vscode.window.showTextDocument(document)
	}
}
