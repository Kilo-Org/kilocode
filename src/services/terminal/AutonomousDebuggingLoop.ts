import { AIActionTools, ShellCommandResult } from "./AIActionTools"
import { EventEmitter } from "events"
import * as vscode from "vscode"

export interface ErrorPattern {
	name: string
	regex: RegExp
	severity: "error" | "warning" | "info"
	category: "syntax" | "runtime" | "import" | "permission" | "network" | "odoo"
	autoFixable?: boolean
}

export interface ParsedError {
	type: string
	message: string
	file?: string
	line?: number
	column?: number
	stackTrace?: string
	severity: "error" | "warning" | "info"
	category: string
	timestamp: number
	rawOutput: string
}

export interface FixSuggestion {
	type: "edit" | "command" | "dependency" | "configuration"
	description: string
	action: string
	file?: string
	line?: number
	autoApplicable: boolean
	confidence: number
}

export interface DebuggingSession {
	id: string
	startTime: number
	errors: ParsedError[]
	fixAttempts: FixAttempt[]
	status: "active" | "resolved" | "failed"
	originalCommand: string
}

export interface FixAttempt {
	timestamp: number
	fix: FixSuggestion
	result: "success" | "failed" | "partial"
	error?: string
}

/**
 * Autonomous Debugging Loop - Self-healing terminal error detection and fixing
 * Automatically detects errors, analyzes them, and proposes fixes
 */
export class AutonomousDebuggingLoop extends EventEmitter {
	private sessions: Map<string, DebuggingSession> = new Map()
	private errorPatterns: ErrorPattern[] = []
	private isActive = false
	private maxFixAttempts = 3

	constructor(
		private aiActionTools: AIActionTools,
		private outputChannel: vscode.OutputChannel,
	) {
		super()
		this.initializeErrorPatterns()
		this.setupEventHandlers()
	}

	private initializeErrorPatterns(): void {
		this.errorPatterns = [
			// Python errors
			{
				name: "python_syntax_error",
				regex: /File "([^"]+)", line (\d+)(?:, column (\d+))?\s*SyntaxError: (.+)/i,
				severity: "error",
				category: "syntax",
				autoFixable: true,
			},
			{
				name: "python_import_error",
				regex: /ModuleNotFoundError: No module named '([^']+)'/i,
				severity: "error",
				category: "import",
				autoFixable: true,
			},
			{
				name: "python_name_error",
				regex: /NameError: name '([^']+)' is not defined/i,
				severity: "error",
				category: "runtime",
				autoFixable: false,
			},
			{
				name: "python_type_error",
				regex: /TypeError: (.+)/i,
				severity: "error",
				category: "runtime",
				autoFixable: false,
			},

			// Odoo specific errors
			{
				name: "odoo_integrity_error",
				regex: /psycopg2\.errors\.IntegrityError|IntegrityError: (.+)/i,
				severity: "error",
				category: "odoo",
				autoFixable: true,
			},
			{
				name: "odoo_access_error",
				regex: /AccessError|Access Denied: (.+)/i,
				severity: "error",
				category: "permission",
				autoFixable: false,
			},
			{
				name: "odoo_user_error",
				regex: /UserError: (.+)/i,
				severity: "error",
				category: "odoo",
				autoFixable: false,
			},
			{
				name: "odoo_validation_error",
				regex: /ValidationError: (.+)/i,
				severity: "error",
				category: "odoo",
				autoFixable: true,
			},

			// Node.js errors
			{
				name: "node_module_not_found",
				regex: /Error: Cannot find module '([^']+)'/i,
				severity: "error",
				category: "import",
				autoFixable: true,
			},
			{
				name: "node_syntax_error",
				regex: /SyntaxError: (.+) at (.+):(\d+):(\d+)/i,
				severity: "error",
				category: "syntax",
				autoFixable: true,
			},

			// General errors
			{
				name: "permission_denied",
				regex: /Permission denied|EACCES|EPERM/i,
				severity: "error",
				category: "permission",
				autoFixable: true,
			},
			{
				name: "file_not_found",
				regex: /No such file or directory|ENOENT/i,
				severity: "error",
				category: "runtime",
				autoFixable: false,
			},
			{
				name: "network_error",
				regex: /ECONNREFUSED|ETIMEDOUT|Network error/i,
				severity: "error",
				category: "network",
				autoFixable: false,
			},
		]
	}

	private setupEventHandlers(): void {
		// Listen for command executions
		this.aiActionTools.on("commandExecuted", (result: ShellCommandResult) => {
			if (!result.success) {
				this.handleCommandFailure(result)
			}
		})

		// Listen for terminal output for real-time error detection
		this.aiActionTools.on("terminalOutput", (entry: any) => {
			if (entry.type === "stderr") {
				this.analyzeOutputForErrors(entry.content, entry.timestamp)
			}
		})
	}

	/**
	 * Start the autonomous debugging loop
	 */
	public start(): void {
		if (this.isActive) return

		this.isActive = true
		this.outputChannel.appendLine("[Autonomous Debugging] Debugging loop started")

		// Start listening for error patterns
		const errorPatterns = this.errorPatterns.map((pattern) => ({
			name: pattern.name,
			regex: pattern.regex,
			description: `Detect ${pattern.category} errors`,
			action: "trigger" as const,
		}))

		this.aiActionTools.terminalListenFor(errorPatterns)
		this.emit("debuggingStarted")
	}

	/**
	 * Stop the autonomous debugging loop
	 */
	public stop(): void {
		if (!this.isActive) return

		this.isActive = false
		this.aiActionTools.stopListening()
		this.outputChannel.appendLine("[Autonomous Debugging] Debugging loop stopped")
		this.emit("debuggingStopped")
	}

	/**
	 * Handle command failure
	 */
	private async handleCommandFailure(result: ShellCommandResult): Promise<void> {
		this.outputChannel.appendLine(`[Autonomous Debugging] Command failed: ${result.command}`)

		// Create debugging session
		const sessionId = this.createDebuggingSession(result.command)

		// Analyze stderr for errors
		if (result.stderr) {
			await this.analyzeOutputForErrors(result.stderr, result.timestamp)
		}

		// Get recent terminal context
		const recentOutput = this.aiActionTools.getRecentTerminalOutput(50)
		const context = recentOutput.join("\n")

		// Attempt to fix detected errors
		await this.attemptAutoFix(sessionId, context)
	}

	/**
	 * Analyze terminal output for errors
	 */
	private async analyzeOutputForErrors(output: string, timestamp: number): Promise<void> {
		const errors: ParsedError[] = []

		for (const pattern of this.errorPatterns) {
			const matches = output.match(pattern.regex)
			if (matches) {
				const error = this.parseError(matches, pattern, timestamp, output)
				if (error) {
					errors.push(error)
				}
			}
		}

		// Add errors to active session
		if (errors.length > 0) {
			const activeSession = this.getActiveSession()
			if (activeSession) {
				activeSession.errors.push(...errors)
				this.emit("errorsDetected", errors)

				// Trigger auto-fix attempt
				await this.attemptAutoFix(activeSession.id, output)
			}
		}
	}

	/**
	 * Parse error from regex match
	 */
	private parseError(
		matches: RegExpMatchArray,
		pattern: ErrorPattern,
		timestamp: number,
		rawOutput: string,
	): ParsedError | null {
		try {
			let file: string | undefined
			let line: number | undefined
			let column: number | undefined
			let message: string

			switch (pattern.name) {
				case "python_syntax_error": {
					file = matches[1]
					line = parseInt(matches[2])
					column = matches[3] ? parseInt(matches[3]) : undefined
					message = matches[4]
					break
				}

				case "python_import_error":
					message = matches[0]
					break

				case "odoo_integrity_error":
				case "odoo_access_error":
				case "odoo_user_error":
				case "odoo_validation_error":
					message = matches[1] || matches[0]
					break

				case "node_syntax_error": {
					message = matches[1]
					file = matches[2]
					line = parseInt(matches[3])
					column = parseInt(matches[4])
					break
				}

				default:
					message = matches[1] || matches[0]
					break
			}

			return {
				type: pattern.name,
				message,
				file,
				line,
				column,
				severity: pattern.severity,
				category: pattern.category,
				timestamp,
				rawOutput,
			}
		} catch (error) {
			this.outputChannel.appendLine(`[Autonomous Debugging] Error parsing pattern ${pattern.name}: ${error}`)
			return null
		}
	}

	/**
	 * Generate fix suggestions for detected errors
	 */
	public generateFixSuggestions(errors: ParsedError[]): FixSuggestion[] {
		const suggestions: FixSuggestion[] = []

		for (const error of errors) {
			const errorSuggestions = this.getFixSuggestionsForError(error)
			suggestions.push(...errorSuggestions)
		}

		// Sort by confidence and remove duplicates
		return suggestions
			.sort((a, b) => b.confidence - a.confidence)
			.filter((suggestion, index, array) => array.findIndex((s) => s.action === suggestion.action) === index)
	}

	/**
	 * Get fix suggestions for a specific error
	 */
	private getFixSuggestionsForError(error: ParsedError): FixSuggestion[] {
		const suggestions: FixSuggestion[] = []

		switch (error.type) {
			case "python_syntax_error":
				if (error.file && error.line) {
					suggestions.push({
						type: "edit",
						description: "Fix syntax error in Python file",
						action: `Fix syntax in ${error.file}:${error.line}`,
						file: error.file,
						line: error.line,
						autoApplicable: false,
						confidence: 0.8,
					})
				}
				break

			case "python_import_error":
				const moduleName = error.message.match(/'([^']+)'/)?.[1]
				if (moduleName) {
					suggestions.push({
						type: "dependency",
						description: `Install missing Python module: ${moduleName}`,
						action: `pip install ${moduleName}`,
						autoApplicable: true,
						confidence: 0.9,
					})
				}
				break

			case "odoo_integrity_error":
				suggestions.push({
					type: "command",
					description: "Check database integrity and constraints",
					action: "odoo-db-tools check-integrity",
					autoApplicable: false,
					confidence: 0.7,
				})
				break

			case "node_module_not_found":
				const nodeModuleName = error.message.match(/'([^']+)'/)?.[1]
				if (nodeModuleName) {
					suggestions.push({
						type: "dependency",
						description: `Install missing Node.js module: ${nodeModuleName}`,
						action: `npm install ${nodeModuleName}`,
						autoApplicable: true,
						confidence: 0.9,
					})
				}
				break

			case "permission_denied":
				suggestions.push({
					type: "command",
					description: "Fix file permissions",
					action: "chmod +x .",
					autoApplicable: true,
					confidence: 0.6,
				})
				break
		}

		return suggestions
	}

	/**
					action: 'odoo-db-tools check-integrity',
					autoApplicable: false,
					confidence: 0.7,
				})
				break

			case 'node_module_not_found':
				const nodeModuleName = error.message.match(/'([^']+)'/)?.[1]
				if (nodeModuleName) {
					suggestions.push({
						type: 'dependency',
						description: `Install missing Node.js module: ${nodeModuleName}`,
						action: `npm install ${nodeModuleName}`,
						autoApplicable: true,
						confidence: 0.9,
					})
				}
				break

			case 'permission_denied':
				suggestions.push({
					type: 'command',
					description: 'Fix file permissions',
					action: 'chmod +x .',
					autoApplicable: true,
					confidence: 0.6,
				})
				break
		}

		return suggestions
	}

	/**
	 * Attempt to automatically fix errors
	 */
	private async attemptAutoFix(sessionId: string, context: string): Promise<void> {
		const session = this.sessions.get(sessionId)
		if (!session || session.status !== "active") return

		// Check if we've exceeded max attempts
		if (session.fixAttempts.length >= this.maxFixAttempts) {
			session.status = "failed"
			this.emit("debuggingFailed", session)
			return
		}

		const errors = session.errors.slice(-3) // Focus on recent errors
		const suggestions = this.generateFixSuggestions(errors)

		// Try auto-applicable fixes first
		const autoFixableSuggestions = suggestions.filter((s) => s.autoApplicable)

		for (const suggestion of autoFixableSuggestions) {
			try {
				this.outputChannel.appendLine(`[Autonomous Debugging] Attempting fix: ${suggestion.description}`)

				const result = await this.applyFix(suggestion)

				const fixAttempt: FixAttempt = {
					timestamp: Date.now(),
					fix: suggestion,
					result: result.success ? "success" : "failed",
					error: result.error,
				}

				session.fixAttempts.push(fixAttempt)
				this.emit("fixAttempted", fixAttempt)

				if (result.success) {
					this.outputChannel.appendLine(`[Autonomous Debugging] Fix successful: ${suggestion.description}`)

					// Test the fix by re-running the original command
					await this.testFix(session)
					return
				}
			} catch (error) {
				this.outputChannel.appendLine(`[Autonomous Debugging] Fix failed: ${suggestion.description} - ${error}`)
			}
		}

		// If no auto-fixes worked, emit suggestions for manual review
		if (suggestions.length > 0) {
			this.emit("fixSuggestionsGenerated", {
				sessionId,
				suggestions: suggestions.filter((s) => !s.autoApplicable),
			})
		}
	}

	/**
	 * Apply a fix suggestion
	 */
	private async applyFix(suggestion: FixSuggestion): Promise<{ success: boolean; error?: string }> {
		try {
			switch (suggestion.type) {
				case "command": {
					const result = await this.aiActionTools.executeShellCommand(suggestion.action, {
						requireApproval: false, // Auto-approved fixes
						timeout: 30000,
					})
					return { success: result.success }
				}

				case "dependency": {
					// For dependency fixes, execute the install command
					const depResult = await this.aiActionTools.executeShellCommand(suggestion.action, {
						requireApproval: false,
						timeout: 60000, // Longer timeout for installs
					})
					return { success: depResult.success }
				}

				case "edit":
					// For file edits, we need to integrate with the code editor
					// This would require additional integration with VS Code editor API
					this.outputChannel.appendLine(`[Autonomous Debugging] Edit fix requested: ${suggestion.action}`)
					return { success: false, error: "Edit fixes require manual intervention" }

				default:
					return { success: false, error: `Unknown fix type: ${suggestion.type}` }
			}
		} catch (error) {
			return { success: false, error: String(error) }
		}
	}

	/**
	 * Test a fix by re-running the original command
	 */
	private async testFix(session: DebuggingSession): Promise<void> {
		try {
			this.outputChannel.appendLine(`[Autonomous Debugging] Testing fix with command: ${session.originalCommand}`)

			const result = await this.aiActionTools.executeShellCommand(session.originalCommand, {
				requireApproval: false,
				timeout: 30000,
			})

			if (result.success) {
				session.status = "resolved"
				this.outputChannel.appendLine("[Autonomous Debugging] Fix verified - command succeeded")
				this.emit("debuggingResolved", session)
			} else {
				this.outputChannel.appendLine("[Autonomous Debugging] Fix test failed - command still fails")
				// Continue with more fix attempts
				await this.attemptAutoFix(session.id, "")
			}
		} catch (error) {
			this.outputChannel.appendLine(`[Autonomous Debugging] Fix test error: ${error}`)
		}
	}

	/**
	 * Create a new debugging session
	 */
	private createDebuggingSession(command: string): string {
		const sessionId = `debug_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

		const session: DebuggingSession = {
			id: sessionId,
			startTime: Date.now(),
			errors: [],
			fixAttempts: [],
			status: "active",
			originalCommand: command,
		}

		this.sessions.set(sessionId, session)
		this.emit("sessionCreated", session)

		return sessionId
	}

	/**
	 * Get the active debugging session
	 */
	private getActiveSession(): DebuggingSession | null {
		for (const session of this.sessions.values()) {
			if (session.status === "active") {
				return session
			}
		}
		return null
	}

	/**
	 * Get all debugging sessions
	 */
	public getSessions(): DebuggingSession[] {
		return Array.from(this.sessions.values())
	}

	/**
	 * Get a specific debugging session
	 */
	public getSession(sessionId: string): DebuggingSession | null {
		return this.sessions.get(sessionId) || null
	}

	/**
	 * Clear old debugging sessions
	 */
	public clearOldSessions(maxAge = 3600000): number {
		// 1 hour default
		const cutoff = Date.now() - maxAge
		let cleared = 0

		for (const [id, session] of this.sessions) {
			if (session.startTime < cutoff) {
				this.sessions.delete(id)
				cleared++
			}
		}

		return cleared
	}

	/**
	 * Set maximum fix attempts per session
	 */
	public setMaxFixAttempts(maxAttempts: number): void {
		this.maxFixAttempts = maxAttempts
	}

	/**
	 * Check if debugging is active
	 */
	public isDebuggingActive(): boolean {
		return this.isActive
	}

	/**
	 * Dispose of the debugging loop
	 */
	public dispose(): void {
		this.stop()
		this.removeAllListeners()
		this.sessions.clear()
	}
}
