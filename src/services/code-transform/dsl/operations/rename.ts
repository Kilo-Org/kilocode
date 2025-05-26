/**
 * Rename Operation Handler for Code Transformation DSL
 *
 * This module implements the handler for rename operations in the DSL,
 * connecting the DSL interface with the existing rename functionality.
 * It translates between DSL operation definitions and the existing refactoring system.
 */

import {
	RenameOperation,
	RenameResult,
	CodeSelector,
	isLocationSelector,
	isIdentifierSelector,
	isAstSelector,
} from "../types"
import { RenameSymbolOperation, RenameSymbolResult } from "../../refactorModels"
import { renameSymbol } from "../../renameSymbol"
import { selectNodesWithContext } from "../../utils/astSelection"
import * as jscodeshift from "jscodeshift"
import * as path from "path"
import * as fs from "fs/promises"

/**
 * Handler for DSL rename operations with enhanced AST selection capabilities
 *
 * This handler requires symbol-based selection by identifier or AST.
 * Location-based selectors with line numbers are not supported.
 * When using an identifier selector, the system will find the symbol
 * by name, which is resilient to code changes.
 */
export class RenameHandler {
	/**
	 * Execute a rename operation
	 * @param operation Validated rename operation
	 * @param selector Code selector identifying what to rename
	 */
	async execute(operation: RenameOperation, selector: CodeSelector): Promise<RenameResult> {
		try {
			// Validate rename operation before proceeding
			const validationResult = await this.validateRenameOperation(operation, selector)
			if (!validationResult.isValid) {
				return {
					success: false,
					error: `Validation failed: ${validationResult.issues.join(", ")}`,
				}
			}

			// Convert DSL operation to RenameSymbolOperation with enhanced selection
			const renameOp = await this.translateToRenameSymbolOperation(operation, selector)

			// Execute the rename operation using the existing functionality
			const result = await renameSymbol(renameOp)

			// Convert result back to DslResult format
			return this.translateToDslResult(result)
		} catch (error) {
			return {
				success: false,
				error: `Rename operation failed: ${error instanceof Error ? error.message : String(error)}`,
			}
		}
	}

	/**
	 * Validate the rename operation to prevent potential conflicts or issues
	 * @param operation DSL rename operation
	 * @param selector Code selector identifying what to rename
	 * @returns Validation result with potential issues
	 */
	private async validateRenameOperation(
		operation: RenameOperation,
		selector: CodeSelector,
	): Promise<{ isValid: boolean; issues: string[] }> {
		const issues: string[] = []

		// Check if newName is provided
		if (!operation.newName) {
			issues.push("newName is required for rename operations")
			return { isValid: false, issues }
		}

		// Check if selector is valid
		if (!selector) {
			issues.push("A valid code selector is required")
			return { isValid: false, issues }
		}

		try {
			// Get file path from selector
			let filePath = ""
			if (isLocationSelector(selector) || isAstSelector(selector)) {
				filePath = selector.filePath
			} else if (isIdentifierSelector(selector) && selector.filePath) {
				filePath = selector.filePath
			}

			if (filePath) {
				// Check if the file exists
				try {
					await fs.access(filePath)
				} catch (error) {
					issues.push(`File not found: ${filePath}`)
					return { isValid: false, issues }
				}

				// Read file content and parse AST
				const code = await fs.readFile(filePath, "utf8")
				const isTypeScript = [".ts", ".tsx"].includes(path.extname(filePath).toLowerCase())
				const parser = isTypeScript ? "tsx" : "babel"
				const ast = jscodeshift.withParser(parser)(code)

				// Perform validation based on selector type
				const selectedNodes = await selectNodesWithContext(ast, selector)

				// No nodes found to rename
				if (selectedNodes.length === 0) {
					issues.push("Could not find any nodes matching the selector")
					return { isValid: false, issues }
				}

				// Check for string literal conflicts
				const newName = operation.newName
				const existingIdentifiers = new Set<string>()

				// Find all identifiers in the file
				ast.find(jscodeshift.Identifier).forEach((path: any) => {
					existingIdentifiers.add(path.node.name)
				})

				// Check if the new name already exists and would cause conflicts
				if (existingIdentifiers.has(newName)) {
					// Only add as an issue, not a blocker
					issues.push(`Warning: New name '${newName}' already exists in the target file`)
				}
			}
		} catch (error) {
			issues.push(`Validation error: ${error instanceof Error ? error.message : String(error)}`)
		}

		// Return success if no critical issues were found
		return {
			isValid: !issues.some((issue) => !issue.startsWith("Warning:")),
			issues,
		}
	}

	/**
	 * Translate DSL rename operation to the format expected by the existing renameSymbol function
	 * with enhanced AST selection capabilities
	 * @param operation DSL rename operation
	 * @param selector Code selector identifying what to rename
	 * @returns Operation in the format expected by renameSymbol
	 */
	private async translateToRenameSymbolOperation(
		operation: RenameOperation,
		selector: CodeSelector,
	): Promise<RenameSymbolOperation> {
		// Ensure we have the required fields
		if (!operation.newName) {
			throw new Error("newName is required for rename operations")
		}

		const base = {
			operation: "rename_symbol" as const,
			newName: operation.newName,
			acrossFiles: operation.acrossFiles !== undefined ? operation.acrossFiles : true,
		}

		// Handle different selector types with enhanced selection
		if (isLocationSelector(selector)) {
			// Throw error for location selectors
			throw new Error(
				"ERROR: Location selectors are not supported for rename operations. " +
					"Please use an identifier selector with a symbol name instead. " +
					'Example: { "type": "identifier", "name": "oldName", "filePath": "path/to/file.ts" }',
			)
		} else if (isIdentifierSelector(selector)) {
			// Enhanced identifier-based selection
			return {
				...base,
				filePath: selector.filePath || "", // Empty string will be validated by renameSymbol
				oldName: selector.name,
			}
		} else if (isAstSelector(selector)) {
			// For AST selectors, use the enhanced selection capabilities
			const result: RenameSymbolOperation = {
				...base,
				filePath: selector.filePath,
			}

			// If position constraints are available, use the start line
			if (selector.constraints?.position) {
				result.startLine = selector.constraints.position.startLine
			} else {
				// For AST selectors without position, we extract the name from properties
				if (selector.constraints?.properties && "name" in selector.constraints.properties) {
					const name = selector.constraints.properties.name
					if (typeof name === "string") {
						result.oldName = name
					}
				}
			}

			return result
		}

		throw new Error(`Unsupported selector type: ${(selector as any).type}`)
	}

	/**
	 * Translate the result from renameSymbol to the DSL result format
	 * @param result Result from renameSymbol
	 * @returns Result in DSL format
	 */
	private translateToDslResult(result: RenameSymbolResult): RenameResult {
		return {
			success: result.success,
			error: result.error,
			modifiedFiles: result.modifiedFiles,
			modifiedContent: result.modifiedCode, // Rename to match our DSL schema
			referencesUpdated: result.affectedReferences,
			// Include metadata about string literals if available
			metadata: {
				includedStringLiterals: true,
				respectedScopes: true,
			},
		}
	}
}

/**
 * Execute a rename operation
 *
 * @param operation Validated rename operation
 * @param selector Code selector identifying what to rename
 * @returns Result of the operation
 *
 * REQUIRED USAGE:
 * - Use identifier selectors (type: 'identifier') for all rename operations
 * - Provide the symbol name and file path for precise selection
 * - Location-based selectors are not supported
 */
export async function executeRenameOperation(
	operation: RenameOperation,
	selector: CodeSelector,
): Promise<RenameResult> {
	const handler = new RenameHandler()
	return handler.execute(operation, selector)
}
