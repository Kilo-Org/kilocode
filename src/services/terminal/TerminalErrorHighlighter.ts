import { AntiGravityTerminalService } from "./AntiGravityTerminalService"
import { EventEmitter } from "events"
import * as vscode from "vscode"

export interface ErrorHighlight {
	id: string
	line: number
	content: string
	type: "error" | "warning" | "info"
	timestamp: number
	fixAvailable: boolean
	fixAction?: string
}

export interface FixAction {
	id: string
	description: string
	action: string
	type: "command" | "edit" | "dependency"
	autoApplicable: boolean
	confidence: number
}

/**
 * Terminal Error Highlighter - Adds error highlighting and fix suggestions to terminal output
 * Integrates with xterm.js to highlight errors and provide "Fix with Kilo Code" functionality
 */
export class TerminalErrorHighlighter extends EventEmitter {
	private highlights: Map<string, ErrorHighlight> = new Map()
	private errorPatterns: RegExp[] = []
	private fixActions: Map<string, FixAction[]> = new Map()
	private isEnabled = true

	constructor(
		private terminalService: AntiGravityTerminalService,
		private outputChannel: vscode.OutputChannel,
	) {
		super()
		this.initializeErrorPatterns()
		this.setupEventHandlers()
	}

	private initializeErrorPatterns(): void {
		this.errorPatterns = [
			// Python errors
			/Traceback \(most recent call last\):[\s\S]*?(\w+Error): (.+)/gi,
			/File "([^"]+)", line (\d+)(?:, column (\d+))?\s*SyntaxError: (.+)/gi,
			/ModuleNotFoundError: No module named '([^']+)'/gi,
			/NameError: name '([^']+)' is not defined/gi,
			/TypeError: (.+)/gi,

			// Odoo errors
			/psycopg2\.errors\.(\w+): (.+)/gi,
			/IntegrityError: (.+)/gi,
			/AccessError: (.+)/gi,
			/UserError: (.+)/gi,
			/ValidationError: (.+)/gi,

			// Node.js errors
			/Error: Cannot find module '([^']+)'/gi,
			/SyntaxError: (.+) at (.+):(\d+):(\d+)/gi,
			/ReferenceError: (.+) is not defined/gi,

			// General errors
			/Permission denied|EACCES|EPERM/gi,
			/No such file or directory|ENOENT/gi,
			/ECONNREFUSED|ETIMEDOUT|Network error/gi,
			/fatal error|critical error/gi,
		]
	}

	private setupEventHandlers(): void {
		// Listen for terminal output
		this.terminalService.on("terminalOutput", ({ entry }) => {
			if (this.isEnabled && entry.type === "stderr") {
				this.highlightErrorsInOutput(entry.content, entry.timestamp)
			}
		})

		// Listen for debugging events
		this.terminalService.on("errorsDetected", ({ errors }) => {
			for (const error of errors) {
				this.createHighlight(error.message, error.timestamp, error.severity)
				this.generateFixActions(error.message, error.type)
			}
		})

		// Listen for Odoo errors
		this.terminalService.on("odooErrorDetected", (error) => {
			this.createHighlight(error.message, error.timestamp, error.severity)
			this.generateFixActions(error.message, error.type)
		})
	}

	/**
	 * Highlight errors in terminal output
	 */
	private highlightErrorsInOutput(content: string, timestamp: number): void {
		const lines = content.split("\n")

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]

			for (const pattern of this.errorPatterns) {
				const matches = line.match(pattern)
				if (matches) {
					const severity = this.determineSeverity(line)
					this.createHighlight(line, timestamp, severity)
					this.generateFixActions(line, pattern.source)
					break
				}
			}
		}
	}

	/**
	 * Create an error highlight
	 */
	private createHighlight(content: string, timestamp: number, severity: "error" | "warning" | "info"): void {
		const highlightId = `highlight_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

		const highlight: ErrorHighlight = {
			id: highlightId,
			line: 0, // Would need to track actual line numbers
			content,
			type: severity,
			timestamp,
			fixAvailable: this.hasFixAvailable(content),
		}

		this.highlights.set(highlightId, highlight)
		this.emit("errorHighlighted", highlight)

		this.outputChannel.appendLine(
			`[Error Highlighter] ${severity.toUpperCase()}: ${content.substring(0, 100)}${content.length > 100 ? "..." : ""}`,
		)
	}

	/**
	 * Generate fix actions for an error
	 */
	private generateFixActions(errorContent: string, errorType: string): void {
		const actions: FixAction[] = []

		// Python-specific fixes
		if (errorContent.includes("ModuleNotFoundError")) {
			const moduleName = errorContent.match(/'([^']+)'/)?.[1]
			if (moduleName) {
				actions.push({
					id: `install_python_module_${Date.now()}`,
					description: `Install Python module: ${moduleName}`,
					action: `pip install ${moduleName}`,
					type: "dependency",
					autoApplicable: true,
					confidence: 0.9,
				})
			}
		}

		if (errorContent.includes("SyntaxError")) {
			actions.push({
				id: `fix_syntax_${Date.now()}`,
				description: "Fix Python syntax error",
				action: "analyze_syntax_error",
				type: "edit",
				autoApplicable: false,
				confidence: 0.7,
			})
		}

		// Odoo-specific fixes
		if (errorContent.includes("IntegrityError")) {
			actions.push({
				id: `check_integrity_${Date.now()}`,
				description: "Check database integrity",
				action: "odoo-db-tools check-integrity",
				type: "command",
				autoApplicable: false,
				confidence: 0.6,
			})
		}

		if (errorContent.includes("AccessError")) {
			actions.push({
				id: `check_permissions_${Date.now()}`,
				description: "Check user permissions",
				action: "analyze_access_rights",
				type: "edit",
				autoApplicable: false,
				confidence: 0.5,
			})
		}

		// Node.js fixes
		if (errorContent.includes("Cannot find module")) {
			const moduleName = errorContent.match(/'([^']+)'/)?.[1]
			if (moduleName) {
				actions.push({
					id: `install_node_module_${Date.now()}`,
					description: `Install Node.js module: ${moduleName}`,
					action: `npm install ${moduleName}`,
					type: "dependency",
					autoApplicable: true,
					confidence: 0.9,
				})
			}
		}

		// General fixes
		if (errorContent.includes("Permission denied")) {
			actions.push({
				id: `fix_permissions_${Date.now()}`,
				description: "Fix file permissions",
				action: "chmod +x .",
				type: "command",
				autoApplicable: true,
				confidence: 0.6,
			})
		}

		if (errorContent.includes("No such file or directory")) {
			actions.push({
				id: `create_missing_file_${Date.now()}`,
				description: "Create missing file or directory",
				action: "analyze_missing_path",
				type: "edit",
				autoApplicable: false,
				confidence: 0.4,
			})
		}

		// Store actions for this error
		const errorKey = this.generateErrorKey(errorContent)
		this.fixActions.set(errorKey, actions)

		this.emit("fixActionsGenerated", { errorContent, actions })
	}

	/**
	 * Determine error severity from content
	 */
	private determineSeverity(content: string): "error" | "warning" | "info" {
		if (content.includes("Error") || content.includes("Traceback") || content.includes("fatal")) {
			return "error"
		}
		if (content.includes("Warning") || content.includes("deprecated")) {
			return "warning"
		}
		return "info"
	}

	/**
	 * Check if fix is available for error
	 */
	private hasFixAvailable(content: string): boolean {
		const errorKey = this.generateErrorKey(content)
		const actions = this.fixActions.get(errorKey)
		return actions ? actions.length > 0 : false
	}

	/**
	 * Generate consistent key for error
	 */
	private generateErrorKey(content: string): string {
		// Create a hash-like key from the error content
		// Remove timestamps and line numbers for consistency
		const normalized = content
			.replace(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/g, "") // Remove timestamps
			.replace(/line \d+/gi, "line X") // Normalize line numbers
			.replace(/\s+/g, " ") // Normalize whitespace
			.trim()
			.substring(0, 100) // Limit length

		return normalized.toLowerCase().replace(/[^a-z0-9]/g, "_")
	}

	/**
	 * Get all highlights
	 */
	public getHighlights(): ErrorHighlight[] {
		return Array.from(this.highlights.values()).sort((a, b) => b.timestamp - a.timestamp) // Most recent first
	}

	/**
	 * Get highlights by type
	 */
	public getHighlightsByType(type: "error" | "warning" | "info"): ErrorHighlight[] {
		return this.getHighlights().filter((h) => h.type === type)
	}

	/**
	 * Get fix actions for an error
	 */
	public getFixActions(errorContent: string): FixAction[] {
		const errorKey = this.generateErrorKey(errorContent)
		return this.fixActions.get(errorKey) || []
	}

	/**
	 * Apply a fix action
	 */
	public async applyFixAction(fixId: string, sessionId?: string): Promise<{ success: boolean; error?: string }> {
		// Find the fix action
		let targetFix: FixAction | null = null
		for (const actions of this.fixActions.values()) {
			const fix = actions.find((f) => f.id === fixId)
			if (fix) {
				targetFix = fix
				break
			}
		}

		if (!targetFix) {
			return { success: false, error: "Fix action not found" }
		}

		this.outputChannel.appendLine(`[Error Highlighter] Applying fix: ${targetFix.description}`)

		try {
			switch (targetFix.type) {
				case "command": {
					const result = await this.terminalService.executeCommand(targetFix.action, {
						sessionId,
						requireApproval: true,
					})
					return { success: result.success }
				}

				case "dependency": {
					const result = await this.terminalService.executeCommand(targetFix.action, {
						sessionId,
						requireApproval: false, // Auto-approve dependency installs
						timeout: 60000,
					})
					return { success: result.success }
				}

				case "edit": {
					// For edit fixes, we need to integrate with VS Code editor
					// This would require additional integration with the code editor
					this.outputChannel.appendLine(`[Error Highlighter] Edit fix requested: ${targetFix.action}`)

					// Show a message to the user about manual intervention
					await vscode.window.showInformationMessage(
						`This fix requires manual intervention: ${targetFix.description}`,
						{ modal: true },
						"OK",
					)

					return { success: false, error: "Edit fixes require manual intervention" }
				}

				default:
					return { success: false, error: `Unknown fix type: ${targetFix.type}` }
			}
		} catch (error) {
			return { success: false, error: String(error) }
		}
	}

	/**
	 * Show "Fix with Kilo Code" quick actions
	 */
	public async showFixActions(errorContent: string, sessionId?: string): Promise<void> {
		const actions = this.getFixActions(errorContent)
		if (actions.length === 0) {
			await vscode.window.showInformationMessage("No automatic fixes available for this error")
			return
		}

		const quickPickItems = actions.map((action) => ({
			label: `🔧 ${action.description}`,
			description: `Confidence: ${Math.round(action.confidence * 100)}% | ${action.type}`,
			action,
		}))

		const selected = await vscode.window.showQuickPick(quickPickItems, {
			title: "Fix with Kilo Code",
			placeHolder: "Select a fix to apply",
			ignoreFocusOut: true,
		})

		if (selected) {
			const result = await this.applyFixAction(selected.action.id, sessionId)

			if (result.success) {
				await vscode.window.showInformationMessage(`Fix applied successfully: ${selected.action.description}`)
			} else {
				await vscode.window.showErrorMessage(`Fix failed: ${result.error || "Unknown error"}`)
			}
		}
	}

	/**
	 * Clear old highlights
	 */
	public clearOldHighlights(maxAge = 3600000): number {
		// 1 hour default
		const cutoff = Date.now() - maxAge
		let cleared = 0

		for (const [id, highlight] of this.highlights) {
			if (highlight.timestamp < cutoff) {
				this.highlights.delete(id)
				cleared++
			}
		}

		return cleared
	}

	/**
	 * Clear all highlights
	 */
	public clearAllHighlights(): void {
		this.highlights.clear()
		this.fixActions.clear()
		this.emit("highlightsCleared")
	}

	/**
	 * Enable or disable error highlighting
	 */
	public setEnabled(enabled: boolean): void {
		this.isEnabled = enabled
		this.emit("enabledChanged", enabled)
		this.outputChannel.appendLine(`[Error Highlighter] ${enabled ? "Enabled" : "Disabled"}`)
	}

	/**
	 * Check if error highlighting is enabled
	 */
	public isHighlightingEnabled(): boolean {
		return this.isEnabled
	}

	/**
	 * Get highlighting statistics
	 */
	public getStats(): {
		totalHighlights: number
		errorCount: number
		warningCount: number
		infoCount: number
		fixAvailableCount: number
		totalFixActions: number
	} {
		const highlights = this.getHighlights()
		const errorCount = highlights.filter((h) => h.type === "error").length
		const warningCount = highlights.filter((h) => h.type === "warning").length
		const infoCount = highlights.filter((h) => h.type === "info").length
		const fixAvailableCount = highlights.filter((h) => h.fixAvailable).length
		const totalFixActions = Array.from(this.fixActions.values()).reduce(
			(total, actions) => total + actions.length,
			0,
		)

		return {
			totalHighlights: highlights.length,
			errorCount,
			warningCount,
			infoCount,
			fixAvailableCount,
			totalFixActions,
		}
	}

	/**
	 * Dispose of the error highlighter
	 */
	public dispose(): void {
		this.clearAllHighlights()
		this.removeAllListeners()
	}
}
