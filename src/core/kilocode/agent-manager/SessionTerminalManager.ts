import * as vscode from "vscode"
import type { AgentRegistry } from "./AgentRegistry"
import { buildParallelModeWorktreePath } from "./parallelModeParser"

/**
 * Manages VS Code terminals for agent sessions.
 * Each session can have an associated terminal that opens in the session's worktree directory,
 * or the main workspace folder for non-worktree sessions.
 */
export class SessionTerminalManager {
	private sessionTerminals = new Map<string, { terminal: vscode.Terminal; cwd: string }>()
	private disposables: vscode.Disposable[] = []

	constructor(
		private registry: AgentRegistry,
		private outputChannel: vscode.OutputChannel,
	) {
		// Clean up map when terminals are closed by user
		this.disposables.push(
			vscode.window.onDidCloseTerminal((terminal) => {
				for (const [sessionId, entry] of this.sessionTerminals) {
					if (entry.terminal === terminal) {
						this.sessionTerminals.delete(sessionId)
						this.outputChannel.appendLine(
							`[AgentManager] Removed terminal mapping for session ${sessionId} (terminal closed)`,
						)
						break
					}
				}
			}),
		)
	}

	/**
	 * Get the current workspace folder path.
	 */
	private getWorkspacePath(): string | undefined {
		return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
	}

	/**
	 * Show (or create) a terminal for the given session.
	 * For worktree sessions, the terminal's cwd is set to the worktree path.
	 * For local sessions, the terminal's cwd is set to the main workspace folder.
	 * For remote-only sessions (not in registry), uses the workspace folder.
	 */
	showTerminal(sessionId: string): void {
		const session = this.registry.getSession(sessionId)
		const workspacePath = this.getWorkspacePath()

		// Handle remote-only sessions (not in registry)
		// These are sessions from cloud history that haven't been resumed yet
		if (!session) {
			this.outputChannel.appendLine(
				`[AgentManager] showTerminal: session not in registry (${sessionId}), using workspace folder`,
			)

			if (!workspacePath) {
				this.outputChannel.appendLine(`[AgentManager] showTerminal: no workspace folder open`)
				vscode.window.showWarningMessage("No workspace folder open")
				return
			}

			// Create or show terminal for remote session using workspace folder
			this.showOrCreateTerminal(sessionId, workspacePath, `Agent: Session`)
			return
		}

		const isParallelSession = session.parallelMode?.enabled ?? false
		const branchName = session.parallelMode?.branch
		let worktreePath = session.parallelMode?.worktreePath
		if (isParallelSession && !worktreePath && branchName) {
			worktreePath = buildParallelModeWorktreePath(branchName)
			this.registry.updateParallelModeInfo(sessionId, { worktreePath })
			this.outputChannel.appendLine(
				`[AgentManager] showTerminal: derived worktree path from branch ${branchName}: ${worktreePath}`,
			)
		}
		this.outputChannel.appendLine(
			`[AgentManager] showTerminal: session=${sessionId} parallel=${isParallelSession} worktreePath=${worktreePath ?? "undefined"} workspacePath=${workspacePath ?? "undefined"}`,
		)

		if (isParallelSession && !worktreePath) {
			this.outputChannel.appendLine(
				`[AgentManager] showTerminal: worktree path missing for parallel session ${sessionId}`,
			)
			vscode.window.showWarningMessage("Worktree path not available yet")
			return
		}

		const terminalCwd = worktreePath || workspacePath

		if (!terminalCwd) {
			this.outputChannel.appendLine(`[AgentManager] showTerminal: no cwd resolved for session ${sessionId}`)
			vscode.window.showWarningMessage("No workspace folder open")
			return
		}

		// For worktree sessions, use branch name; for local sessions, use session label
		const terminalName = worktreePath
			? `Agent: ${session.parallelMode?.branch || session.label}`
			: `Agent: ${session.label} (local)`

		this.showOrCreateTerminal(sessionId, terminalCwd, terminalName)
	}

	/**
	 * Show an existing terminal or create a new one for the session.
	 */
	private showOrCreateTerminal(sessionId: string, terminalCwd: string, terminalName: string): void {
		let entry = this.sessionTerminals.get(sessionId)

		// Check if terminal still exists (user might have closed it)
		if (entry && entry.terminal.exitStatus !== undefined) {
			this.sessionTerminals.delete(sessionId)
			entry = undefined
			this.outputChannel.appendLine(
				`[AgentManager] showTerminal: previous terminal exited for session ${sessionId}`,
			)
		}

		if (entry && entry.cwd !== terminalCwd) {
			entry.terminal.dispose()
			this.sessionTerminals.delete(sessionId)
			entry = undefined
			this.outputChannel.appendLine(
				`[AgentManager] showTerminal: terminal cwd changed for session ${sessionId}, recreating (${terminalCwd})`,
			)
		}

		if (!entry) {
			const terminal = vscode.window.createTerminal({
				cwd: terminalCwd,
				name: terminalName,
				iconPath: new vscode.ThemeIcon("terminal"),
			})
			entry = { terminal, cwd: terminalCwd }
			this.sessionTerminals.set(sessionId, entry)
			this.outputChannel.appendLine(
				`[AgentManager] showTerminal: created terminal for session ${sessionId} (cwd=${terminalCwd})`,
			)
		}

		entry.terminal.show()
	}

	/**
	 * Close the terminal associated with a session.
	 */
	closeTerminal(sessionId: string): void {
		const entry = this.sessionTerminals.get(sessionId)
		if (entry) {
			entry.terminal.dispose()
			this.sessionTerminals.delete(sessionId)
			this.outputChannel.appendLine(`[AgentManager] closeTerminal: disposed terminal for ${sessionId}`)
		}
	}

	/**
	 * Show the terminal for a session only if it already exists.
	 */
	showExistingTerminal(sessionId: string): boolean {
		const entry = this.sessionTerminals.get(sessionId)
		if (!entry) {
			return false
		}

		if (entry.terminal.exitStatus !== undefined) {
			this.sessionTerminals.delete(sessionId)
			this.outputChannel.appendLine(
				`[AgentManager] showExistingTerminal: terminal exited for session ${sessionId}, clearing mapping`,
			)
			return false
		}

		entry.terminal.show()
		this.outputChannel.appendLine(`[AgentManager] showExistingTerminal: revealed terminal for session ${sessionId}`)
		return true
	}

	/**
	 * Check if a session has an active terminal.
	 */
	hasTerminal(sessionId: string): boolean {
		const entry = this.sessionTerminals.get(sessionId)
		return entry !== undefined && entry.terminal.exitStatus === undefined
	}

	/**
	 * Dispose of all resources.
	 */
	dispose(): void {
		this.disposables.forEach((d) => d.dispose())
		// Optionally close all agent terminals on extension deactivate
		// For now, we leave them open so users can continue using them
	}
}
