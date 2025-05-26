/**
 * Remove Operation Handler for Code Transformation DSL
 *
 * This module implements the handler for remove operations in the DSL,
 * connecting the DSL interface with the refactoring system. It allows
 * for removing code elements from a file by their identifier.
 */

import {
	RemoveOperation,
	RemoveResult,
	CodeSelector,
	isLocationSelector,
	isIdentifierSelector,
	isAstSelector,
} from "../types"
import * as jscodeshift from "jscodeshift"
import * as path from "path"
import * as fs from "fs/promises"
import * as vscode from "vscode"
import { selectNodesWithContext } from "../../utils/astSelection"
import { regexSearchFiles } from "../../../../services/ripgrep"

/**
 * Handler for DSL remove operations with enhanced AST selection capabilities
 *
 * This handler requires symbol-based selection by identifier or AST.
 * Location-based selectors with line numbers are not supported.
 * When using an identifier selector, the system will find the symbol
 * by name, which is resilient to code changes.
 */
export class RemoveHandler {
	/**
	 * Execute a remove operation
	 * @param operation Validated remove operation
	 * @param selector Code selector identifying what to remove
	 */
	async execute(operation: RemoveOperation, selector: CodeSelector): Promise<RemoveResult> {
		try {
			// Validate remove operation before proceeding
			const validationResult = await this.validateRemoveOperation(operation, selector)
			if (!validationResult.isValid) {
				return {
					success: false,
					error: `Validation failed: ${validationResult.issues.join(", ")}`,
				}
			}

			// Add a flag to indicate we should clean up references across files
			const cleanupReferences = true

			// Get file path from selector
			let filePath = ""
			if (isLocationSelector(selector) || isAstSelector(selector)) {
				filePath = selector.filePath
			} else if (isIdentifierSelector(selector) && selector.filePath) {
				filePath = selector.filePath
			} else {
				return {
					success: false,
					error: "File path is required in selector for remove operations",
				}
			}

			// Read file content
			const code = await fs.readFile(filePath, "utf8")
			const isTypeScript = [".ts", ".tsx"].includes(path.extname(filePath).toLowerCase())
			const parser = isTypeScript ? "tsx" : "babel"
			const ast = jscodeshift.withParser(parser)(code)

			// If it's an identifier selector without a kind, try to infer it
			if (isIdentifierSelector(selector)) {
				// Only infer kind if it's not already specified
				if (!selector.kind) {
					// Try to infer the kind based on the name pattern
					if (selector.name.match(/^[A-Z][a-zA-Z0-9]*$/)) {
						selector.kind = "class" // PascalCase typically indicates a class
					} else if (selector.name.match(/^[A-Z_][A-Z0-9_]*$/)) {
						selector.kind = "variable" // UPPER_CASE typically indicates a constant
					} else if (selector.name.match(/^function[A-Z]/)) {
						selector.kind = "function" // Names starting with "function" are clearly functions
					} else if (selector.name.match(/^variable[A-Z]/)) {
						selector.kind = "variable" // Names starting with "variable" are clearly variables
					} else if (selector.name.match(/^[a-z].*[tT]oRemove$/)) {
						// For variables with 'ToRemove' suffix that aren't prefixed with 'function'
						if (!selector.name.match(/^function/i)) {
							selector.kind = "variable"
						} else {
							selector.kind = "function"
						}
					} else {
						// Default inference based on common patterns
						selector.kind = "function" // Default to function for other patterns
					}
					console.log(`Inferred kind '${selector.kind}' for identifier '${selector.name}'`)
				} else {
					console.log(`Using specified kind '${selector.kind}' for identifier '${selector.name}'`)
				}
			}

			// Find the nodes to remove
			const selectedNodes = await selectNodesWithContext(ast, selector)
			if (selectedNodes.length === 0) {
				return {
					success: false,
					error: `Could not find any nodes matching the selector in ${filePath}`,
				}
			}

			// Track removed imports
			const importsRemoved: string[] = []

			// Find and remove each selected node
			selectedNodes.forEach((structureNode) => {
				// Check if it's an import declaration
				if (structureNode.node.type === "ImportDeclaration") {
					// Track the imported module
					const importSource = structureNode.node.source.value
					if (typeof importSource === "string") {
						importsRemoved.push(importSource)
					}
				}

				// Find the path to this node for removal
				ast.find(jscodeshift.Node, (n) => n === structureNode.node).forEach((path) => {
					// Remove the node
					path.prune()
				})
			})

			// Clean up any empty export statements that might have been left behind
			ast.find(jscodeshift.ExportNamedDeclaration).forEach((path) => {
				const node = path.node
				// If it's an empty export statement (no specifiers, no declaration)
				if ((!node.specifiers || node.specifiers.length === 0) && !node.declaration) {
					path.prune()
				}
			})

			// Clean up any empty lines and generate the modified code
			const modifiedCode = ast.toSource().replace(/^\s*[\r\n]/gm, "\n")

			// Write the modified code back to the file
			await fs.writeFile(filePath, modifiedCode, "utf8")

			// If we have an identifier selector and cleanupReferences is true, clean up references in other files
			const modifiedFiles = [filePath]
			const modifiedCodeMap = { [filePath]: modifiedCode }

			if (cleanupReferences && isIdentifierSelector(selector) && selector.name) {
				const additionalChanges = await this.cleanupReferencesAcrossFiles(filePath, selector.name, parser)

				if (additionalChanges.length > 0) {
					for (const change of additionalChanges) {
						modifiedFiles.push(change.filePath)
						modifiedCodeMap[change.filePath] = change.modifiedCode
						if (change.importsRemoved) {
							importsRemoved.push(...change.importsRemoved)
						}
					}
				}
			}

			return {
				success: true,
				filePath,
				modifiedContent: modifiedCode,
				elementsRemoved: selectedNodes.length,
				importsRemoved,
				modifiedFiles,
			}
		} catch (error) {
			return {
				success: false,
				error: `Remove operation failed: ${error instanceof Error ? error.message : String(error)}`,
			}
		}
	}

	/**
	 * Validate the remove operation to prevent potential issues
	 * @param operation DSL remove operation
	 * @param selector Code selector identifying what to remove
	 * @returns Validation result with potential issues
	 */
	private async validateRemoveOperation(
		operation: RemoveOperation,
		selector: CodeSelector,
	): Promise<{ isValid: boolean; issues: string[] }> {
		const issues: string[] = []

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

			if (!filePath) {
				issues.push("File path is required in selector for remove operations")
				return { isValid: false, issues }
			}

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

			// No nodes found to remove
			if (selectedNodes.length === 0) {
				issues.push(`Could not find any nodes matching the selector in ${filePath}`)
				return { isValid: false, issues }
			}

			// Check if we're trying to remove the entire file content
			if (selectedNodes.length === 1) {
				const node = selectedNodes[0].node
				if (
					node.type === "Program" ||
					(node.type === "ExpressionStatement" &&
						node.expression?.type === "CallExpression" &&
						node.expression.callee?.type === "Identifier" &&
						node.expression.callee.name === "jscodeshift")
				) {
					issues.push("Cannot remove the entire file content. Use file system operations instead.")
					return { isValid: false, issues }
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
	 * Clean up references to the removed symbol across files
	 *
	 * @param sourceFilePath Path to the source file where the symbol was removed
	 * @param symbolName Name of the symbol that was removed
	 * @param parser Parser to use (tsx or babel)
	 * @returns Array of file changes
	 */
	private async cleanupReferencesAcrossFiles(
		sourceFilePath: string,
		symbolName: string,
		parser: string,
	): Promise<Array<{ filePath: string; modifiedCode: string; importsRemoved?: string[] }>> {
		const fileChanges: Array<{ filePath: string; modifiedCode: string; importsRemoved?: string[] }> = []
		const sourceDir = path.dirname(sourceFilePath)
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || sourceDir

		// Use ripgrep to find all occurrences of the symbol
		// Create a pattern to match:
		// 1. Import statements with the symbol name
		// 2. References to the symbol
		const patterns = [
			// Import statements
			`import[^;]*\\{[^;]*\\b${symbolName}\\b[^;]*\\}`,
			`import[^;]*\\b${symbolName}\\b`,
			// Export statements
			`export[^;]*\\{[^;]*\\b${symbolName}\\b[^;]*\\}`,
			// Class usage
			`new\\s+${symbolName}\\b`,
			`new\\s+${symbolName}\\(\\)`,
			// Method calls and property access
			`\\.[^(]*\\b${symbolName}\\b`,
			`\\.${symbolName}\\(\\)`,
			// Basic identifier with word boundaries
			`\\b${symbolName}\\b`,
		]

		const pattern = patterns.join("|")
		let searchResults: string

		try {
			// Search in all ts/tsx/js/jsx files
			console.log(`Starting cross-file search in ${workspaceRoot} for pattern: ${pattern}`)
			searchResults = await regexSearchFiles(workspaceRoot, workspaceRoot, pattern, "*.{ts,tsx,js,jsx}")
			console.log(`Search results: ${searchResults.substring(0, 200)}${searchResults.length > 200 ? "..." : ""}`)
		} catch (error) {
			console.error("Error searching for symbol references:", error)
			return fileChanges
		}

		// Parse the search results to find files with references
		const fileMatches = searchResults.split("\n\n")

		console.log(`Found ${fileMatches.length} potential file matches`)

		for (const fileMatch of fileMatches) {
			// Skip empty results and the source file (already processed)
			if (!fileMatch || !fileMatch.trim() || fileMatch.includes(sourceFilePath)) {
				continue
			}

			// Extract file path from results (first line starts with #)
			const lines = fileMatch.split("\n")
			const fileLine = lines.find((line) => line.startsWith("# "))

			if (!fileLine) continue

			const relFilePath = fileLine.substring(2).trim()
			const fullFilePath = path.join(workspaceRoot, relFilePath)

			try {
				// Make sure file exists
				try {
					await fs.access(fullFilePath)
				} catch {
					continue
				}

				// Read the file
				const fileContent = await fs.readFile(fullFilePath, "utf-8")

				// Parse the file
				const ast = jscodeshift.withParser(parser)(fileContent)

				// Track removed imports
				const importsRemoved: string[] = []
				let modified = false

				// Clean up import declarations
				ast.find(jscodeshift.ImportDeclaration).forEach((path: any) => {
					const node = path.node
					const specifiers = node.specifiers

					if (!specifiers || specifiers.length === 0) return

					// Check if this import includes our symbol
					const hasSymbol = specifiers.some(
						(spec: any) =>
							(spec.imported && spec.imported.name === symbolName) ||
							(spec.local && spec.local.name === symbolName),
					)

					if (hasSymbol) {
						// If there's only one specifier and it's our symbol, remove the entire import
						if (specifiers.length === 1) {
							path.prune()
							if (node.source && typeof node.source.value === "string") {
								importsRemoved.push(node.source.value)
							}
							modified = true
						} else {
							// Otherwise, filter out just our symbol
							const newSpecifiers = specifiers.filter(
								(spec: any) =>
									!(spec.imported && spec.imported.name === symbolName) &&
									!(spec.local && spec.local.name === symbolName),
							)

							if (newSpecifiers.length !== specifiers.length) {
								node.specifiers = newSpecifiers
								modified = true
							}
						}
					}
				})

				// Clean up class instantiations
				ast.find(jscodeshift.NewExpression).forEach((path: any) => {
					const node = path.node
					// Check if this is instantiating our class
					if (node.callee && node.callee.type === "Identifier" && node.callee.name === symbolName) {
						// Remove the entire statement containing this instantiation
						let statement = path.parent
						while (statement && !jscodeshift.Statement.check(statement.node)) {
							statement = statement.parent
						}
						if (statement) {
							statement.prune()
							modified = true
						}
					}
				})

				// Clean up member expressions (method calls and property access)
				ast.find(jscodeshift.MemberExpression).forEach((path: any) => {
					const node = path.node
					// Check if the property name matches our symbol
					if (node.property && node.property.type === "Identifier" && node.property.name === symbolName) {
						// Remove the entire statement containing this member expression
						let parentStatement = path.parent
						while (parentStatement && !jscodeshift.Statement.check(parentStatement.node)) {
							parentStatement = parentStatement.parent
						}
						if (parentStatement) {
							parentStatement.prune()
							modified = true
						}
					}
				})

				if (modified) {
					// Generate modified code
					const modifiedCode = ast.toSource({ quote: "single" })

					// Write modified code back to the file
					await fs.writeFile(fullFilePath, modifiedCode, "utf-8")

					// Add to changes
					fileChanges.push({
						filePath: fullFilePath,
						modifiedCode,
						importsRemoved,
					})
				}
			} catch (error) {
				console.error(`Error processing file ${fullFilePath}:`, error)
			}
		}

		return fileChanges
	}
}

/**
 * Execute a remove operation
 *
 * @param operation Validated remove operation
 * @param selector Code selector identifying what to remove
 * @returns Result of the operation
 *
 * REQUIRED USAGE:
 * - Use identifier selectors (type: 'identifier') for all remove operations
 * - Provide the symbol name and file path for precise selection
 * - Location-based selectors are not supported
 */
export async function executeRemoveOperation(
	operation: RemoveOperation,
	selector: CodeSelector,
): Promise<RemoveResult> {
	const handler = new RemoveHandler()
	return handler.execute(operation, selector)
}
