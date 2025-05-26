import * as fs from "fs/promises"
import * as path from "path"
import * as jscodeshift from "jscodeshift"
import * as vscode from "vscode"
import { RenameSymbolOperation, RenameSymbolResult } from "./refactorModels"
import { fileExistsAtPath } from "../../utils/fs"
import { regexSearchFiles } from "../../services/ripgrep"

/**
 * Rename a symbol in a file or across multiple files using jscodeshift
 *
 * @param operation Details of the rename operation to perform
 */
export async function renameSymbol(operation: RenameSymbolOperation): Promise<RenameSymbolResult> {
	try {
		const { filePath, newName, startLine, oldName, acrossFiles = false } = operation

		// Ensure file exists
		const fileExists = await fileExistsAtPath(filePath)
		if (!fileExists) {
			return {
				success: false,
				error: `File does not exist at path: ${filePath}`,
			}
		}

		// Read file content
		const fileContent = await fs.readFile(filePath, "utf-8")

		// Determine if we're dealing with TypeScript
		const isTypeScript = [".ts", ".tsx"].includes(path.extname(filePath).toLowerCase())
		const parser = isTypeScript ? "tsx" : "babel"

		// Parse the file
		const ast = jscodeshift.withParser(parser)(fileContent)

		let symbolName = oldName
		let affectedReferences = 0

		// If startLine is provided, find the symbol at that line first
		if (startLine && !oldName) {
			symbolName = findSymbolAtLine(ast, startLine)
			if (!symbolName) {
				return {
					success: false,
					error: `Could not find a renameable symbol at line ${startLine}`,
				}
			}
		}

		if (!symbolName) {
			return {
				success: false,
				error: "Either oldName or startLine must be provided",
			}
		}

		// Rename in the current file
		renameByName(ast, symbolName, newName)

		// Generate the modified code
		const modifiedCode = ast.toSource({ quote: "single" })

		// Write the modified code back to the file
		await fs.writeFile(filePath, modifiedCode, "utf-8")

		const modifiedFiles = [filePath]
		const modifiedCodeMap = { [filePath]: modifiedCode }

		// Handle cross-file renaming if enabled
		if (acrossFiles && symbolName) {
			const additionalChanges = await renameAcrossFiles(filePath, symbolName, newName, parser)

			if (additionalChanges.length > 0) {
				for (const change of additionalChanges) {
					modifiedFiles.push(change.filePath)
					modifiedCodeMap[change.filePath] = change.modifiedCode
					affectedReferences += change.references
				}
			}
		}

		return {
			success: true,
			modifiedFiles,
			modifiedCode: modifiedCodeMap,
			affectedReferences,
		}
	} catch (error) {
		return {
			success: false,
			error: `Error renaming symbol: ${error instanceof Error ? error.message : String(error)}`,
		}
	}
}

/**
 * Finds the name of a symbol at a specific line
 */
function findSymbolAtLine(ast: any, lineNumber: number): string | undefined {
	let symbolName: string | undefined

	// Find all identifiers in the file
	ast.find(jscodeshift.Identifier).forEach((path: any) => {
		const node = path.node

		// Check if the node has location information and is on the target line
		if (node.loc && node.loc.start.line === lineNumber) {
			symbolName = node.name
		}
	})

	return symbolName
}

/**
 * Rename symbol by name throughout the file
 */
function renameByName(ast: any, oldName: string, newName: string): boolean {
	let symbolFound = false

	// Find all occurrences of the symbol as identifiers
	ast.find(jscodeshift.Identifier, { name: oldName }).forEach((path: any) => {
		// Update the name
		path.node.name = newName
		symbolFound = true
	})

	// Enhanced string literal renaming
	// Find all string literals that might contain the symbol name
	ast.find(jscodeshift.StringLiteral).forEach((path: any) => {
		const node = path.node
		const originalValue = node.value
		let modified = false

		// Case 1: Exact match - the string literal is exactly the symbol name
		if (node.value === oldName) {
			node.value = newName
			modified = true
		}

		// Case 2: Symbol appears with quotes inside the string
		// Example: "Class 'UserProfile' not found"
		if (node.value.includes(`'${oldName}'`) || node.value.includes(`"${oldName}"`)) {
			node.value = node.value
				.replace(new RegExp(`'${oldName}'`, "g"), `'${newName}'`)
				.replace(new RegExp(`"${oldName}"`, "g"), `"${newName}"`)
			modified = true
		}

		// Case 3: Symbol appears as part of a property access or method call
		// Example: "user.profile" or "profile.getData()"
		if (node.value.includes(`.${oldName}`) || node.value.includes(`${oldName}.`)) {
			node.value = node.value
				.replace(new RegExp(`\\.${oldName}\\b`, "g"), `.${newName}`)
				.replace(new RegExp(`\\b${oldName}\\.`, "g"), `${newName}.`)
			modified = true
		}

		// Case 4: Symbol appears as a standalone word with word boundaries
		// This helps catch cases like "Loading UserProfile data" but avoids
		// partial matches like "UserProfileData" -> "UserNewNameData"
		const wordBoundaryRegex = new RegExp(`\\b${oldName}\\b`, "g")
		if (wordBoundaryRegex.test(node.value)) {
			node.value = node.value.replace(wordBoundaryRegex, newName)
			modified = true
		}

		// Case 5: Symbol appears in a camelCase or PascalCase context
		// Example: "userProfile" -> "userNewName" or "UserProfile" -> "UserNewName"
		// Only apply if the oldName is at least 3 characters to avoid false positives
		if (oldName.length >= 3) {
			// Match symbol at the start of a camelCase identifier
			const camelCaseStartRegex = new RegExp(`\\b${oldName}([A-Z][a-zA-Z0-9]*)\\b`, "g")
			if (camelCaseStartRegex.test(node.value)) {
				node.value = node.value.replace(camelCaseStartRegex, `${newName}$1`)
				modified = true
			}

			// Match symbol at the end of a camelCase identifier
			const camelCaseEndRegex = new RegExp(`\\b([a-z][a-zA-Z0-9]*)${oldName}\\b`, "g")
			if (camelCaseEndRegex.test(node.value)) {
				node.value = node.value.replace(camelCaseEndRegex, `$1${newName}`)
				modified = true
			}
		}

		// Case 6: Symbol appears in kebab-case or snake_case
		// Example: "user-profile" -> "user-new-name" or "user_profile" -> "user_new_name"
		if (oldName.length >= 3) {
			const kebabCaseRegex = new RegExp(`\\b([a-zA-Z0-9]+[-_])${oldName}\\b`, "g")
			if (kebabCaseRegex.test(node.value)) {
				node.value = node.value.replace(kebabCaseRegex, `$1${newName}`)
				modified = true
			}

			const kebabCaseEndRegex = new RegExp(`\\b${oldName}([-_][a-zA-Z0-9]+)\\b`, "g")
			if (kebabCaseEndRegex.test(node.value)) {
				node.value = node.value.replace(kebabCaseEndRegex, `${newName}$1`)
				modified = true
			}
		}

		// Update symbolFound flag if we made any changes
		if (modified && node.value !== originalValue) {
			symbolFound = true
		}
	})

	// Enhanced template literal handling
	ast.find(jscodeshift.TemplateLiteral).forEach((path: any) => {
		const node = path.node

		// Check quasis (string parts) of template literals
		if (node.quasis && node.quasis.length > 0) {
			node.quasis.forEach((quasi: any) => {
				if (quasi.value && quasi.value.raw) {
					const originalRaw = quasi.value.raw
					let modified = false

					// Apply the same comprehensive set of replacements as for string literals

					// Case 1: Exact match
					if (originalRaw === oldName) {
						quasi.value.raw = newName
						modified = true
					}

					// Case 2: Symbol with quotes
					if (originalRaw.includes(`'${oldName}'`) || originalRaw.includes(`"${oldName}"`)) {
						quasi.value.raw = originalRaw
							.replace(new RegExp(`'${oldName}'`, "g"), `'${newName}'`)
							.replace(new RegExp(`"${oldName}"`, "g"), `"${newName}"`)
						modified = true
					}

					// Case 3: Property access
					if (originalRaw.includes(`.${oldName}`) || originalRaw.includes(`${oldName}.`)) {
						quasi.value.raw = originalRaw
							.replace(new RegExp(`\\.${oldName}\\b`, "g"), `.${newName}`)
							.replace(new RegExp(`\\b${oldName}\\.`, "g"), `${newName}.`)
						modified = true
					}

					// Case 4: Word boundaries
					const wordBoundaryRegex = new RegExp(`\\b${oldName}\\b`, "g")
					if (wordBoundaryRegex.test(originalRaw)) {
						quasi.value.raw = originalRaw.replace(wordBoundaryRegex, newName)
						modified = true
					}

					// Case 5: camelCase/PascalCase
					if (oldName.length >= 3) {
						const camelCaseStartRegex = new RegExp(`\\b${oldName}([A-Z][a-zA-Z0-9]*)\\b`, "g")
						if (camelCaseStartRegex.test(originalRaw)) {
							quasi.value.raw = originalRaw.replace(camelCaseStartRegex, `${newName}$1`)
							modified = true
						}

						const camelCaseEndRegex = new RegExp(`\\b([a-z][a-zA-Z0-9]*)${oldName}\\b`, "g")
						if (camelCaseEndRegex.test(originalRaw)) {
							quasi.value.raw = originalRaw.replace(camelCaseEndRegex, `$1${newName}`)
							modified = true
						}
					}

					// Case 6: kebab-case/snake_case
					if (oldName.length >= 3) {
						const kebabCaseRegex = new RegExp(`\\b([a-zA-Z0-9]+[-_])${oldName}\\b`, "g")
						if (kebabCaseRegex.test(originalRaw)) {
							quasi.value.raw = originalRaw.replace(kebabCaseRegex, `$1${newName}`)
							modified = true
						}

						const kebabCaseEndRegex = new RegExp(`\\b${oldName}([-_][a-zA-Z0-9]+)\\b`, "g")
						if (kebabCaseEndRegex.test(originalRaw)) {
							quasi.value.raw = originalRaw.replace(kebabCaseEndRegex, `${newName}$1`)
							modified = true
						}
					}

					// Update cooked value and symbolFound flag if modified
					if (modified && quasi.value.raw !== originalRaw) {
						quasi.value.cooked = quasi.value.raw
						symbolFound = true
					}
				}
			})
		}
	})

	return symbolFound
}

/**
 * Interface for storing file changes
 */
interface FileChange {
	filePath: string
	modifiedCode: string
	references: number
}

/**
 * Renames symbols across multiple files using ripgrep to find occurrences
 *
 * @param sourceFilePath Path to the source file with the original rename
 * @param oldName Original symbol name
 * @param newName New symbol name
 * @param parser Parser to use (tsx or babel)
 * @returns Array of file changes
 */
async function renameAcrossFiles(
	sourceFilePath: string,
	oldName: string,
	newName: string,
	parser: string,
): Promise<FileChange[]> {
	const fileChanges: FileChange[] = []
	const sourceDir = path.dirname(sourceFilePath)
	const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || sourceDir

	// Use ripgrep to find all occurrences of the symbol
	// Create a pattern to match:
	// 1. The symbol as an identifier with word boundaries
	// 2. Import statements with the symbol name
	// 3. Export statements with the symbol name
	const patterns = [
		// Basic identifier with word boundaries
		`\\b${oldName}\\b`,
		// Import statements
		`import[^;]*\\{[^;]*\\b${oldName}\\b[^;]*\\}`,
		`import[^;]*\\b${oldName}\\b`,
		// Export statements
		`export[^;]*\\{[^;]*\\b${oldName}\\b[^;]*\\}`,
		// Class extension or implementation
		`(class|interface)[^{]*extends[^{]*\\b${oldName}\\b`,
		`(class|interface)[^{]*implements[^{]*\\b${oldName}\\b`,
		// Method calls and property access
		`\\.[^(]*\\b${oldName}\\b`,
		`\\b${oldName}\\(\\)`,
		`\\.${oldName}\\(\\)`,
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
		if (error instanceof Error && error.message.includes("ripgrep binary")) {
			console.error("ripgrep is not installed or not found in the expected location.")
			console.error("Cross-file renaming requires ripgrep to be available.")
		}
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
			const fileExists = await fileExistsAtPath(fullFilePath)
			if (!fileExists) continue

			// Read the file
			const fileContent = await fs.readFile(fullFilePath, "utf-8")

			// Parse the file
			const ast = jscodeshift.withParser(parser)(fileContent)

			// Rename all occurrences
			let refsInFile = 0

			// Handle standard identifiers
			ast.find(jscodeshift.Identifier, { name: oldName }).forEach((path: any) => {
				path.node.name = newName
				refsInFile++
			})

			// Handle method calls and property accesses
			ast.find(jscodeshift.MemberExpression).forEach((path: any) => {
				const node = path.node
				// Check if the property name matches the old name
				if (node.property && node.property.type === "Identifier" && node.property.name === oldName) {
					node.property.name = newName
					refsInFile++
				}
			})

			// Handle string literals with enhanced renaming logic
			ast.find(jscodeshift.StringLiteral).forEach((path: any) => {
				const node = path.node
				const originalValue = node.value
				let modified = false

				// Case 1: Exact match - the string literal is exactly the symbol name
				if (node.value === oldName) {
					node.value = newName
					modified = true
				}

				// Case 2: Symbol appears with quotes inside the string
				// Example: "Class 'UserProfile' not found"
				if (node.value.includes(`'${oldName}'`) || node.value.includes(`"${oldName}"`)) {
					node.value = node.value
						.replace(new RegExp(`'${oldName}'`, "g"), `'${newName}'`)
						.replace(new RegExp(`"${oldName}"`, "g"), `"${newName}"`)
					modified = true
				}

				// Case 3: Symbol appears as part of a property access or method call
				// Example: "user.profile" or "profile.getData()"
				if (node.value.includes(`.${oldName}`) || node.value.includes(`${oldName}.`)) {
					node.value = node.value
						.replace(new RegExp(`\\.${oldName}\\b`, "g"), `.${newName}`)
						.replace(new RegExp(`\\b${oldName}\\.`, "g"), `${newName}.`)
					modified = true
				}

				// Case 4: Symbol appears as a standalone word with word boundaries
				// This helps catch cases like "Loading UserProfile data" but avoids
				// partial matches like "UserProfileData" -> "UserNewNameData"
				const wordBoundaryRegex = new RegExp(`\\b${oldName}\\b`, "g")
				if (wordBoundaryRegex.test(node.value)) {
					node.value = node.value.replace(wordBoundaryRegex, newName)
					modified = true
				}

				// Case 5: Symbol appears in a camelCase or PascalCase context
				// Example: "userProfile" -> "userNewName" or "UserProfile" -> "UserNewName"
				// Only apply if the oldName is at least 3 characters to avoid false positives
				if (oldName.length >= 3) {
					// Match symbol at the start of a camelCase identifier
					const camelCaseStartRegex = new RegExp(`\\b${oldName}([A-Z][a-zA-Z0-9]*)\\b`, "g")
					if (camelCaseStartRegex.test(node.value)) {
						node.value = node.value.replace(camelCaseStartRegex, `${newName}$1`)
						modified = true
					}

					// Match symbol at the end of a camelCase identifier
					const camelCaseEndRegex = new RegExp(`\\b([a-z][a-zA-Z0-9]*)${oldName}\\b`, "g")
					if (camelCaseEndRegex.test(node.value)) {
						node.value = node.value.replace(camelCaseEndRegex, `$1${newName}`)
						modified = true
					}
				}

				// Case 6: Symbol appears in kebab-case or snake_case
				// Example: "user-profile" -> "user-new-name" or "user_profile" -> "user_new_name"
				if (oldName.length >= 3) {
					const kebabCaseRegex = new RegExp(`\\b([a-zA-Z0-9]+[-_])${oldName}\\b`, "g")
					if (kebabCaseRegex.test(node.value)) {
						node.value = node.value.replace(kebabCaseRegex, `$1${newName}`)
						modified = true
					}

					const kebabCaseEndRegex = new RegExp(`\\b${oldName}([-_][a-zA-Z0-9]+)\\b`, "g")
					if (kebabCaseEndRegex.test(node.value)) {
						node.value = node.value.replace(kebabCaseEndRegex, `${newName}$1`)
						modified = true
					}
				}

				// Update refsInFile if we made any changes
				if (modified && node.value !== originalValue) {
					refsInFile++
				}
			})

			// Handle template literals with enhanced renaming logic
			ast.find(jscodeshift.TemplateLiteral).forEach((path: any) => {
				const node = path.node

				// Check quasis (string parts) of template literals
				if (node.quasis && node.quasis.length > 0) {
					node.quasis.forEach((quasi: any) => {
						if (quasi.value && quasi.value.raw) {
							const originalRaw = quasi.value.raw
							let modified = false

							// Apply the same comprehensive set of replacements as for string literals

							// Case 1: Exact match
							if (originalRaw === oldName) {
								quasi.value.raw = newName
								modified = true
							}

							// Case 2: Symbol with quotes
							if (originalRaw.includes(`'${oldName}'`) || originalRaw.includes(`"${oldName}"`)) {
								quasi.value.raw = originalRaw
									.replace(new RegExp(`'${oldName}'`, "g"), `'${newName}'`)
									.replace(new RegExp(`"${oldName}"`, "g"), `"${newName}"`)
								modified = true
							}

							// Case 3: Property access
							if (originalRaw.includes(`.${oldName}`) || originalRaw.includes(`${oldName}.`)) {
								quasi.value.raw = originalRaw
									.replace(new RegExp(`\\.${oldName}\\b`, "g"), `.${newName}`)
									.replace(new RegExp(`\\b${oldName}\\.`, "g"), `${newName}.`)
								modified = true
							}

							// Case 4: Word boundaries
							const wordBoundaryRegex = new RegExp(`\\b${oldName}\\b`, "g")
							if (wordBoundaryRegex.test(originalRaw)) {
								quasi.value.raw = originalRaw.replace(wordBoundaryRegex, newName)
								modified = true
							}

							// Case 5: camelCase/PascalCase
							if (oldName.length >= 3) {
								const camelCaseStartRegex = new RegExp(`\\b${oldName}([A-Z][a-zA-Z0-9]*)\\b`, "g")
								if (camelCaseStartRegex.test(originalRaw)) {
									quasi.value.raw = originalRaw.replace(camelCaseStartRegex, `${newName}$1`)
									modified = true
								}

								const camelCaseEndRegex = new RegExp(`\\b([a-z][a-zA-Z0-9]*)${oldName}\\b`, "g")
								if (camelCaseEndRegex.test(originalRaw)) {
									quasi.value.raw = originalRaw.replace(camelCaseEndRegex, `$1${newName}`)
									modified = true
								}
							}

							// Case 6: kebab-case/snake_case
							if (oldName.length >= 3) {
								const kebabCaseRegex = new RegExp(`\\b([a-zA-Z0-9]+[-_])${oldName}\\b`, "g")
								if (kebabCaseRegex.test(originalRaw)) {
									quasi.value.raw = originalRaw.replace(kebabCaseRegex, `$1${newName}`)
									modified = true
								}

								const kebabCaseEndRegex = new RegExp(`\\b${oldName}([-_][a-zA-Z0-9]+)\\b`, "g")
								if (kebabCaseEndRegex.test(originalRaw)) {
									quasi.value.raw = originalRaw.replace(kebabCaseEndRegex, `${newName}$1`)
									modified = true
								}
							}

							// Update cooked value and refsInFile if modified
							if (modified && quasi.value.raw !== originalRaw) {
								quasi.value.cooked = quasi.value.raw
								refsInFile++
							}
						}
					})
				}
			})

			// Handle import declarations
			ast.find(jscodeshift.ImportDeclaration).forEach((path: any) => {
				const node = path.node

				// Handle default imports: import OldName from '...'
				if (
					node.specifiers &&
					node.specifiers.length === 1 &&
					node.specifiers[0].type === "ImportDefaultSpecifier" &&
					node.specifiers[0].local.name === oldName
				) {
					node.specifiers[0].local.name = newName
					refsInFile++
				}

				// Handle named imports: import { OldName } from '...'
				if (node.specifiers) {
					node.specifiers.forEach((specifier: any) => {
						if (specifier.type === "ImportSpecifier") {
							// Handle both import { OldName } and import { OldName as AliasName }
							if (specifier.imported && specifier.imported.name === oldName) {
								specifier.imported.name = newName
								refsInFile++
							}

							// Handle local name
							if (specifier.local && specifier.local.name === oldName) {
								specifier.local.name = newName
								refsInFile++
							}
						}
					})
				}
			})

			// Handle export declarations
			ast.find(jscodeshift.ExportNamedDeclaration).forEach((path: any) => {
				const node = path.node

				// Handle: export { OldName }
				if (node.specifiers) {
					node.specifiers.forEach((specifier: any) => {
						if (specifier.exported && specifier.exported.name === oldName) {
							specifier.exported.name = newName
							refsInFile++
						}
						if (specifier.local && specifier.local.name === oldName) {
							specifier.local.name = newName
							refsInFile++
						}
					})
				}

				// Handle: export const OldName = ...
				if (node.declaration) {
					// Function or class declaration
					if (
						(node.declaration.type === "FunctionDeclaration" ||
							node.declaration.type === "ClassDeclaration") &&
						node.declaration.id &&
						node.declaration.id.name === oldName
					) {
						node.declaration.id.name = newName
						refsInFile++
					}

					// Variable declarations
					if (node.declaration.type === "VariableDeclaration" && node.declaration.declarations) {
						node.declaration.declarations.forEach((decl: any) => {
							if (decl.id && decl.id.type === "Identifier" && decl.id.name === oldName) {
								decl.id.name = newName
								refsInFile++
							}
						})
					}
				}
			})

			if (refsInFile > 0) {
				// Generate modified code
				const modifiedCode = ast.toSource({ quote: "single" })

				// Write modified code back to the file
				await fs.writeFile(fullFilePath, modifiedCode, "utf-8")

				// Add to changes
				fileChanges.push({
					filePath: fullFilePath,
					modifiedCode,
					references: refsInFile,
				})
			}
		} catch (error) {
			console.error(`Error processing file ${fullFilePath}:`, error)
		}
	}

	return fileChanges
}
