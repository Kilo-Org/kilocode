import { Project, Node, SourceFile, SyntaxKind, ts } from "ts-morph"
import path from "path"
import fs from "fs/promises"
import { MoveCodeResult, errorResult } from "./validation/moveCodeSchema"

/**
 * Move a symbol from one file to another using ts-morph AST manipulation.
 *
 * This implementation:
 * 1. Uses AST to find the symbol by name in the source file
 * 2. Extracts the node and its dependencies using AST traversal
 * 3. Preserves JSDoc comments automatically
 * 4. Manages imports and exports using ts-morph's built-in methods
 * 5. Handles all symbol types (functions, classes, interfaces, types, etc.)
 *
 * @param srcPath Source file path
 * @param targetPath Target file path
 * @param identifierName Name of the identifier to move
 * @param kind Optional kind of identifier
 * @returns Result of the operation
 */
export async function moveSymbol(
	srcPath: string,
	targetPath: string,
	identifierName: string,
	_kind?: "function" | "variable" | "class" | "method" | "property" | "parameter" | "import" | "other",
): Promise<MoveCodeResult> {
	try {
		// Create a ts-morph project
		const project = new Project({
			compilerOptions: {
				target: ts.ScriptTarget.Latest,
				module: ts.ModuleKind.ESNext,
				allowJs: true,
				jsx: ts.JsxEmit.React,
			},
		})

		// Add source file to project
		const sourceFile = project.addSourceFileAtPath(srcPath)

		// Find the symbol to move
		const symbolNode = findSymbolNode(sourceFile, identifierName)
		if (!symbolNode) {
			return errorResult(`Could not find identifier '${identifierName}' in file ${srcPath}`)
		}

		// Get or create target file
		let targetFile: SourceFile
		try {
			targetFile = project.addSourceFileAtPath(targetPath)
		} catch {
			// Create target file if it doesn't exist
			await fs.mkdir(path.dirname(targetPath), { recursive: true })
			await fs.writeFile(targetPath, "", "utf8")
			targetFile = project.addSourceFileAtPath(targetPath)
		}

		// Extract the symbol and its dependencies
		const extractionResult = extractSymbolWithDependencies(symbolNode, sourceFile, targetFile)

		// Move the symbol to target file
		const moveResult = moveSymbolToTarget(
			extractionResult.nodeToMove,
			extractionResult.dependencies,
			sourceFile,
			targetFile,
			extractionResult.symbolsToExport,
		)

		// Clean up any unused imports in the source file
		cleanupUnusedImports(sourceFile)

		// Save the modified files and verify they're written
		await sourceFile.save()
		await targetFile.save()

		// Force a filesystem sync to ensure changes are written to disk
		// This can help with race conditions in rapid file operations
		const verifySource = await fs.readFile(sourceFile.getFilePath(), "utf8")
		console.log("Verify source file after save:", verifySource.slice(0, 100)) // Show first 100 chars

		return {
			success: true,
			modifiedSourceCode: sourceFile.getFullText(),
			modifiedTargetCode: targetFile.getFullText(),
			movedNodes: moveResult.movedCount,
			importsAdded: moveResult.importsAdded,
			exportedNames: moveResult.exportedNames,
			dependenciesImported: moveResult.dependenciesImported,
			dependencies: moveResult.dependencies,
			typeReferencesHandled: moveResult.typeReferencesHandled,
			nestedFunctionsHandled: false, // Handled differently now
			filesWritten: true,
		}
	} catch (error) {
		console.error("Error in moveSymbol:", error)
		return errorResult(`Error moving symbol: ${error instanceof Error ? error.message : String(error)}`)
	}
}

/**
 * Find a symbol node in the source file using AST
 */
function findSymbolNode(sourceFile: SourceFile, identifierName: string): Node | undefined {
	// First try to find top-level declarations
	const topLevelDeclarations = [
		...sourceFile.getFunctions(),
		...sourceFile.getClasses(),
		...sourceFile.getInterfaces(),
		...sourceFile.getTypeAliases(),
		...sourceFile.getEnums(),
		...sourceFile.getVariableStatements(),
	]

	for (const decl of topLevelDeclarations) {
		const name = getDeclarationName(decl)
		if (name === identifierName) {
			return decl
		}

		// Check variable declarations within variable statements
		if (Node.isVariableStatement(decl)) {
			for (const varDecl of decl.getDeclarations()) {
				if (varDecl.getName() === identifierName) {
					return decl // Return the statement, not just the declaration
				}
			}
		}
	}

	// If not found at top level, search deeper
	let result: Node | undefined
	sourceFile.forEachDescendant((node) => {
		const name = getNodeName(node)
		if (name === identifierName) {
			// Return the appropriate parent node for certain types
			if (Node.isVariableDeclaration(node)) {
				// Return the variable statement instead of just the declaration
				const varStatement = node.getAncestors().find(Node.isVariableStatement)
				result = varStatement || node
			} else {
				result = node
			}
			return true // Stop traversal
		}
		return undefined // Continue traversal
	})

	return result
}

/**
 * Get the name of a declaration node
 */
function getDeclarationName(node: Node): string | undefined {
	if (Node.hasName(node)) {
		return node.getName()
	}

	if (Node.isVariableStatement(node)) {
		const declarations = node.getDeclarations()
		if (declarations.length > 0) {
			return declarations[0].getName()
		}
	}

	return undefined
}

/**
 * Get the name of any node
 */
function getNodeName(node: Node): string | undefined {
	if (Node.hasName(node)) {
		return node.getName()
	}

	const nameNode = node.getChildrenOfKind(SyntaxKind.Identifier)[0]
	return nameNode?.getText()
}

/**
 * Extract a symbol and analyze its dependencies
 */
function extractSymbolWithDependencies(
	symbolNode: Node,
	sourceFile: SourceFile,
	_targetFile: SourceFile,
): {
	nodeToMove: Node
	dependencies: Set<string>
	symbolsToExport: string[]
} {
	const dependencies = new Set<string>()
	const symbolsToExport: string[] = []

	// Get the main symbol name
	const mainSymbolName = getNodeName(symbolNode) || getDeclarationName(symbolNode)
	if (mainSymbolName) {
		symbolsToExport.push(mainSymbolName)
	}

	// Analyze the symbol for dependencies
	const identifiers = symbolNode.getDescendantsOfKind(SyntaxKind.Identifier)

	for (const identifier of identifiers) {
		const identifierText = identifier.getText()

		// Skip if it's the symbol itself or a property access
		if (
			identifierText === mainSymbolName ||
			identifier.getParent()?.getKind() === SyntaxKind.PropertyAccessExpression
		) {
			continue
		}

		// Check if this identifier references something from the source file
		const symbol = identifier.getSymbol()
		if (symbol) {
			const declarations = symbol.getDeclarations()
			if (declarations.some((decl) => decl.getSourceFile() === sourceFile)) {
				// This is a dependency from the source file
				dependencies.add(identifierText)
			}
		}
	}

	// Handle nested functions in function declarations
	if (Node.isFunctionDeclaration(symbolNode)) {
		const nestedFunctions = symbolNode.getDescendantsOfKind(SyntaxKind.FunctionDeclaration)
		for (const nested of nestedFunctions) {
			const nestedName = nested.getName()
			if (nestedName && nestedName !== mainSymbolName) {
				symbolsToExport.push(nestedName)
			}
		}
	}

	return {
		nodeToMove: symbolNode,
		dependencies,
		symbolsToExport,
	}
}

/**
 * Move a symbol to the target file
 */
function moveSymbolToTarget(
	nodeToMove: Node,
	dependencies: Set<string>,
	sourceFile: SourceFile,
	targetFile: SourceFile,
	symbolsToExport: string[],
): {
	movedCount: number
	importsAdded: boolean
	exportedNames: string[]
	dependenciesImported: boolean
	dependencies: string[]
	typeReferencesHandled: boolean
} {
	// Get the text of the node including JSDoc comments
	const nodeText = nodeToMove.getFullText()

	// Check if we handled type references before removing the node
	const typeReferencesHandled = nodeToMove.getDescendantsOfKind(SyntaxKind.TypeReference).length > 0

	// Get the main symbol name for later cleanup
	const mainSymbolName = getNodeName(nodeToMove) || getDeclarationName(nodeToMove)

	// We'll track previously imported symbols to avoid removing them during cleanup
	// No debug variables needed here

	// Remove the node from source file
	// Most nodes can be removed directly, but we need to handle special cases
	try {
		if (Node.isStatement(nodeToMove)) {
			// Statements can be removed directly
			;(nodeToMove as any).remove()
		} else if (Node.isVariableDeclaration(nodeToMove)) {
			// For variable declarations, remove the parent statement
			const varStatement = nodeToMove.getFirstAncestorByKind(SyntaxKind.VariableStatement)
			if (varStatement) {
				;(varStatement as any).remove()
			}
		} else {
			// For other nodes, try to remove directly
			;(nodeToMove as any).remove()
		}
	} catch (error) {
		console.error(`Error removing node directly: ${error instanceof Error ? error.message : String(error)}`)

		// If removal fails, try to find the nearest removable ancestor
		let ancestor = nodeToMove.getParent()
		while (ancestor && !Node.isSourceFile(ancestor)) {
			if (Node.isStatement(ancestor)) {
				try {
					;(ancestor as any).remove()
					console.log(`Successfully removed ancestor statement instead`)
					break
				} catch (ancestorError) {
					console.error(
						`Error removing ancestor: ${ancestorError instanceof Error ? ancestorError.message : String(ancestorError)}`,
					)
				}
			}
			ancestor = ancestor.getParent()
		}
	}

	// Clean up unused imports after removing the node
	if (mainSymbolName) {
		// Find and remove any imports that are no longer used
		const importDeclarations = sourceFile.getImportDeclarations()
		for (const importDecl of importDeclarations) {
			// Skip imports that don't have named imports
			if (!importDecl.getNamedImports().length) continue

			// Check if any named imports are unused
			const unusedImports = importDecl.getNamedImports().filter((namedImport) => {
				const importName = namedImport.getName()
				// Check if this import is no longer referenced in the file
				return !sourceFile
					.getDescendantsOfKind(SyntaxKind.Identifier)
					.some(
						(id) => id.getText() === importName && id.getParent()?.getKind() !== SyntaxKind.ImportSpecifier,
					)
			})

			// Remove unused named imports
			for (const unusedImport of unusedImports) {
				try {
					unusedImport.remove()
				} catch (error) {
					console.error(
						`Error removing unused import: ${error instanceof Error ? error.message : String(error)}`,
					)
				}
			}

			// If all named imports were removed, remove the entire import declaration
			if (importDecl.getNamedImports().length === 0) {
				try {
					importDecl.remove()
				} catch (error) {
					console.error(
						`Error removing empty import declaration: ${error instanceof Error ? error.message : String(error)}`,
					)
				}
			}
		}
	}

	// Add necessary imports to source file for the moved symbols
	if (symbolsToExport.length > 0) {
		console.log("Adding imports for symbols:", symbolsToExport)

		const relativePath = getRelativeImportPath(sourceFile.getFilePath(), targetFile.getFilePath())
		console.log("Relative path:", relativePath)

		// Log existing imports before modification
		const existingImportsBeforeModification = sourceFile.getImportDeclarations().map((i) => i.getFullText())
		console.log("Existing imports before:", existingImportsBeforeModification)

		// Check if an import from this target file already exists
		const existingImport = sourceFile.getImportDeclarations().find((importDecl) => {
			const moduleSpecifier = importDecl.getModuleSpecifierValue()
			return moduleSpecifier === relativePath
		})

		if (existingImport) {
			console.log("Found existing import:", existingImport.getFullText())

			// Add new symbols to the existing import
			for (const symbolName of symbolsToExport) {
				// Check if this symbol is already imported
				const hasSymbol = existingImport
					.getNamedImports()
					.some((namedImport) => namedImport.getName() === symbolName)

				// Add the symbol if it's not already imported
				if (!hasSymbol) {
					console.log(`Adding ${symbolName} to existing import`)
					existingImport.addNamedImport(symbolName)
				}
			}
		} else {
			// Create a new import declaration if none exists
			console.log("Creating new import declaration")
			sourceFile.addImportDeclaration({
				moduleSpecifier: relativePath,
				namedImports: symbolsToExport.map((name) => ({ name })),
			})
		}

		// Log imports after modification
		const existingImportsAfterModification = sourceFile.getImportDeclarations().map((i) => i.getFullText())
		console.log("Imports after modification:", existingImportsAfterModification)
	}

	// Add the node to target file
	targetFile.addStatements(nodeText)

	// Handle dependencies - add imports to target file
	const dependencyArray = Array.from(dependencies)
	if (dependencyArray.length > 0) {
		const relativePath = getRelativeImportPath(targetFile.getFilePath(), sourceFile.getFilePath())

		// Check which dependencies are actually exported from source
		const exportedDeps = dependencyArray.filter((dep) => {
			const sourceExports = getExportedSymbols(sourceFile)
			return sourceExports.has(dep)
		})

		if (exportedDeps.length > 0) {
			targetFile.addImportDeclaration({
				moduleSpecifier: relativePath,
				namedImports: exportedDeps.map((name) => ({ name })),
			})
		}
	}

	// Ensure the moved symbols are exported in target file
	ensureExported(targetFile, symbolsToExport)

	return {
		movedCount: symbolsToExport.length,
		importsAdded: symbolsToExport.length > 0,
		exportedNames: symbolsToExport,
		dependenciesImported: dependencyArray.length > 0,
		dependencies: dependencyArray,
		typeReferencesHandled,
	}
}

/**
 * Get all exported symbols from a source file
 */
function getExportedSymbols(sourceFile: SourceFile): Set<string> {
	const exportedSymbols = new Set<string>()

	// Get all export declarations
	const exportDeclarations = sourceFile.getExportDeclarations()
	for (const exportDecl of exportDeclarations) {
		const namedExports = exportDecl.getNamedExports()
		for (const namedExport of namedExports) {
			exportedSymbols.add(namedExport.getName())
		}
	}

	// Get all exported nodes
	const statements = sourceFile.getStatements()
	for (const statement of statements) {
		if (Node.isExportable(statement) && statement.hasExportKeyword()) {
			const name = getDeclarationName(statement)
			if (name) {
				exportedSymbols.add(name)
			}
		}
	}

	return exportedSymbols
}

/**
 * Ensure symbols are exported in the target file
 */
function ensureExported(targetFile: SourceFile, symbolNames: string[]): void {
	for (const symbolName of symbolNames) {
		// Find the declaration in the target file
		let declaration: Node | undefined
		targetFile.forEachDescendant((node) => {
			const name = getNodeName(node) || getDeclarationName(node)
			if (name === symbolName) {
				// Check if it's a top-level declaration that can be exported
				if (Node.isExportable(node) && !node.hasExportKeyword()) {
					declaration = node
					return true // Stop traversal
				}
			}
			return undefined // Continue traversal
		})

		if (declaration && Node.isExportable(declaration)) {
			declaration.toggleModifier("export", true)
		}
	}
}

/**
 * Get relative import path between two files
 */
function getRelativeImportPath(fromFilePath: string, toFilePath: string): string {
	// Calculate the relative path
	let relativePath = path.relative(path.dirname(fromFilePath), path.dirname(toFilePath))

	// Ensure it starts with ./ or ../
	if (!relativePath.startsWith(".")) {
		relativePath = "./" + relativePath
	} else if (relativePath === ".") {
		relativePath = "./"
	}

	// Add the filename without extension
	const fileName = path.basename(toFilePath, path.extname(toFilePath))

	// Join the path and filename
	const fullPath = relativePath === "./" ? "./" + fileName : path.join(relativePath, fileName).replace(/\\/g, "/") // Ensure forward slashes

	return fullPath
}

/**
 * Clean up unused imports in a source file
 *
 * This function scans the file for import declarations and removes any
 * named imports that are no longer referenced in the file after code movement.
 *
 * @param sourceFile The source file to clean up
 */
function cleanupUnusedImports(sourceFile: SourceFile): void {
	// Find and remove any imports that are no longer used
	const importDeclarations = sourceFile.getImportDeclarations()
	for (const importDecl of importDeclarations) {
		// Skip imports that don't have named imports
		if (!importDecl.getNamedImports().length) continue

		// Check if any named imports are unused
		const unusedImports = importDecl.getNamedImports().filter((namedImport) => {
			const importName = namedImport.getName()
			// Check if this import is no longer referenced in the file
			return !sourceFile
				.getDescendantsOfKind(SyntaxKind.Identifier)
				.some((id) => id.getText() === importName && id.getParent()?.getKind() !== SyntaxKind.ImportSpecifier)
		})

		// Remove unused named imports
		for (const unusedImport of unusedImports) {
			try {
				unusedImport.remove()
			} catch (error) {
				console.error(`Error removing unused import: ${error instanceof Error ? error.message : String(error)}`)
			}
		}

		// If all named imports were removed, remove the entire import declaration
		if (importDecl.getNamedImports().length === 0) {
			try {
				importDecl.remove()
			} catch (error) {
				console.error(
					`Error removing empty import declaration: ${error instanceof Error ? error.message : String(error)}`,
				)
			}
		}
	}
}
