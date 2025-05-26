import * as path from "path"
import { ClineSayTool } from "../../shared/ExtensionMessage"
import { Task } from "../task/Task"
import { ToolUse, RemoveClosingTag } from "../../shared/tools"
import { formatResponse } from "../prompts/responses"
import { AskApproval, HandleError, PushToolResult } from "../../shared/tools"
import { fileExistsAtPath } from "../../utils/fs"
import { RecordSource } from "../context-tracking/FileContextTrackerTypes"
import { VSCodeRefactoringAdapter } from "../../services/code-transform/vscodeAdapter"

// Import DSL types and utilities
import {
	DslCommand,
	OperationType,
	MoveOperation,
	RenameOperation,
	RemoveOperation,
	MoveResult,
	RenameResult,
	RemoveResult,
	AnyRefactorOperation,
	MoveRefactorOperation,
	RenameRefactorOperation,
	RemoveRefactorOperation,
} from "../../services/code-transform/dsl/types"
import { parseBatchOperations } from "../../services/code-transform/dsl/parser"

// Import error handling utilities
import { CodeRefactoringError } from "../../services/code-transform/errors"

/**
 * Refactor code tool implementation
 *
 * This tool uses an AST-based Domain Specific Language (DSL) to perform batch code refactoring
 * operations. ALL operations must be provided as an array, even single operations.
 *
 * IMPORTANT GUIDELINES:
 * - ALL operations must be provided in an array format
 * - ONLY use symbol-based selectors (identifier) for all operations
 * - Line number-based selectors are not supported
 * - Each operation in the batch is processed independently
 * - If any operation fails, the entire batch will be rolled back
 *
 * Supported operations:
 * 1. Move: Move code elements from one file to another
 * 2. Rename: Rename symbols with proper reference handling
 * 3. Remove: Remove code elements from a file
 *
 * The operations parameter must be a valid JSON array with the following structure:
 *
 * Example batch operations:
 * ```json
 * [
 *   {
 *     "operation": "move",
 *     "selector": {
 *       "type": "identifier",
 *       "name": "calculateTotal",
 *       "filePath": "src/example.ts"
 *     },
 *     "targetFilePath": "src/target.ts"
 *   },
 *   {
 *     "operation": "rename",
 *     "selector": {
 *       "type": "identifier",
 *       "name": "oldName",
 *       "filePath": "src/example.ts"
 *     },
 *     "newName": "newName"
 *   },
 *   {
 *     "operation": "remove",
 *     "selector": {
 *       "type": "identifier",
 *       "name": "unusedFunction",
 *       "filePath": "src/example.ts"
 *     }
 *   }
 *   }
 * ]
 * ```
 *
 * Optional parameters:
 * - preview: Set to "true" to show what would happen without making changes
 */
export async function refactorCodeTool(
	cline: Task,
	block: ToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	_removeClosingTag: RemoveClosingTag, // Prefixed with underscore as it's no longer used
) {
	const dslCommandJson: string | undefined = block.params.operations
	// Use type assertion for preview parameter
	const isPreviewMode: boolean = (block.params as Record<string, string | undefined>).preview === "true"

	// Tool message properties
	const sharedMessageProps: ClineSayTool = {
		tool: "refactorCode",
		path: "",
		content: "",
	}

	try {
		// Handle partial execution (preview)
		if (block.partial) {
			await cline.ask("tool", JSON.stringify(sharedMessageProps), block.partial).catch(() => {})
			return
		}

		// Verify required operations parameter
		if (!dslCommandJson) {
			cline.consecutiveMistakeCount++
			cline.recordToolError("refactor_code")
			pushToolResult(await cline.sayAndCreateMissingParamError("refactor_code", "operations"))
			return
		}

		// Log the raw command for debugging
		console.log("Refactor code tool received command:", dslCommandJson)

		// Parse batch operations
		let operations: AnyRefactorOperation[]
		try {
			operations = parseBatchOperations(dslCommandJson)
			console.log("Parsed batch operations:", JSON.stringify(operations, null, 2))
		} catch (error) {
			cline.consecutiveMistakeCount++
			cline.recordToolError("refactor_code")
			const errorMessage = `Invalid batch operations: ${error instanceof Error ? error.message : String(error)}`
			await cline.say("error", errorMessage)

			// Add example of correct format to help the user
			const exampleMsg = `
You can provide operations in two formats:

1. Array format (preferred for multiple operations):
\`\`\`json
[
		{
			 "operation": "move",
			 "selector": {
			   "type": "identifier",
			   "name": "calculateTotal",
			   "kind": "function",
			   "filePath": "src/example.ts"
			 },
			 "targetFilePath": "src/target.ts"
		},
		{
			 "operation": "rename",
			 "selector": {
			   "type": "identifier",
			   "name": "oldName",
			   "filePath": "src/example.ts"
			 },
			 "newName": "newName"
		}
]
\`\`\`

2. Single operation format:
\`\`\`json
{
			"operation": "move",
			"selector": {
			  "type": "identifier",
			  "name": "calculateTotal",
			  "kind": "function",
			  "filePath": "src/example.ts"
			},
			"targetFilePath": "src/target.ts"
}
\`\`\`
`
			pushToolResult(errorMessage + "\n\n" + exampleMsg)
			return
		}

		// Validate all file paths exist and are accessible
		const filesToCheck = new Set<string>()
		for (const op of operations) {
			if (op.selector.filePath) {
				filesToCheck.add(op.selector.filePath)
			}
		}

		for (const filePath of filesToCheck) {
			// Verify path is accessible
			const accessAllowed = cline.rooIgnoreController?.validateAccess(filePath)
			if (!accessAllowed) {
				await cline.say("rooignore_error", filePath)
				pushToolResult(formatResponse.toolError(formatResponse.rooIgnoreError(filePath)))
				return
			}

			// Verify file exists
			const absolutePath = path.resolve(cline.cwd, filePath)
			const fileExists = await fileExistsAtPath(absolutePath)
			if (!fileExists) {
				cline.consecutiveMistakeCount++
				cline.recordToolError("refactor_code")
				const formattedError = `File does not exist at path: ${filePath}\n\n<error_details>\nThe specified file could not be found. Please verify the file path is relative to the workspace directory: ${cline.cwd}\nResolved absolute path: ${absolutePath}\n</error_details>`
				await cline.say("error", formattedError)
				pushToolResult(formattedError)
				return
			}
		}

		// If we're in preview mode, generate a preview without making changes
		if (isPreviewMode) {
			try {
				let previewMessage = "Preview of batch refactoring operations:\n\n"
				for (let i = 0; i < operations.length; i++) {
					const op = operations[i]
					previewMessage += `Operation ${i + 1}: ${createBatchOperationDescription(op)}\n`
				}
				previewMessage +=
					"\nTo execute these refactorings, run the command without the preview parameter or with preview=false."
				pushToolResult(previewMessage)
				return
			} catch (error) {
				const errorMessage = `Error generating preview: ${error instanceof Error ? error.message : String(error)}`
				await cline.say("error", errorMessage)
				pushToolResult(errorMessage)
				return
			}
		}

		// Create human-readable operation description for approval
		let operationDescription = `Batch refactoring: ${operations.length} operation${operations.length > 1 ? "s" : ""}\n\n`
		for (let i = 0; i < operations.length; i++) {
			operationDescription += `${i + 1}. ${createBatchOperationDescription(operations[i])}\n`
		}

		// Ask for approval before performing refactoring
		const approvalMessage = JSON.stringify({
			...sharedMessageProps,
			content: operationDescription,
		} satisfies ClineSayTool)

		const didApprove = await askApproval("tool", approvalMessage)
		if (!didApprove) {
			pushToolResult("Refactoring cancelled by user")
			return
		}

		// Create the VS Code adapter
		const adapter = new VSCodeRefactoringAdapter(cline.cwd)

		// Execute all operations
		const results: string[] = []
		let allSuccess = true
		const modifiedFiles = new Set<string>()

		// Track renamed identifiers to update selectors in subsequent operations
		const renamedIdentifiers = new Map<string, string>()

		for (let i = 0; i < operations.length; i++) {
			const op = operations[i]
			let result: string
			let success = false

			try {
				// Convert batch operation to legacy DslCommand format for adapter
				const dslCommand: DslCommand & { operationDetails: OperationType } = {
					schemaVersion: "1.0",
					operation: op.operation,
					selector: op.selector,
					operationDetails:
						op.operation === "move"
							? ({
									type: "move",
									targetFilePath: (op as MoveRefactorOperation).targetFilePath,
								} as MoveOperation)
							: op.operation === "rename"
								? ({
										type: "rename",
										newName: (op as RenameRefactorOperation).newName,
									} as RenameOperation)
								: ({
										type: "remove",
									} as RemoveOperation),
				}

				if (op.operation === "move") {
					const moveOp = op as MoveRefactorOperation

					// Verify target path access
					const targetAccessAllowed = cline.rooIgnoreController?.validateAccess(moveOp.targetFilePath)
					if (!targetAccessAllowed) {
						result = formatResponse.rooIgnoreError(moveOp.targetFilePath)
						success = false
					} else {
						// Track files
						if (op.selector.filePath) {
							modifiedFiles.add(path.resolve(cline.cwd, op.selector.filePath))
						}
						modifiedFiles.add(path.resolve(cline.cwd, moveOp.targetFilePath))

						// Execute the move operation
						const opResult = (await adapter.executeDslCommand(dslCommand)) as MoveResult

						if (opResult.success) {
							success = true
							const selectorName = op.selector.type === "identifier" ? op.selector.name : "code"
							result = `Moved ${selectorName} to ${moveOp.targetFilePath}`
							await cline.fileContextTracker.trackFileContext(
								moveOp.targetFilePath,
								"roo_edited" as RecordSource,
							)
						} else {
							result = opResult.error || "Unknown error during code move"
						}
					}
				} else if (op.operation === "rename") {
					const renameOp = op as RenameRefactorOperation

					// Execute the rename operation
					const opResult = (await adapter.executeDslCommand(dslCommand)) as RenameResult

					if (opResult.success) {
						success = true
						const selectorName = op.selector.type === "identifier" ? op.selector.name : "symbol"
						result = `Renamed ${selectorName} to ${renameOp.newName}`

						// Track renamed identifiers for subsequent operations
						if (op.selector.type === "identifier") {
							renamedIdentifiers.set(op.selector.name, renameOp.newName)
						}

						// Track modified files
						if (opResult.modifiedFiles) {
							for (const file of opResult.modifiedFiles) {
								modifiedFiles.add(path.resolve(cline.cwd, file))
								await cline.fileContextTracker.trackFileContext(file, "roo_edited" as RecordSource)
							}
						}
					} else {
						result = opResult.error || "Unknown error during symbol rename"
					}
				} else if (op.operation === "remove") {
					const _removeOp = op as RemoveRefactorOperation

					// Check if the identifier has been renamed in a previous operation
					if (op.selector.type === "identifier" && renamedIdentifiers.has(op.selector.name)) {
						// Update the selector to use the new name
						const newName = renamedIdentifiers.get(op.selector.name)!
						console.log(`Updating remove operation selector from ${op.selector.name} to ${newName}`)
						op.selector.name = newName

						// Update the DSL command
						dslCommand.selector = op.selector
					}

					// Execute the remove operation
					const opResult = (await adapter.executeDslCommand(dslCommand)) as RemoveResult

					if (opResult.success) {
						success = true
						const selectorName = op.selector.type === "identifier" ? op.selector.name : "code"
						result = `Removed ${selectorName} from ${op.selector.filePath}`

						// Track modified files
						if (opResult.modifiedFiles) {
							for (const file of opResult.modifiedFiles) {
								modifiedFiles.add(path.resolve(cline.cwd, file))
								await cline.fileContextTracker.trackFileContext(file, "roo_edited" as RecordSource)
							}
						} else if (op.selector.filePath) {
							// Fallback to just tracking the source file
							modifiedFiles.add(path.resolve(cline.cwd, op.selector.filePath))
							await cline.fileContextTracker.trackFileContext(
								op.selector.filePath,
								"roo_edited" as RecordSource,
							)
						}
					} else {
						result = opResult.error || "Unknown error during code removal"
					}
				} else {
					result = `Unsupported operation: ${(op as any).operation}`
				}
			} catch (error) {
				// Handle structured errors consistently
				if (error instanceof CodeRefactoringError) {
					result = error.formatForDisplay()
				} else {
					result = `Error: ${error instanceof Error ? error.message : String(error)}`
				}
				success = false
			}

			results.push(`Operation ${i + 1}: ${success ? "✓" : "✗"} ${result}`)
			if (!success) {
				allSuccess = false
				// Stop on first failure
				break
			}
		}

		// Track source files
		for (const op of operations) {
			if (op.selector.filePath) {
				await cline.fileContextTracker.trackFileContext(op.selector.filePath, "roo_edited" as RecordSource)
			}
		}

		// Report results
		const finalResult = results.join("\n")
		if (allSuccess) {
			cline.consecutiveMistakeCount = 0
			cline.didEditFile = true
			pushToolResult(`Batch refactoring completed successfully:\n\n${finalResult}`)
		} else {
			cline.consecutiveMistakeCount++
			cline.recordToolError("refactor_code", finalResult)
			await cline.say("error", `Batch refactoring failed:\n\n${finalResult}`)
			pushToolResult(`Batch refactoring failed:\n\n${finalResult}`)
		}
	} catch (error) {
		await handleError("refactoring code", error)
	}
}

/**
 * Create a human-readable description of a batch operation
 *
 * @param op The batch operation to describe
 * @returns A user-friendly description string
 */
function createBatchOperationDescription(op: AnyRefactorOperation): string {
	let selectorDescription = ""
	if (op.selector.type === "identifier") {
		selectorDescription = `symbol '${op.selector.name}'${op.selector.filePath ? ` in ${op.selector.filePath}` : ""}`
	} else if (op.selector.type === "ast") {
		selectorDescription = `${op.selector.nodeType} in ${op.selector.filePath}`
	} else if (op.selector.type === "location") {
		// Legacy support for location selectors
		selectorDescription = `code in ${op.selector.filePath}`
	}

	if (op.operation === "move") {
		const moveOp = op as MoveRefactorOperation
		return `Move ${selectorDescription} to ${moveOp.targetFilePath}`
	} else if (op.operation === "rename") {
		const renameOp = op as RenameRefactorOperation
		return `Rename ${selectorDescription} to '${renameOp.newName}'`
	} else if (op.operation === "remove") {
		const _removeOp = op as RemoveRefactorOperation
		return `Remove ${selectorDescription}`
	} else {
		return `Perform ${(op as any).operation} operation on ${selectorDescription}`
	}
}
