/**
 * Enhanced Move Operation Handler for Code Transformation DSL
 *
 * This module implements the handler for move operations in the DSL,
 * connecting the DSL interface with the refactoring system using advanced
 * AST selection capabilities. It includes improved dependency handling,
 * validation for multiple move operations, and smart placement support.
 *
 * IMPORTANT GUIDELINES:
 * 1. ONLY use symbol-based selectors (identifier) for code operations
 * 2. Line number-based selectors are not supported and should never be used
 * 3. AST selectors must be converted to identifier selectors
 * 4. The system will find the appropriate insertion point in the target file
 *    based on code structure
 */

import {
	MoveOperation,
	MoveResult,
	CodeSelector,
	isLocationSelector,
	isIdentifierSelector,
	isAstSelector,
} from "../types"
import { MoveToFileOperation, MoveToFileResult } from "../../refactorModels"
import { moveCodeByIdentifier } from "../../index"

/**
 * Track active move operations to prevent overlapping moves that could cause corruption
 */
const activeMoveOperations = new Map<
	string,
	{
		sourceFilePath: string
		startLine: number
		endLine: number
		targetFilePath: string
		inProgress: boolean
	}
>()

/**
 * Track pending operations that are being initialized
 */
const pendingOperations = new Set<string>()

/**
 * Enhanced handler for DSL move operations leveraging AST-based capabilities
 *
 * This handler prioritizes symbol-based selection (by identifier or AST)
 * over brittle line-based selection. When using an identifier selector,
 * the system will find the code element by name rather than relying on
 * specific line numbers that can change as code evolves.
 */
export class MoveHandler {
	/**
	 * Execute a move operation with enhanced AST selection and dependency handling
	 * @param operation Validated move operation
	 * @param selector Code selector identifying what to move
	 */
	async execute(operation: MoveOperation, selector: CodeSelector): Promise<MoveResult> {
		let operationKey: string | undefined
		let pendingKey: string | undefined

		try {
			// Create a pending key based on selector to prevent race conditions
			if (isLocationSelector(selector)) {
				pendingKey = `${selector.filePath}:${selector.startLine}-${selector.endLine}`
			} else if (isAstSelector(selector) && selector.constraints?.position) {
				pendingKey = `${selector.filePath}:${selector.constraints.position.startLine}-${selector.constraints.position.endLine}`
			} else if (isIdentifierSelector(selector) && selector.filePath) {
				pendingKey = `${selector.filePath}:${selector.name}`
			}

			// Check if this operation is already pending
			if (pendingKey && pendingOperations.has(pendingKey)) {
				throw new Error(
					"Concurrent move operation detected. Another operation is already being initialized for this code location",
				)
			}

			// Mark as pending
			if (pendingKey) {
				pendingOperations.add(pendingKey)
			}

			// First, get basic info to create a temporary registration
			const basicInfo = await this.getBasicOperationInfo(operation, selector)

			// Register this operation as active immediately to prevent conflicting operations
			operationKey = `${basicInfo.sourceFilePath}:${basicInfo.startLine}-${basicInfo.endLine}`
			activeMoveOperations.set(operationKey, {
				sourceFilePath: basicInfo.sourceFilePath,
				startLine: basicInfo.startLine,
				endLine: basicInfo.endLine,
				targetFilePath: operation.targetFilePath,
				inProgress: true,
			})

			// Remove from pending since we're now active
			if (pendingKey) {
				pendingOperations.delete(pendingKey)
			}

			// Now validate to prevent overlapping moves that could corrupt files
			await this.validateOperation(operation, selector)

			try {
				// Execute the move operation based on selector type
				if (isLocationSelector(selector)) {
					return {
						success: false,
						error: "Line number-based selectors are not supported. Please use identifier selectors with a symbol name instead.",
					}
				} else if (isIdentifierSelector(selector)) {
					// For identifier selectors, use the moveCodeByIdentifier function
					if (!selector.filePath) {
						throw new Error(
							"filePath is required in selector for move operations with identifier selectors",
						)
					}

					try {
						// Ensure we have a valid kind for the identifier
						// Log the move operation for debugging
						console.log(
							`Moving '${selector.name}' from ${selector.filePath} to ${operation.targetFilePath}`,
						)

						const result = await moveCodeByIdentifier(
							selector.filePath,
							operation.targetFilePath,
							selector.name,
						)

						// Convert result back to DslResult format
						return this.translateToDslResult(result, {
							operation: "move_to_file",
							sourceFilePath: selector.filePath,
							targetFilePath: operation.targetFilePath,
							identifierName: selector.name,
						})
					} catch (error) {
						console.error(`Error moving '${selector.name}':`, error)
						return {
							success: false,
							error: `Failed to move code: ${error instanceof Error ? error.message : String(error)}`,
						}
					}
				} else if (isAstSelector(selector)) {
					// Try to convert AST selector to identifier selector
					if (selector.nodeType && selector.filePath) {
						// Create an identifier selector from the AST selector
						const identifierName =
							(selector.constraints?.properties?.["name"] as string) ||
							(selector.constraints?.position
								? `symbol_at_line_${selector.constraints.position.startLine}`
								: "unknown")

						console.log(`Converting AST selector to identifier selector: ${identifierName}`)

						try {
							const result = await moveCodeByIdentifier(
								selector.filePath,
								operation.targetFilePath,
								identifierName,
							)

							return this.translateToDslResult(result, {
								operation: "move_to_file",
								sourceFilePath: selector.filePath,
								targetFilePath: operation.targetFilePath,
								identifierName,
							})
						} catch (error) {
							return {
								success: false,
								error: `Failed to move code using converted AST selector: ${error instanceof Error ? error.message : String(error)}`,
							}
						}
					}

					return {
						success: false,
						error: "Move operations with AST-based selectors require name and filePath. Please use identifier selectors directly.",
					}
				} else {
					throw new Error(`Unsupported selector type: ${(selector as any).type}`)
				}
			} finally {
				// Mark operation as completed
				if (operationKey) {
					activeMoveOperations.delete(operationKey)
				}
			}
		} catch (error) {
			// Clean up if we registered but failed
			if (operationKey) {
				activeMoveOperations.delete(operationKey)
			}
			if (pendingKey) {
				pendingOperations.delete(pendingKey)
			}

			return {
				success: false,
				error: `Move operation failed: ${error instanceof Error ? error.message : String(error)}`,
			}
		}
	}

	/**
	 * Get basic operation info for early registration
	 * @param operation Operation to get info from
	 * @param selector Code selector identifying what to move
	 * @returns Basic operation info
	 */
	private async getBasicOperationInfo(
		operation: MoveOperation,
		selector: CodeSelector,
	): Promise<{
		sourceFilePath: string
		startLine: number
		endLine: number
	}> {
		let sourceFilePath: string
		let startLine = 0
		let endLine = 0

		if (isLocationSelector(selector)) {
			// Location selectors are not supported
			throw new Error(
				"Line number-based selectors are not supported. Please use identifier selectors with a symbol name instead.",
			)
		} else if (isAstSelector(selector)) {
			if (!selector.filePath) {
				throw new Error("AST selector for move operations requires filePath")
			}
			sourceFilePath = selector.filePath

			// Use position constraints if available, otherwise use dummy values
			if (selector.constraints?.position) {
				startLine = selector.constraints.position.startLine
				endLine = selector.constraints.position.endLine
			} else {
				// Dummy values
				startLine = 1
				endLine = 1
			}
		} else if (isIdentifierSelector(selector)) {
			if (!selector.filePath) {
				throw new Error("filePath is required in selector for move operations with identifier selectors")
			}

			// For identifier selectors, we use the moveCodeByIdentifier function
			// which will handle finding the position for us
			sourceFilePath = selector.filePath

			// We'll set dummy line numbers since we're using the identifier-based approach
			startLine = 1
			endLine = 1
		} else {
			throw new Error(`Unsupported selector type: ${(selector as any).type}`)
		}

		return { sourceFilePath, startLine, endLine }
	}

	/**
	 * Validate to ensure no overlapping moves that could cause file corruption
	 * @param operation Operation to validate
	 * @param selector Code selector identifying what to move
	 */
	private async validateOperation(operation: MoveOperation, selector: CodeSelector): Promise<void> {
		// Get basic info to check against active operations
		const { sourceFilePath, startLine, endLine } = await this.getBasicOperationInfo(operation, selector)

		// Check if this move overlaps with any active move operations
		for (const [key, activeOp] of activeMoveOperations.entries()) {
			// Skip checking against ourselves
			if (key === `${sourceFilePath}:${startLine}-${endLine}`) {
				continue
			}

			if (activeOp.sourceFilePath === sourceFilePath && startLine > 0 && endLine > 0) {
				// Check for overlapping lines (only if we have valid line numbers)
				const overlap = !(endLine < activeOp.startLine || startLine > activeOp.endLine)

				if (overlap) {
					throw new Error(
						`Concurrent move operation detected that would cause file corruption. ` +
							`Operation ${key} is already moving lines ${activeOp.startLine}-${activeOp.endLine}. ` +
							`Please wait for it to complete before moving lines ${startLine}-${endLine}.`,
					)
				}
			}

			// Also prevent moving to a file that's being modified by another operation
			if (activeOp.targetFilePath === operation.targetFilePath && activeOp.inProgress) {
				throw new Error(
					`Target file ${operation.targetFilePath} is currently being modified by another operation. ` +
						`Please wait for it to complete.`,
				)
			}
		}
	}

	/**
	 * Translate the result from moveCode to the DSL result format
	 * @param result Result from moveCode
	 * @param operation The original operation
	 * @returns Result in DSL format
	 */
	private translateToDslResult(result: MoveToFileResult, operation: MoveToFileOperation): MoveResult {
		return {
			success: result.success,
			error: result.error,
			sourceFilePath: operation.sourceFilePath,
			targetFilePath: operation.targetFilePath,
			modifiedSourceContent: result.modifiedSourceCode,
			modifiedTargetContent: result.modifiedTargetCode,
			elementsMoved: result.movedNodes || 1,
			exportsAdded: result.exportedNames || [],
			importsAdded: result.importsAdded
				? typeof result.importsAdded === "boolean"
					? []
					: result.importsAdded
				: [],
		}
	}
}

/**
 * Execute a move operation leveraging enhanced AST selection capabilities
 *
 * @param operation Validated move operation
 * @param selector Code selector identifying what to move
 * @returns Result of the operation
 *
 * REQUIRED USAGE:
 * - Use identifier selectors (type: 'identifier') for all operations
 * - Provide the symbol name and file path for precise selection
 * - DO NOT use line numbers or location-based selectors
 * - The system will find the appropriate insertion point in the target file
 */
export async function executeMoveOperation(operation: MoveOperation, selector: CodeSelector): Promise<MoveResult> {
	const handler = new MoveHandler()
	return handler.execute(operation, selector)
}
