import { AIActionTools } from "./AIActionTools"
import { EventEmitter } from "events"
import * as vscode from "vscode"

export interface OdooCommandPreset {
	name: string
	description: string
	command: string
	category: "server" | "database" | "modules" | "testing" | "development"
	requiresConfirmation?: boolean
	timeout?: number
	parameters?: OdooCommandParameter[]
}

export interface OdooCommandParameter {
	name: string
	description: string
	type: "string" | "number" | "boolean" | "choice"
	required: boolean
	default?: any
	choices?: string[]
}

export interface OdooLogPattern {
	name: string
	regex: RegExp
	severity: "error" | "warning" | "info"
	category: "database" | "module" | "security" | "performance" | "api"
	description: string
	suggestion?: string
}

export interface OdooModelError {
	type: string
	model?: string
	field?: string
	message: string
	severity: "error" | "warning" | "info"
	category: string
	timestamp: number
	stackTrace?: string
}

/**
 * Odoo Integration Patterns - Specialized terminal integration for Odoo development
 * Provides command presets, log parsing, and error detection specific to Odoo ERP
 */
export class OdooIntegrationPatterns extends EventEmitter {
	private commandPresets: Map<string, OdooCommandPreset> = new Map()
	private logPatterns: OdooLogPattern[] = []
	private detectedModels: Set<string> = new Set()
	private isActive = false

	constructor(
		private aiActionTools: AIActionTools,
		private outputChannel: vscode.OutputChannel,
	) {
		super()
		this.initializeCommandPresets()
		this.initializeLogPatterns()
		this.setupEventHandlers()
	}

	private initializeCommandPresets(): void {
		const presets: OdooCommandPreset[] = [
			// Server commands
			{
				name: "start_odoo",
				description: "Start Odoo server",
				command: "odoo-bin -c odoo.conf",
				category: "server",
				requiresConfirmation: true,
				timeout: 30000,
				parameters: [
					{
						name: "config_file",
						description: "Configuration file path",
						type: "string",
						required: false,
						default: "odoo.conf",
					},
					{
						name: "database",
						description: "Database name",
						type: "string",
						required: false,
					},
					{
						name: "port",
						description: "Server port",
						type: "number",
						required: false,
						default: 8069,
					},
				],
			},
			{
				name: "stop_odoo",
				description: "Stop Odoo server",
				command: 'pkill -f "odoo-bin"',
				category: "server",
				requiresConfirmation: true,
				timeout: 10000,
			},

			// Database commands
			{
				name: "create_database",
				description: "Create new Odoo database",
				command: "odoo-bin -c odoo.conf --database={database} --init-base",
				category: "database",
				requiresConfirmation: true,
				timeout: 60000,
				parameters: [
					{
						name: "database",
						description: "Database name",
						type: "string",
						required: true,
					},
				],
			},
			{
				name: "drop_database",
				description: "Drop Odoo database",
				command: "dropdb {database}",
				category: "database",
				requiresConfirmation: true,
				timeout: 30000,
				parameters: [
					{
						name: "database",
						description: "Database name",
						type: "string",
						required: true,
					},
				],
			},

			// Module commands
			{
				name: "update_module",
				description: "Update specific Odoo module",
				command: "odoo-bin -c odoo.conf --database={database} --update={module}",
				category: "modules",
				requiresConfirmation: false,
				timeout: 120000,
				parameters: [
					{
						name: "database",
						description: "Database name",
						type: "string",
						required: true,
					},
					{
						name: "module",
						description: "Module name",
						type: "string",
						required: true,
					},
				],
			},
			{
				name: "install_module",
				description: "Install new Odoo module",
				command: "odoo-bin -c odoo.conf --database={database} --init={module}",
				category: "modules",
				requiresConfirmation: false,
				timeout: 120000,
				parameters: [
					{
						name: "database",
						description: "Database name",
						type: "string",
						required: true,
					},
					{
						name: "module",
						description: "Module name",
						type: "string",
						required: true,
					},
				],
			},
			{
				name: "uninstall_module",
				description: "Uninstall Odoo module",
				command: "odoo-bin -c odoo.conf --database={database} --uninstall={module}",
				category: "modules",
				requiresConfirmation: true,
				timeout: 60000,
				parameters: [
					{
						name: "database",
						description: "Database name",
						type: "string",
						required: true,
					},
					{
						name: "module",
						description: "Module name",
						type: "string",
						required: true,
					},
				],
			},

			// Testing commands
			{
				name: "run_tests",
				description: "Run Odoo tests",
				command: "odoo-bin -c odoo.conf --database={database} --test-enable --stop-after-init",
				category: "testing",
				requiresConfirmation: false,
				timeout: 300000,
				parameters: [
					{
						name: "database",
						description: "Database name",
						type: "string",
						required: true,
					},
					{
						name: "module",
						description: "Specific module to test",
						type: "string",
						required: false,
					},
				],
			},
			{
				name: "run_single_test",
				description: "Run single test class",
				command: "odoo-bin -c odoo.conf --database={database} --test-enable --test-tags={test_class}",
				category: "testing",
				requiresConfirmation: false,
				timeout: 120000,
				parameters: [
					{
						name: "database",
						description: "Database name",
						type: "string",
						required: true,
					},
					{
						name: "test_class",
						description: "Test class name",
						type: "string",
						required: true,
					},
				],
			},

			// Development commands
			{
				name: "shell",
				description: "Open Odoo shell",
				command: "odoo-bin shell -c odoo.conf --database={database}",
				category: "development",
				requiresConfirmation: false,
				timeout: 10000,
				parameters: [
					{
						name: "database",
						description: "Database name",
						type: "string",
						required: true,
					},
				],
			},
			{
				name: "generate_translation",
				description: "Generate translation files",
				command: "odoo-bin -c odoo.conf --database={database} --i18n-export={lang} --modules={modules}",
				category: "development",
				requiresConfirmation: false,
				timeout: 60000,
				parameters: [
					{
						name: "database",
						description: "Database name",
						type: "string",
						required: true,
					},
					{
						name: "lang",
						description: "Language code",
						type: "string",
						required: true,
					},
					{
						name: "modules",
						description: "Comma-separated module list",
						type: "string",
						required: true,
					},
				],
			},
		]

		for (const preset of presets) {
			this.commandPresets.set(preset.name, preset)
		}
	}

	private initializeLogPatterns(): void {
		this.logPatterns = [
			// Database errors
			{
				name: "odoo_db_error",
				regex: /psycopg2\.errors\.(\w+): (.+)/i,
				severity: "error",
				category: "database",
				description: "PostgreSQL database error",
				suggestion: "Check database connection and permissions",
			},
			{
				name: "odoo_integrity_error",
				regex: /IntegrityError: (.+)/i,
				severity: "error",
				category: "database",
				description: "Database integrity constraint violation",
				suggestion: "Check data constraints and foreign keys",
			},

			// Module errors
			{
				name: "odoo_import_error",
				regex: /ImportError: No module named '([^']+)'/i,
				severity: "error",
				category: "module",
				description: "Python module import error",
				suggestion: "Install missing Python dependencies",
			},
			{
				name: "odoo_module_not_found",
				regex: /ModuleNotFoundError: Module '([^']+)' not found/i,
				severity: "error",
				category: "module",
				description: "Odoo module not found",
				suggestion: "Check module path and dependencies",
			},

			// Security errors
			{
				name: "odoo_access_denied",
				regex: /AccessError: (.+)/i,
				severity: "error",
				category: "security",
				description: "Access rights violation",
				suggestion: "Check user permissions and access rules",
			},
			{
				name: "odoo_user_error",
				regex: /UserError: (.+)/i,
				severity: "warning",
				category: "security",
				description: "User-triggered error",
				suggestion: "Review user action and data validation",
			},

			// Performance warnings
			{
				name: "odoo_slow_query",
				regex: /slow query: (\d+\.\d+)s (.+)/i,
				severity: "warning",
				category: "performance",
				description: "Slow database query detected",
				suggestion: "Consider optimizing the query or adding indexes",
			},
			{
				name: "odoo_memory_warning",
				regex: /Memory usage: (\d+)MB/i,
				severity: "warning",
				category: "performance",
				description: "High memory usage",
				suggestion: "Monitor memory usage and optimize if needed",
			},

			// API errors
			{
				name: "odoo_api_error",
				regex: /JSON-RPC error: (.+)/i,
				severity: "error",
				category: "api",
				description: "API call failed",
				suggestion: "Check API parameters and authentication",
			},
			{
				name: "odoo_validation_error",
				regex: /ValidationError: (.+)/i,
				severity: "error",
				category: "api",
				description: "Data validation failed",
				suggestion: "Check required fields and data format",
			},
		]
	}

	private setupEventHandlers(): void {
		// Listen for terminal output to detect Odoo-specific patterns
		this.aiActionTools.on("terminalOutput", (entry: any) => {
			if (entry.type === "stderr") {
				this.analyzeOdooOutput(entry.content, entry.timestamp)
			}
		})
	}

	/**
	 * Start Odoo integration monitoring
	 */
	public start(): void {
		if (this.isActive) return

		this.isActive = true
		this.outputChannel.appendLine("[Odoo Integration] Started monitoring Odoo patterns")

		// Start listening for Odoo log patterns
		const odooPatterns = this.logPatterns.map((pattern) => ({
			name: pattern.name,
			regex: pattern.regex,
			description: pattern.description,
			action: "trigger" as const,
		}))

		this.aiActionTools.terminalListenFor(odooPatterns)
		this.emit("odooIntegrationStarted")
	}

	/**
	 * Stop Odoo integration monitoring
	 */
	public stop(): void {
		if (!this.isActive) return

		this.isActive = false
		this.outputChannel.appendLine("[Odoo Integration] Stopped monitoring Odoo patterns")
		this.emit("odooIntegrationStopped")
	}

	/**
	 * Execute an Odoo command preset
	 */
	public async executeOdooCommand(presetName: string, parameters: Record<string, any> = {}): Promise<any> {
		const preset = this.commandPresets.get(presetName)
		if (!preset) {
			throw new Error(`Unknown Odoo command preset: ${presetName}`)
		}

		// Validate required parameters
		for (const param of preset.parameters || []) {
			if (param.required && !parameters[param.name]) {
				throw new Error(`Required parameter missing: ${param.name}`)
			}
		}

		// Build command with parameters
		let command = preset.command
		for (const [key, value] of Object.entries(parameters)) {
			command = command.replace(new RegExp(`{${key}}`, "g"), String(value))
		}

		this.outputChannel.appendLine(`[Odoo Integration] Executing: ${preset.name} - ${command}`)

		try {
			const result = await this.aiActionTools.executeShellCommand(command, {
				timeout: preset.timeout || 60000,
				requireApproval: preset.requiresConfirmation ?? false,
			})

			this.emit("odooCommandExecuted", {
				preset: preset.name,
				command,
				result,
			})

			return result
		} catch (error) {
			this.outputChannel.appendLine(`[Odoo Integration] Command failed: ${preset.name} - ${error}`)
			throw error
		}
	}

	/**
	 * Get available command presets
	 */
	public getCommandPresets(category?: string): OdooCommandPreset[] {
		const presets = Array.from(this.commandPresets.values())
		return category ? presets.filter((p) => p.category === category) : presets
	}

	/**
	 * Get command preset by name
	 */
	public getCommandPreset(name: string): OdooCommandPreset | undefined {
		return this.commandPresets.get(name)
	}

	/**
	 * Analyze terminal output for Odoo-specific patterns
	 */
	private analyzeOdooOutput(output: string, timestamp: number): void {
		for (const pattern of this.logPatterns) {
			const matches = output.match(pattern.regex)
			if (matches) {
				const error = this.parseOdooError(matches, pattern, timestamp, output)
				if (error) {
					this.emit("odooErrorDetected", error)
					this.outputChannel.appendLine(
						`[Odoo Integration] ${pattern.severity}: ${pattern.description} - ${error.message}`,
					)

					// Detect model names from errors
					this.detectModelNames(error)
				}
			}
		}
	}

	/**
	 * Parse Odoo error from regex match
	 */
	private parseOdooError(
		matches: RegExpMatchArray,
		pattern: OdooLogPattern,
		timestamp: number,
		rawOutput: string,
	): OdooModelError | null {
		try {
			let message: string
			let model: string | undefined

			switch (pattern.name) {
				case "odoo_db_error": {
					message = `${matches[1]}: ${matches[2]}`
					break
				}
				case "odoo_integrity_error": {
					message = matches[1]
					const modelMatch = matches[1].match(/"([^"]+)"/)
					model = modelMatch ? modelMatch[1] : undefined
					break
				}
				case "odoo_access_denied": {
					message = matches[1]
					break
				}
				default: {
					message = matches[1] || matches[0]
					break
				}
			}

			return {
				type: pattern.name,
				model,
				message,
				severity: pattern.severity,
				category: pattern.category,
				timestamp,
				stackTrace: rawOutput,
			}
		} catch (error) {
			this.outputChannel.appendLine(`[Odoo Integration] Error parsing pattern ${pattern.name}: ${error}`)
			return null
		}
	}

	/**
	 * Detect Odoo model names from errors and output
	 */
	private detectModelNames(error: OdooModelError): void {
		// Extract model names from error messages
		const modelPatterns = [/model '([^']+)'/gi, /"([^"]+)" model/gi, /Object '([^']+)'/gi]

		for (const pattern of modelPatterns) {
			const matches = error.message.matchAll(pattern)
			for (const match of matches) {
				const modelName = match[1]
				if (modelName && /^[a-z_][a-z0-9_]*$/i.test(modelName)) {
					this.detectedModels.add(modelName)
				}
			}
		}
	}

	/**
	 * Get detected Odoo models
	 */
	public getDetectedModels(): string[] {
		return Array.from(this.detectedModels)
	}

	/**
	 * Get Odoo log patterns
	 */
	public getLogPatterns(category?: string): OdooLogPattern[] {
		return category ? this.logPatterns.filter((p) => p.category === category) : [...this.logPatterns]
	}

	/**
	 * Search Odoo-specific errors in terminal history
	 */
	public searchOdooErrors(query: string, options: { category?: string; severity?: string } = {}): OdooModelError[] {
		// This would integrate with the terminal buffer to search for Odoo errors
		// For now, return empty array as placeholder
		return []
	}

	/**
	 * Generate Odoo-specific fix suggestions
	 */
	public generateOdooFixSuggestions(error: OdooModelError): string[] {
		const suggestions: string[] = []

		switch (error.type) {
			case "odoo_db_error":
				suggestions.push("Check PostgreSQL server status")
				suggestions.push("Verify database connection parameters")
				suggestions.push("Ensure database user has required permissions")
				break

			case "odoo_integrity_error":
				if (error.model) {
					suggestions.push(`Check ${error.model} model constraints`)
					suggestions.push("Verify foreign key relationships")
					suggestions.push("Review data integrity in related records")
				}
				break

			case "odoo_import_error":
				suggestions.push("Install missing Python dependencies with pip")
				suggestions.push("Check Odoo addons path configuration")
				suggestions.push("Verify module dependencies in __manifest__.py")
				break

			case "odoo_access_denied":
				suggestions.push("Review user access rights and groups")
				suggestions.push("Check record rules and security constraints")
				suggestions.push("Verify user has required permissions")
				break

			case "odoo_slow_query":
				suggestions.push("Add database indexes for frequently queried fields")
				suggestions.push("Optimize query with proper domain filters")
				suggestions.push("Consider using read_group instead of search for aggregations")
				break

			case "odoo_validation_error":
				suggestions.push("Check required fields and data format")
				suggestions.push("Review model constraints and validation methods")
				suggestions.push("Ensure data meets field requirements")
				break
		}

		return suggestions
	}

	/**
	 * Check if Odoo integration is active
	 */
	public isOdooIntegrationActive(): boolean {
		return this.isActive
	}

	/**
	 * Dispose of Odoo integration
	 */
	public dispose(): void {
		this.stop()
		this.removeAllListeners()
		this.detectedModels.clear()
	}
}
