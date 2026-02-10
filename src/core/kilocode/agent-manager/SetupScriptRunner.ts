/**
 * SetupScriptRunner - Executes worktree setup scripts
 *
 * Runs setup scripts in VS Code integrated terminal before agent starts.
 * Script output is visible to the user in the terminal.
 * Script failures don't block session start (non-blocking).
 */

import * as vscode from "vscode"
import * as path from "node:path"
import { SetupScriptService } from "./SetupScriptService"

export interface SetupScriptEnvironment {
	/** Absolute path to the worktree directory */
	worktreePath: string
	/** Absolute path to the main repository */
	repoPath: string
}

export class SetupScriptRunner {
	constructor(
		private readonly outputChannel: vscode.OutputChannel,
		private readonly setupScriptService: SetupScriptService,
	) {}

	/**
	 * Execute setup script in a worktree if script exists.
	 * Only runs for NEW sessions, not when resuming an existing session.
	 * Script runs in VS Code integrated terminal - output visible to user.
	 * Script failures don't block session start.
	 *
	 * @param env Environment variables for the script
	 * @returns true if script was executed, false if skipped (no script configured)
	 */
	async runIfConfigured(env: SetupScriptEnvironment): Promise<boolean> {
		// Check if script exists
		if (!this.setupScriptService.hasScript()) {
			this.log("No setup script configured, skipping")
			return false
		}

		const scriptPath = this.setupScriptService.getScriptPath()
		this.log(`Running setup script: ${scriptPath}`)

		try {
			await this.executeInTerminal(scriptPath, env)
			return true
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error)
			this.log(`Setup script execution failed: ${errorMsg}`)
			// Non-blocking - we don't throw, just log the error
			return true // Script was attempted
		}
	}

	/**
	 * Execute the setup script in a VS Code terminal.
	 * The terminal shows output to the user.
	 */
	private async executeInTerminal(scriptPath: string, env: SetupScriptEnvironment): Promise<void> {
		const shellPath = process.platform === "win32" ? undefined : process.env.SHELL
		const shellName = shellPath ? path.basename(shellPath) : undefined
		const shellArgs = process.platform === "win32" ? undefined : shellName === "zsh" ? ["-l", "-i"] : ["-l"]

		// Create terminal with environment variables
		const terminal = vscode.window.createTerminal({
			name: "Worktree Setup",
			cwd: env.worktreePath,
			shellPath,
			shellArgs,
			env: {
				WORKTREE_PATH: env.worktreePath,
				REPO_PATH: env.repoPath,
			},
			iconPath: new vscode.ThemeIcon("gear"),
		})

		// Build the command to execute
		const command = this.buildCommand(scriptPath, env)

		// Show terminal and execute
		terminal.show(true) // true = preserve focus on editor
		terminal.sendText(command)

		this.log(`Setup script started in terminal`)
	}

	/**
	 * Build the shell command to execute the setup script.
	 * Cross-platform: uses sh on Unix, cmd on Windows.
	 */
	private buildCommand(scriptPath: string, env: SetupScriptEnvironment): string {
		// Export environment variables and run the script
		if (process.platform === "win32") {
			// Windows: set environment variables and run script
			return [
				`set "WORKTREE_PATH=${env.worktreePath}"`,
				`set "REPO_PATH=${env.repoPath}"`,
				`"${scriptPath}"`,
			].join(" && ")
		} else {
			// Unix: export environment variables and run script with sh
			// We use sh explicitly to ensure the script runs even if it doesn't have execute permission
			return [
				`export WORKTREE_PATH="${env.worktreePath}"`,
				`export REPO_PATH="${env.repoPath}"`,
				`sh "${scriptPath}"`,
			].join(" && ")
		}
	}

	private log(message: string): void {
		this.outputChannel.appendLine(`[SetupScriptRunner] ${message}`)
	}
}
