import { PTYManager, CommandExecution } from "./PTYManager"
import { TerminalBuffer, SearchResult } from "./TerminalBuffer"
import { EventEmitter } from "events"
import * as vscode from "vscode"

export interface ShellCommandOptions {
	timeout?: number
	captureOutput?: boolean
	requireApproval?: boolean
	workingDirectory?: string
}

export interface ShellCommandResult {
	command: string
	exitCode: number | null
	stdout: string
	stderr: string
	duration: number
	timestamp: number
	success: boolean
}

export interface ListenPattern {
	name: string
	regex: RegExp
	description?: string
	action?: "trigger" | "log" | "highlight"
}

export interface PatternMatchEvent {
	pattern: ListenPattern
	matches: string[]
	timestamp: number
	context: string
}

export interface CommandApprovalRequest {
	command: string
	workingDirectory: string
	requestId: string
	timestamp: number
}

/**
 * AI Action Tools - Specialized toolset for AntiGravity Agents
 * Provides terminal execution and monitoring capabilities for AI agents
 */
export class AIActionTools extends EventEmitter {
	private ptyManager: PTYManager
	private terminalBuffer: TerminalBuffer
	private activePatterns: Map<string, ListenPattern> = new Map()
	private pendingApprovals: Map<string, CommandApprovalRequest> = new Map()
	private isListening = false
	private approvalRequired = true

	constructor(
		ptyManager: PTYManager,
		terminalBuffer: TerminalBuffer,
		private outputChannel: vscode.OutputChannel,
	) {
		super()
		this.ptyManager = ptyManager
		this.terminalBuffer = terminalBuffer
		this.setupEventHandlers()
	}

	private setupEventHandlers(): void {
		// Forward PTY events
		this.ptyManager.on("output", (entry) => {
			this.emit("terminalOutput", entry)
		})

		this.ptyManager.on("patternMatch", (match) => {
			this.handlePatternMatch(match)
		})

		this.ptyManager.on("commandStarted", (command) => {
			this.emit("commandStarted", command)
		})

		this.ptyManager.on("processExit", ({ exitCode }) => {
			this.emit("commandCompleted", { exitCode })
		})
	}

	/**
	 * Execute a shell command and return the result
	 */
	public async executeShellCommand(command: string, options: ShellCommandOptions = {}): Promise<ShellCommandResult> {
		const {
			timeout = 30000,
			captureOutput = true,
			requireApproval = this.approvalRequired,
			workingDirectory = this.ptyManager.getTerminalInfo().cwd,
		} = options

		this.outputChannel.appendLine(`[AI Action Tools] Executing command: ${command}`)

		// Check if approval is required
		if (requireApproval) {
			const approved = await this.requestCommandApproval(command, workingDirectory)
			if (!approved) {
				throw new Error("Command execution denied by user")
			}
		}

		const startTime = Date.now()
		let stdout = ""
		let stderr = ""
		let exitCode: number | null = null
		let timeoutHandle: NodeJS.Timeout | null = null

		try {
			// Set up output capture
			const outputHandler = (entry: any) => {
				if (captureOutput) {
					if (entry.type === "stdout") {
						stdout += entry.content
					} else if (entry.type === "stderr") {
						stderr += entry.content
					}
				}
			}

			this.ptyManager.on("output", outputHandler)

			// Set up timeout
			if (timeout > 0) {
				timeoutHandle = setTimeout(() => {
					this.outputChannel.appendLine(`[AI Action Tools] Command timeout: ${command}`)
					this.ptyManager.kill()
				}, timeout)
			}

			// Execute the command
			const execution = await this.ptyManager.executeCommand(command)
			exitCode = execution.exitCode ?? null

			// Clear timeout
			if (timeoutHandle) {
				clearTimeout(timeoutHandle)
			}

			// Remove output handler
			this.ptyManager.off("output", outputHandler)
		} catch (error) {
			if (timeoutHandle) {
				clearTimeout(timeoutHandle)
			}
			throw error
		}

		const duration = Date.now() - startTime
		const result: ShellCommandResult = {
			command,
			exitCode,
			stdout,
			stderr,
			duration,
			timestamp: startTime,
			success: exitCode === 0,
		}

		this.outputChannel.appendLine(`[AI Action Tools] Command completed in ${duration}ms with exit code ${exitCode}`)

		// Emit result for listeners
		this.emit("commandExecuted", result)

		return result
	}

	/**
	 * Start listening for specific patterns in terminal output
	 */
	public terminalListenFor(patterns: ListenPattern[]): void {
		this.outputChannel.appendLine(`[AI Action Tools] Starting to listen for ${patterns.length} patterns`)

		// Store patterns
		for (const pattern of patterns) {
			this.activePatterns.set(pattern.name, pattern)
		}

		// Convert to PTY manager format
		const ptyPatterns = patterns.map((p) => ({
			name: p.name,
			regex: p.regex,
		}))

		// Start listening on PTY manager
		this.ptyManager.startListening(ptyPatterns)
		this.isListening = true

		this.emit("listeningStarted", patterns)
	}

	/**
	 * Stop listening for patterns
	 */
	public stopListening(): void {
		this.outputChannel.appendLine("[AI Action Tools] Stopping pattern listening")
		this.ptyManager.stopListening()
		this.isListening = false
		this.activePatterns.clear()

		this.emit("listeningStopped")
	}

	/**
	 * Get recent terminal output for AI context
	 */
	public getRecentTerminalOutput(lines = 50): string[] {
		return this.ptyManager.getCleanRecentOutput(lines)
	}

	/**
	 * Search terminal history
	 */
	public searchTerminalHistory(
		query: string,
		options: { useRegex?: boolean; maxResults?: number } = {},
	): SearchResult[] {
		return this.terminalBuffer.search({
			query,
			useRegex: options.useRegex ?? false,
			maxResults: options.maxResults ?? 100,
		})
	}

	/**
	 * Get error entries from terminal
	 */
	public getTerminalErrors(limit = 50): string[] {
		const errorEntries = this.terminalBuffer.getErrorEntries(limit)
		return errorEntries.map((entry) => entry.cleanContent)
	}

	/**
	 * Get command execution history
	 */
	public getCommandHistory(): CommandExecution[] {
		return this.ptyManager.getCommandHistory()
	}

	/**
	 * Check if currently listening for patterns
	 */
	public isActive(): boolean {
		return this.isListening
	}

	/**
	 * Get active listening patterns
	 */
	public getActivePatterns(): ListenPattern[] {
		return Array.from(this.activePatterns.values())
	}

	/**
	 * Set approval requirement
	 */
	public setApprovalRequired(required: boolean): void {
		this.approvalRequired = required
		this.outputChannel.appendLine(`[AI Action Tools] Approval required: ${required}`)
	}

	/**
	 * Handle pattern matches from PTY manager
	 */
	private handlePatternMatch(match: any): void {
		const pattern = this.activePatterns.get(match.patternName)
		if (!pattern) return

		const context = this.getPatternContext(match.timestamp)
		const matchEvent: PatternMatchEvent = {
			pattern,
			matches: match.matches,
			timestamp: match.timestamp,
			context,
		}

		this.outputChannel.appendLine(
			`[AI Action Tools] Pattern matched: ${pattern.name} - ${match.matches.join(", ")}`,
		)

		// Execute pattern action
		switch (pattern.action) {
			case "trigger":
				this.emit("patternTriggered", matchEvent)
				break
			case "log":
				this.emit("patternLogged", matchEvent)
				break
			case "highlight":
				this.emit("patternHighlighted", matchEvent)
				break
			default:
				this.emit("patternMatched", matchEvent)
		}
	}

	/**
	 * Get context around a pattern match
	 */
	private getPatternContext(timestamp: number, beforeMs = 2000, afterMs = 1000): string {
		const contextEntries = this.terminalBuffer.getContextAroundTimestamp(timestamp, beforeMs, afterMs)
		return contextEntries.map((entry) => entry.cleanContent).join("\n")
	}

	/**
	 * Request user approval for command execution
	 */
	private async requestCommandApproval(command: string, workingDirectory: string): Promise<boolean> {
		const requestId = `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
		const request: CommandApprovalRequest = {
			command,
			workingDirectory,
			requestId,
			timestamp: Date.now(),
		}

		this.pendingApprovals.set(requestId, request)

		try {
			// Show approval dialog to user
			const result = await vscode.window.showQuickPick(
				[
					{ label: "$(check) Approve", description: "Execute the command", action: "approve" },
					{ label: "$(x) Deny", description: "Cancel command execution", action: "deny" },
					{ label: "$(eye) View Command", description: "Show full command details", action: "view" },
				],
				{
					title: "Kilo Code - Command Approval Required",
					placeHolder: `Execute: ${command}`,
					ignoreFocusOut: true,
				},
			)

			if (!result) {
				return false // User cancelled
			}

			switch (result.action) {
				case "approve": {
					this.outputChannel.appendLine(`[AI Action Tools] Command approved: ${command}`)
					return true
				}

				case "deny": {
					this.outputChannel.appendLine(`[AI Action Tools] Command denied: ${command}`)
					return false
				}

				case "view": {
					// Show detailed command information
					const detailResult = await vscode.window.showInformationMessage(
						`Command: ${command}\nWorking Directory: ${workingDirectory}\n\nExecute this command?`,
						{ modal: true },
						"Approve",
						"Deny",
					)
					return detailResult === "Approve"
				}

				default:
					return false
			}
		} finally {
			this.pendingApprovals.delete(requestId)
		}
	}

	/**
	 * Get pending approval requests
	 */
	public getPendingApprovals(): CommandApprovalRequest[] {
		return Array.from(this.pendingApprovals.values())
	}

	/**
	 * Cancel a pending approval request
	 */
	public cancelApproval(requestId: string): boolean {
		return this.pendingApprovals.delete(requestId)
	}

	/**
	 * Execute multiple commands in sequence
	 */
	public async executeCommandsSequentially(
		commands: string[],
		options: ShellCommandOptions = {},
	): Promise<ShellCommandResult[]> {
		const results: ShellCommandResult[] = []

		for (const command of commands) {
			try {
				const result = await this.executeShellCommand(command, options)
				results.push(result)

				// Stop on first failure unless explicitly told otherwise
				if (!result.success && options.requireApproval !== false) {
					break
				}
			} catch (error) {
				this.outputChannel.appendLine(`[AI Action Tools] Command failed: ${command} - ${error}`)
				break
			}
		}

		return results
	}

	/**
	 * Execute a command with retry logic
	 */
	public async executeCommandWithRetry(
		command: string,
		maxRetries = 3,
		options: ShellCommandOptions = {},
	): Promise<ShellCommandResult> {
		let lastResult: ShellCommandResult | null = null

		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			try {
				lastResult = await this.executeShellCommand(command, options)

				if (lastResult.success) {
					return lastResult
				}

				this.outputChannel.appendLine(
					`[AI Action Tools] Command failed (attempt ${attempt}/${maxRetries}): ${command}`,
				)

				if (attempt < maxRetries) {
					// Wait before retry
					await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
				}
			} catch (error) {
				this.outputChannel.appendLine(
					`[AI Action Tools] Command error (attempt ${attempt}/${maxRetries}): ${command} - ${error}`,
				)

				if (attempt === maxRetries) {
					throw error
				}
			}
		}

		// Return the last result if all retries failed
		if (lastResult) {
			return lastResult
		}

		throw new Error(`Command failed after ${maxRetries} attempts: ${command}`)
	}

	/**
	 * Dispose of the AI Action Tools
	 */
	public dispose(): void {
		this.stopListening()
		this.removeAllListeners()
		this.pendingApprovals.clear()
		this.activePatterns.clear()
	}
}
