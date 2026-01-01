// kilocode_change - new file

import { BaseAgent } from "./base-agent"
import { AgentTask, AgentMessage, CodeChange, ValidationResult } from "./types"
import { ExecutorService } from "../executor/executor-service"

export interface ExecutorConfig {
	executorService: ExecutorService
	workspaceRoot: string
}

export class ExecutorAgent extends BaseAgent {
	private _executorService: ExecutorService
	private _workspaceRoot: string

	constructor(config: ExecutorConfig) {
		super({
			id: "executor-001",
			name: "Kilo Code Executor",
			type: "executor",
			capabilities: [
				{
					name: "apply_code_changes",
					description: "Apply code changes to files",
					inputTypes: ["code_change", "code_change[]"],
					outputTypes: ["validation_result"],
				},
				{
					name: "create_file",
					description: "Create new files",
					inputTypes: ["file_creation_request"],
					outputTypes: ["file_result"],
				},
				{
					name: "update_file",
					description: "Update existing files",
					inputTypes: ["file_update_request"],
					outputTypes: ["file_result"],
				},
				{
					name: "validate_syntax",
					description: "Validate code syntax",
					inputTypes: ["file_path"],
					outputTypes: ["validation_result"],
				},
			],
			enabled: true,
			priority: 2,
			maxConcurrentTasks: 5,
			timeout: 60000,
		})

		this._executorService = config.executorService
		this._workspaceRoot = config.workspaceRoot
	}

	protected async setupMessageHandlers(): Promise<void> {
		this._messageHandlers.set("execute", async (message: AgentMessage) => {
			await this.handleExecutionRequest(message)
		})

		this._messageHandlers.set("validate", async (message: AgentMessage) => {
			await this.handleValidationRequest(message)
		})
	}

	protected async processTask(task: AgentTask): Promise<any> {
		switch (task.type) {
			case "apply_code_changes":
				return await this.applyCodeChanges(task.input)
			case "create_file":
				return await this.createFile(task.input)
			case "update_file":
				return await this.updateFile(task.input)
			case "validate_syntax":
				return await this.validateSyntax(task.input)
			default:
				throw new Error(`Unknown task type: ${task.type}`)
		}
	}

	private async applyCodeChanges(input: { changes: CodeChange[] }): Promise<ValidationResult> {
		console.log("[Executor] Applying code changes:", input.changes.length, "files")

		const results: ValidationResult = {
			isValid: true,
			errors: [],
			warnings: [],
			suggestions: [],
		}

		try {
			// Group changes by file for efficient processing
			const changesByFile = new Map<string, CodeChange[]>()
			for (const change of input.changes) {
				if (!changesByFile.has(change.filePath)) {
					changesByFile.set(change.filePath, [])
				}
				changesByFile.get(change.filePath)!.push(change)
			}

			// Apply changes file by file
			for (const [filePath, fileChanges] of changesByFile) {
				try {
					await this.applyFileChanges(filePath, fileChanges)
					console.log(`[Executor] Successfully applied changes to ${filePath}`)
				} catch (error) {
					const errorMsg = `Failed to apply changes to ${filePath}: ${error instanceof Error ? error.message : String(error)}`
					results.errors.push(errorMsg)
					results.isValid = false
				}
			}

			// Validate syntax for all modified files
			for (const filePath of changesByFile.keys()) {
				try {
					const syntaxResult = await this._executorService.testCodeSyntax(filePath)
					if (!syntaxResult.isValid) {
						results.errors.push(...syntaxResult.errors)
						results.isValid = false
					}
					results.warnings.push(...syntaxResult.errors)
				} catch (error) {
					results.warnings.push(`Could not validate syntax for ${filePath}: ${error}`)
				}
			}

			console.log(
				`[Executor] Applied changes with ${results.errors.length} errors, ${results.warnings.length} warnings`,
			)
			return results
		} catch (error) {
			console.error("[Executor] Error applying code changes:", error)
			results.errors.push(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`)
			results.isValid = false
			return results
		}
	}

	private async createFile(input: {
		filePath: string
		content: string
	}): Promise<{ success: boolean; error?: string }> {
		console.log("[Executor] Creating file:", input.filePath)

		try {
			const fs = require("fs").promises
			const path = require("path")

			// Ensure directory exists
			const dir = path.dirname(input.filePath)
			await fs.mkdir(dir, { recursive: true })

			// Write file
			await fs.writeFile(input.filePath, input.content, "utf8")

			console.log(`[Executor] Successfully created file: ${input.filePath}`)
			return { success: true }
		} catch (error) {
			const errorMsg = `Failed to create file ${input.filePath}: ${error instanceof Error ? error.message : String(error)}`
			console.error("[Executor]", errorMsg)
			return { success: false, error: errorMsg }
		}
	}

	private async updateFile(input: {
		filePath: string
		edits: CodeChange["edits"]
	}): Promise<{ success: boolean; error?: string }> {
		console.log("[Executor] Updating file:", input.filePath)

		try {
			// Use executor service to apply edits
			const parsedEdits =
				input.edits?.map((edit: any) => ({
					filePath: input.filePath,
					startLine: edit.startLine,
					endLine: edit.endLine,
					newText: edit.newText,
					oldText: "", // Will be filled by executor service
					type: "search_replace" as const,
				})) || []

			await this._executorService.applyMultiFilePatch([
				{
					filePath: input.filePath,
					edits: parsedEdits,
				},
			])

			console.log(`[Executor] Successfully updated file: ${input.filePath}`)
			return { success: true }
		} catch (error) {
			const errorMsg = `Failed to update file ${input.filePath}: ${error instanceof Error ? error.message : String(error)}`
			console.error("[Executor]", errorMsg)
			return { success: false, error: errorMsg }
		}
	}

	private async validateSyntax(input: { filePath: string }): Promise<ValidationResult> {
		console.log("[Executor] Validating syntax for:", input.filePath)

		try {
			const result = await this._executorService.testCodeSyntax(input.filePath)

			return {
				isValid: result.isValid,
				errors: result.errors,
				warnings: [], // Executor service doesn't provide warnings separately
				suggestions: result.isValid ? [] : ["Check syntax and imports"],
			}
		} catch (error) {
			return {
				isValid: false,
				errors: [`Syntax validation failed: ${error instanceof Error ? error.message : String(error)}`],
				warnings: [],
				suggestions: [],
			}
		}
	}

	private async applyFileChanges(filePath: string, changes: CodeChange[]): Promise<void> {
		const change = changes[0] // Take the first change for now

		switch (change.type) {
			case "create":
				if (!change.content) {
					throw new Error("Create operation requires content")
				}
				await this.createFile({ filePath, content: change.content })
				break

			case "update":
				if (!change.edits || change.edits.length === 0) {
					throw new Error("Update operation requires edits")
				}
				await this.updateFile({ filePath, edits: change.edits })
				break

			case "delete": {
				const fs = require("fs").promises
				await fs.unlink(filePath)
				break
			}

			default:
				throw new Error(`Unknown change type: ${change.type}`)
		}
	}

	private async handleExecutionRequest(message: AgentMessage): Promise<void> {
		console.log("[Executor] Handling execution request:", message.content)

		const task: AgentTask = {
			id: `task-${Date.now()}`,
			type: "apply_code_changes",
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
			await this.sendMessage(message.from, "execution_complete", result, message.priority)
		} catch (error) {
			await this.sendMessage(
				message.from,
				"execution_failed",
				{ error: error instanceof Error ? error.message : String(error) },
				"high",
			)
		}
	}

	private async handleValidationRequest(message: AgentMessage): Promise<void> {
		console.log("[Executor] Handling validation request:", message.content)

		const task: AgentTask = {
			id: `task-${Date.now()}`,
			type: "validate_syntax",
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
			await this.sendMessage(message.from, "validation_complete", result, message.priority)
		} catch (error) {
			await this.sendMessage(
				message.from,
				"validation_failed",
				{ error: error instanceof Error ? error.message : String(error) },
				"high",
			)
		}
	}
}
