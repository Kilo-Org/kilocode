// kilocode_change - new file

import { BaseAgent } from "./base-agent.js"
import type { AgentTask, AgentMessage, ValidationResult } from "./types.js"

export interface VerifierConfig {
	workspaceRoot: string
	testCommands?: {
		odoo?: string[]
		django?: string[]
		generic?: string[]
	}
	lintCommands?: {
		python?: string[]
		javascript?: string[]
		typescript?: string[]
	}
}

export class VerifierAgent extends BaseAgent {
	private _workspaceRoot: string
	private _testCommands: VerifierConfig["testCommands"]
	private _lintCommands: VerifierConfig["lintCommands"]

	constructor(config: VerifierConfig) {
		super({
			id: "verifier-001",
			name: "Kilo Code Verifier",
			type: "verifier",
			capabilities: [
				{
					name: "run_tests",
					description: "Run project tests",
					inputTypes: ["test_request"],
					outputTypes: ["test_result"],
				},
				{
					name: "validate_changes",
					description: "Validate code changes",
					inputTypes: ["validation_request"],
					outputTypes: ["validation_result"],
				},
				{
					name: "run_linter",
					description: "Run linting and code quality checks",
					inputTypes: ["lint_request"],
					outputTypes: ["lint_result"],
				},
				{
					name: "check_dependencies",
					description: "Check for dependency issues",
					inputTypes: ["dependency_check_request"],
					outputTypes: ["dependency_result"],
				},
			],
			enabled: true,
			priority: 3,
			maxConcurrentTasks: 2,
			timeout: 120000,
		})

		this._workspaceRoot = config.workspaceRoot
		this._testCommands = config.testCommands || {
			odoo: ["python -m pytest", "python -m unittest"],
			django: ["python manage.py test", "python -m pytest"],
			generic: ["npm test", "python -m pytest", "go test"],
		}
		this._lintCommands = config.lintCommands || {
			python: ["flake8", "pylint", "black --check"],
			javascript: ["eslint", "prettier --check"],
			typescript: ["eslint", "prettier --check", "tsc --noEmit"],
		}
	}

	protected async setupMessageHandlers(): Promise<void> {
		this._messageHandlers.set("verify", async (message: AgentMessage) => {
			await this.handleVerificationRequest(message)
		})

		this._messageHandlers.set("test", async (message: AgentMessage) => {
			await this.handleTestRequest(message)
		})
	}

	protected async processTask(task: AgentTask): Promise<any> {
		switch (task.type) {
			case "run_tests":
				return await this.runTests(task.input)
			case "validate_changes":
				return await this.validateChanges(task.input)
			case "run_linter":
				return await this.runLinter(task.input)
			case "check_dependencies":
				return await this.checkDependencies(task.input)
			default:
				throw new Error(`Unknown task type: ${task.type}`)
		}
	}

	private async runTests(input: { projectType?: "odoo" | "django" | "generic"; files?: string[] }): Promise<{
		success: boolean
		output: string
		error?: string
		testResults: Array<{
			file: string
			passed: boolean
			output: string
		}>
	}> {
		console.log("[Verifier] Running tests for project type:", input.projectType || "generic")

		const projectType = input.projectType || "generic"
		const commands = this._testCommands[projectType] || this._testCommands.generic || []

		const testResults = []
		let overallSuccess = true
		let combinedOutput = ""

		for (const command of commands) {
			try {
				console.log(`[Verifier] Running test command: ${command}`)

				const result = await this.executeCommand(command, this._workspaceRoot)

				const testResult = {
					file: command,
					passed: result.exitCode === 0,
					output: result.output,
				}

				testResults.push(testResult)
				combinedOutput += `Command: ${command}\nExit Code: ${result.exitCode}\nOutput:\n${result.output}\n\n`

				if (result.exitCode !== 0) {
					overallSuccess = false
				}
			} catch (error) {
				const errorMsg = `Failed to run test command "${command}": ${error instanceof Error ? error.message : String(error)}`
				console.error("[Verifier]", errorMsg)

				testResults.push({
					file: command,
					passed: false,
					output: errorMsg,
				})

				combinedOutput += `Error: ${errorMsg}\n\n`
				overallSuccess = false
			}
		}

		console.log(`[Verifier] Test execution completed. Overall success: ${overallSuccess}`)
		return {
			success: overallSuccess,
			output: combinedOutput,
			testResults,
		}
	}

	private async validateChanges(input: { files: string[]; changes?: any[] }): Promise<ValidationResult> {
		console.log("[Verifier] Validating changes for files:", input.files)

		const result: ValidationResult = {
			isValid: true,
			errors: [],
			warnings: [],
			suggestions: [],
		}

		// Check if files exist
		for (const file of input.files) {
			try {
				const fs = require("fs").promises
				await fs.access(file)
			} catch {
				result.errors.push(`File does not exist: ${file}`)
				result.isValid = false
			}
		}

		// Run syntax validation for each file
		for (const file of input.files) {
			if (file.endsWith(".py")) {
				const syntaxResult = await this.validatePythonSyntax(file)
				if (!syntaxResult.isValid) {
					result.errors.push(...syntaxResult.errors)
					result.warnings.push(...syntaxResult.warnings)
					result.isValid = false
				}
			} else if (file.endsWith(".js") || file.endsWith(".ts")) {
				const syntaxResult = await this.validateJavaScriptSyntax(file)
				if (!syntaxResult.isValid) {
					result.errors.push(...syntaxResult.errors)
					result.warnings.push(...syntaxResult.warnings)
					result.isValid = false
				}
			}
		}

		console.log(`[Verifier] Validation completed. Valid: ${result.isValid}, Errors: ${result.errors.length}`)
		return result
	}

	private async runLinter(input: { files?: string[]; projectType?: "odoo" | "django" | "generic" }): Promise<{
		success: boolean
		output: string
		lintResults: Array<{
			tool: string
			file: string
			issues: Array<{
				line: number
				column: number
				severity: "error" | "warning" | "info"
				message: string
				rule?: string
			}>
		}>
	}> {
		console.log("[Verifier] Running linter")

		const projectType = input.projectType || "generic"
		const files = input.files || []

		// Determine file types to lint
		const pythonFiles = files.filter((f) => f.endsWith(".py"))
		const jsFiles = files.filter((f) => f.endsWith(".js"))
		const tsFiles = files.filter((f) => f.endsWith(".ts"))

		const lintResults = []
		let overallSuccess = true
		let combinedOutput = ""

		// Run Python linters
		if (pythonFiles.length > 0) {
			const pythonLinters = this._lintCommands.python || []
			for (const linter of pythonLinters) {
				try {
					const command = `${linter} ${pythonFiles.join(" ")}`
					const result = await this.executeCommand(command, this._workspaceRoot)

					lintResults.push({
						tool: linter,
						file: pythonFiles.join(", "),
						issues: this.parseLintOutput(result.output, linter),
					})

					combinedOutput += `${linter} output:\n${result.output}\n\n`

					if (result.exitCode !== 0) {
						overallSuccess = false
					}
				} catch (error) {
					combinedOutput += `Error running ${linter}: ${error}\n\n`
					overallSuccess = false
				}
			}
		}

		// Run JavaScript/TypeScript linters
		const jsTsFiles = [...jsFiles, ...tsFiles]
		if (jsTsFiles.length > 0) {
			const jsLinters = this._lintCommands.javascript || []
			for (const linter of jsLinters) {
				try {
					const command = `${linter} ${jsTsFiles.join(" ")}`
					const result = await this.executeCommand(command, this._workspaceRoot)

					lintResults.push({
						tool: linter,
						file: jsTsFiles.join(", "),
						issues: this.parseLintOutput(result.output, linter),
					})

					combinedOutput += `${linter} output:\n${result.output}\n\n`

					if (result.exitCode !== 0) {
						overallSuccess = false
					}
				} catch (error) {
					combinedOutput += `Error running ${linter}: ${error}\n\n`
					overallSuccess = false
				}
			}
		}

		console.log(`[Verifier] Linting completed. Overall success: ${overallSuccess}`)
		return {
			success: overallSuccess,
			output: combinedOutput,
			lintResults,
		}
	}

	private async checkDependencies(input: { projectType: "odoo" | "django" | "generic" }): Promise<{
		valid: boolean
		issues: Array<{
			type: "missing" | "conflict" | "version"
			description: string
			severity: "error" | "warning"
		}>
	}> {
		console.log("[Verifier] Checking dependencies for:", input.projectType)

		const issues = []

		if (input.projectType === "odoo") {
			// Check for Odoo-specific dependencies
			try {
				const fs = require("fs").promises

				// Check manifest file
				const manifestFiles = ["__manifest__.py", "__openerp__.py"]
				for (const manifest of manifestFiles) {
					try {
						const content = await fs.readFile(manifest, "utf8")
						const manifestData = eval(content.replace(/^(.*)$/, "($1)"))

						// Check dependencies
						if (manifestData.depends) {
							for (const dep of manifestData.depends) {
								// Check if dependency addon exists
								try {
									await fs.access(dep)
								} catch {
									issues.push({
										type: "missing" as const,
										description: `Missing Odoo addon dependency: ${dep}`,
										severity: "error" as const,
									})
								}
							}
						}
					} catch (error) {
						issues.push({
							type: "missing" as const,
							description: `Could not read manifest file ${manifest}: ${error}`,
							severity: "warning" as const,
						})
					}
				}
			} catch (error) {
				issues.push({
					type: "missing" as const,
					description: `Dependency check failed: ${error}`,
					severity: "warning" as const,
				})
			}
		}

		return { valid, issues }
	}

	/**
	 * Get agent statistics
	 */
	getMetrics(): AgentMetrics {
		return {
			agentId: this.config.id,
			timestamp: new Date(),
			metrics: {
				taskCount: this._state.completedTasks.length,
				successRate: this._state.stats.successRate,
				averageResponseTime: this._state.stats.averageExecutionTime,
				memoryUsage: process.memoryUsage().heapUsed,
				cpuUsage: 0, // Would need proper implementation
				errorCount: this._state.stats.tasksFailed,
			},
		}
	}

	async updateConfig(config: Partial<AgentConfig>): Promise<void> {
		this._state.config = { ...this._state.config, ...config }
		console.log(`[VerifierAgent] Updated config for agent: ${this.config.id}`)
	}

	private async executeCommand(command: string, cwd: string): Promise<{ exitCode: number; output: string }> {
		const { exec } = require("child_process")
		const { promisify } = require("util")
		const execAsync = promisify(exec)

		try {
			const { stdout, stderr } = await execAsync(command, { cwd, timeout: 60000 })
			return {
				exitCode: 0,
				output: stdout + stderr,
			}
		} catch (error: any) {
			return {
				exitCode: error.code || 1,
				output: error.stdout + error.stderr,
			}
		}
	}

	private async validatePythonSyntax(filePath: string): Promise<ValidationResult> {
		try {
			const result = await this.executeCommand(`python -m py_compile ${filePath}`, this._workspaceRoot)
			return {
				isValid: result.exitCode === 0,
				errors: result.exitCode === 0 ? [] : [`Syntax error in ${filePath}`],
				warnings: [],
				suggestions: [],
			}
		} catch (error) {
			return {
				isValid: false,
				errors: [`Failed to validate Python syntax for ${filePath}: ${error}`],
				warnings: [],
				suggestions: [],
			}
		}
	}

	private async validateJavaScriptSyntax(filePath: string): Promise<ValidationResult> {
		try {
			const result = await this.executeCommand(`node -c ${filePath}`, this._workspaceRoot)
			return {
				isValid: result.exitCode === 0,
				errors: result.exitCode === 0 ? [] : [`Syntax error in ${filePath}`],
				warnings: [],
				suggestions: [],
			}
		} catch (error) {
			return {
				isValid: false,
				errors: [`Failed to validate JavaScript syntax for ${filePath}: ${error}`],
				warnings: [],
				suggestions: [],
			}
		}
	}

	private parseLintOutput(
		output: string,
		tool: string,
	): Array<{
		line: number
		column: number
		severity: "error" | "warning" | "info"
		message: string
		rule?: string
	}> {
		// This is a simplified implementation
		// In a real scenario, you'd parse specific linter output formats
		const issues = []
		const lines = output.split("\n")

		for (const line of lines) {
			if (line.trim()) {
				// Try to extract line number and message
				const match = line.match(/:(\d+):(?:(\d+):)?\s*(.+)$/)
				if (match) {
					issues.push({
						line: parseInt(match[1]),
						column: match[2] ? parseInt(match[2]) : 0,
						severity: line.toLowerCase().includes("error") ? "error" : "warning",
						message: match[3],
						rule: tool,
					})
				}
			}
		}

		return issues
	}

	private async handleVerificationRequest(message: AgentMessage): Promise<void> {
		console.log("[Verifier] Handling verification request:", message.content)

		const task: AgentTask = {
			id: `task-${Date.now()}`,
			type: "validate_changes",
			assignedTo: this.config.id,
			createdBy: message.from,
			status: "pending",
			priority: message.priority,
			input: message.content,
			createdAt: new Date(),
			updatedAt: new Date(),
		}

		try {
			const result = await this.executeTask(task)
			await this.sendMessage(message.from, "verification_complete", result, message.priority)
		} catch (error) {
			await this.sendMessage(
				message.from,
				"verification_failed",
				{ error: error instanceof Error ? error.message : String(error) },
				"high",
			)
		}
	}

	private async handleTestRequest(message: AgentMessage): Promise<void> {
		console.log("[Verifier] Handling test request:", message.content)

		const task: AgentTask = {
			id: `task-${Date.now()}`,
			type: "run_tests",
			assignedTo: this.config.id,
			createdBy: message.from,
			status: "pending",
			priority: message.priority,
			input: message.content,
			createdAt: new Date(),
			updatedAt: new Date(),
		}

		try {
			const result = await this.executeTask(task)
			await this.sendMessage(message.from, "test_complete", result, message.priority)
		} catch (error) {
			await this.sendMessage(
				message.from,
				"test_failed",
				{ error: error instanceof Error ? error.message : String(error) },
				"high",
			)
		}
	}
}
