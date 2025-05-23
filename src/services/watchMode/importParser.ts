import * as vscode from "vscode"
import * as path from "path"

/**
 * Parses import statements from a file to find referenced files
 */
export async function parseImports(fileUri: vscode.Uri, content: string): Promise<vscode.Uri[]> {
	const importedFiles: vscode.Uri[] = []

	// Regular expressions to match different import patterns
	const importPatterns = [
		// ES6 imports: import { something } from './file'
		/import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)(?:\s*,\s*)?)*\s*from\s*['"]([^'"]+)['"]/g,
		// CommonJS requires: const something = require('./file')
		/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
		// Dynamic imports: import('./file')
		/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
	]

	const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri)
	if (!workspaceFolder) {
		return importedFiles
	}

	for (const pattern of importPatterns) {
		let match
		while ((match = pattern.exec(content)) !== null) {
			const importPath = match[1]

			// Skip node_modules and external packages
			if (!importPath.startsWith(".") && !importPath.startsWith("/")) {
				continue
			}

			// Resolve the import path relative to the current file
			const currentDir = path.dirname(fileUri.fsPath)
			let resolvedPath = path.resolve(currentDir, importPath)

			// Try different file extensions if no extension provided
			const extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"]
			let fileExists = false

			try {
				// First try the exact path
				await vscode.workspace.fs.stat(vscode.Uri.file(resolvedPath))
				fileExists = true
			} catch {
				// If exact path doesn't exist, try with extensions
				fileExists = false
			}

			// If no exact match, try with extensions
			if (!fileExists) {
				for (const ext of extensions) {
					try {
						const pathWithExt = resolvedPath + ext
						await vscode.workspace.fs.stat(vscode.Uri.file(pathWithExt))
						resolvedPath = pathWithExt
						fileExists = true
						break
					} catch {
						// Continue trying other extensions
					}
				}

				// Also try index files
				if (!fileExists) {
					for (const indexFile of ["index.ts", "index.tsx", "index.js", "index.jsx"]) {
						try {
							const indexPath = path.join(resolvedPath, indexFile)
							await vscode.workspace.fs.stat(vscode.Uri.file(indexPath))
							resolvedPath = indexPath
							fileExists = true
							break
						} catch {
							// Continue trying other index files
						}
					}
				}
			}

			if (fileExists) {
				importedFiles.push(vscode.Uri.file(resolvedPath))
			}
		}
	}

	return importedFiles
}

/**
 * Gets all files that should be included in the context for a given file
 * This includes imported files and their transitive imports up to a certain depth
 */
export async function getContextFiles(
	fileUri: vscode.Uri,
	content: string,
	maxDepth: number = 2,
	visited: Set<string> = new Set(),
): Promise<vscode.Uri[]> {
	const contextFiles: vscode.Uri[] = []
	const fileKey = fileUri.toString()

	// Avoid circular dependencies
	if (visited.has(fileKey)) {
		return contextFiles
	}
	visited.add(fileKey)

	// Parse direct imports
	const imports = await parseImports(fileUri, content)

	for (const importUri of imports) {
		contextFiles.push(importUri)

		// Recursively get imports from imported files (up to maxDepth)
		if (maxDepth > 1) {
			try {
				const importDoc = await vscode.workspace.openTextDocument(importUri)
				const importContent = importDoc.getText()
				const transitiveImports = await getContextFiles(importUri, importContent, maxDepth - 1, visited)
				contextFiles.push(...transitiveImports)
			} catch (error) {
				// Skip files that can't be read
				console.error(`Failed to read imported file ${importUri.fsPath}:`, error)
			}
		}
	}

	// Remove duplicates
	const uniqueFiles = Array.from(new Set(contextFiles.map((uri) => uri.toString()))).map((uriStr) =>
		vscode.Uri.parse(uriStr),
	)

	return uniqueFiles
}
