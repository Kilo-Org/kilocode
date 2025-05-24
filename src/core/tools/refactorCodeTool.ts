import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"
import { ClineSayTool } from "../../shared/ExtensionMessage"
import { getReadablePath } from "../../utils/path"
import { Task } from "../task/Task"
import { ToolUse, RemoveClosingTag } from "../../shared/tools"
import { formatResponse } from "../prompts/responses"
import { AskApproval, HandleError, PushToolResult } from "../../shared/tools"
import { fileExistsAtPath } from "../../utils/fs"
import { RecordSource } from "../context-tracking/FileContextTrackerTypes"

export interface RefactorOperation {
	type: "extract_function" | "move_to_file" | "rename_symbol"
	params: Record<string, any>
}

export async function refactorCodeTool(
	cline: Task,
	block: ToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag,
) {
	const relPath: string | undefined = block.params.path
	const operation: string | undefined = block.params.operation
	const startLine: string | undefined = block.params.start_line
	const endLine: string | undefined = block.params.end_line
	const newName: string | undefined = block.params.new_name
	const targetPath: string | undefined = block.params.target_path

	const sharedMessageProps: ClineSayTool = {
		tool: "refactorCode",
		path: getReadablePath(cline.cwd, removeClosingTag("path", relPath)),
		content: operation,
	}

	try {
		if (block.partial) {
			// Update GUI message
			await cline.ask("tool", JSON.stringify(sharedMessageProps), block.partial).catch(() => {})
			return
		} else {
			if (!relPath) {
				cline.consecutiveMistakeCount++
				cline.recordToolError("refactor_code")
				pushToolResult(await cline.sayAndCreateMissingParamError("refactor_code", "path"))
				return
			}

			if (!operation) {
				cline.consecutiveMistakeCount++
				cline.recordToolError("refactor_code")
				pushToolResult(await cline.sayAndCreateMissingParamError("refactor_code", "operation"))
				return
			}

			const accessAllowed = cline.rooIgnoreController?.validateAccess(relPath)

			if (!accessAllowed) {
				await cline.say("rooignore_error", relPath)
				pushToolResult(formatResponse.toolError(formatResponse.rooIgnoreError(relPath)))
				return
			}

			const absolutePath = path.resolve(cline.cwd, relPath)
			const fileExists = await fileExistsAtPath(absolutePath)

			if (!fileExists) {
				cline.consecutiveMistakeCount++
				cline.recordToolError("refactor_code")
				const formattedError = `File does not exist at path: ${relPath}\n\n<error_details>\nThe specified file could not be found. Please verify the file path is relative to the workspace directory: ${cline.cwd}\nResolved absolute path: ${absolutePath}\n</error_details>`
				await cline.say("error", formattedError)
				pushToolResult(formattedError)
				return
			}

			// Open the file in VS Code
			const document = await vscode.workspace.openTextDocument(absolutePath)
			const editor = await vscode.window.showTextDocument(document)

			// Prepare the operation description for approval
			let operationDescription: string
			switch (operation) {
				case "extract_function":
					operationDescription = `Extract function '${newName}' from lines ${startLine}-${endLine}`
					break
				case "move_to_file":
					operationDescription = `Move code from lines ${startLine}-${endLine} to ${targetPath}`
					break
				case "rename_symbol":
					operationDescription = `Rename symbol at line ${startLine} to '${newName}'`
					break
				default:
					operationDescription = operation
			}

			// Ask for approval BEFORE applying the refactoring
			const approvalMessage = JSON.stringify({
				...sharedMessageProps,
				content: operationDescription,
			} satisfies ClineSayTool)

			const didApprove = await askApproval("tool", approvalMessage)

			if (!didApprove) {
				pushToolResult("Refactoring cancelled by user")
				return
			}

			// Now proceed with the refactoring after approval
			let result: string
			let success = false

			switch (operation) {
				case "extract_function": {
					if (!startLine || !endLine || !newName) {
						cline.consecutiveMistakeCount++
						cline.recordToolError("refactor_code")
						pushToolResult(
							await cline.sayAndCreateMissingParamError(
								"refactor_code",
								"start_line, end_line, and new_name are required for extract_function",
							),
						)
						return
					}

					// Convert line numbers to VS Code positions (0-based)
					const startLineNum = parseInt(startLine) - 1
					const endLineNum = parseInt(endLine) - 1

					if (isNaN(startLineNum) || isNaN(endLineNum)) {
						cline.consecutiveMistakeCount++
						cline.recordToolError("refactor_code")
						const formattedError = `Invalid line numbers provided: start_line=${startLine}, end_line=${endLine}`
						await cline.say("error", formattedError)
						pushToolResult(formattedError)
						return
					}

					// Set selection
					const startPos = new vscode.Position(startLineNum, 0)
					const endPos = new vscode.Position(endLineNum, document.lineAt(endLineNum).text.length)
					const range = new vscode.Range(startPos, endPos)
					editor.selection = new vscode.Selection(startPos, endPos)

					try {
						// Get all Extract refactor code actions at the selected range
						const extractActions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
							"vscode.executeCodeActionProvider",
							document.uri,
							range,
							{
								kind: vscode.CodeActionKind.RefactorExtract.value,
							},
						)

						if (!extractActions || extractActions.length === 0) {
							result = `No Extract refactor available for the selected code. The code might not be a complete extractable unit.`
							cline.consecutiveMistakeCount++
							cline.recordToolError("refactor_code", result)
							await cline.say("error", result)
							pushToolResult(result)
							return
						}

						// Find the extract function action (not extract constant or extract type)
						const extractFunctionAction =
							extractActions.find(
								(action) =>
									action.title.toLowerCase().includes("function") ||
									action.title.toLowerCase().includes("method"),
							) || extractActions[0]

						let extractSuccess = false

						// Apply the extract action
						if (extractFunctionAction.command) {
							await vscode.commands.executeCommand(
								extractFunctionAction.command.command,
								...(extractFunctionAction.command.arguments || []),
							)
							extractSuccess = true
						} else if (extractFunctionAction.edit) {
							extractSuccess = await vscode.workspace.applyEdit(extractFunctionAction.edit)
						}

						if (extractSuccess) {
							// After extraction, try to rename the function
							// Wait a bit for the extraction to complete and cursor to be positioned
							await new Promise((resolve) => setTimeout(resolve, 500))

							// Get the current cursor position (should be on the new function name)
							const currentPosition = editor.selection.active

							// Try to rename using the rename provider
							try {
								const renameEdits = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
									"vscode.executeDocumentRenameProvider",
									document.uri,
									currentPosition,
									newName,
								)

								if (renameEdits && renameEdits.size > 0) {
									await vscode.workspace.applyEdit(renameEdits)
									success = true
									result = `Successfully extracted function '${newName}' from lines ${startLine}-${endLine} in ${relPath}`
								} else {
									// Extraction succeeded but rename failed
									success = true
									result = `Successfully extracted function from lines ${startLine}-${endLine} in ${relPath}, but could not rename to '${newName}'. You may need to rename it manually.`
								}
							} catch (renameError) {
								// Extraction succeeded but rename failed
								success = true
								result = `Successfully extracted function from lines ${startLine}-${endLine} in ${relPath}, but could not rename to '${newName}'. You may need to rename it manually.`
							}
						} else {
							result = `Failed to apply extract function refactoring`
						}
					} catch (error) {
						result = `Failed to extract function: ${error instanceof Error ? error.message : String(error)}`
					}
					break
				}

				case "move_to_file": {
					if (!startLine || !endLine || !targetPath) {
						cline.consecutiveMistakeCount++
						cline.recordToolError("refactor_code")
						pushToolResult(
							await cline.sayAndCreateMissingParamError(
								"refactor_code",
								"start_line, end_line, and target_path are required for move_to_file",
							),
						)
						return
					}

					// Convert line numbers to VS Code positions (0-based)
					const startLineNum = parseInt(startLine) - 1
					const endLineNum = parseInt(endLine) - 1

					if (isNaN(startLineNum) || isNaN(endLineNum)) {
						cline.consecutiveMistakeCount++
						cline.recordToolError("refactor_code")
						const formattedError = `Invalid line numbers provided: start_line=${startLine}, end_line=${endLine}`
						await cline.say("error", formattedError)
						pushToolResult(formattedError)
						return
					}

					// Validate target path access
					const targetAccessAllowed = cline.rooIgnoreController?.validateAccess(targetPath)
					if (!targetAccessAllowed) {
						await cline.say("rooignore_error", targetPath)
						pushToolResult(formatResponse.toolError(formatResponse.rooIgnoreError(targetPath)))
						return
					}

					try {
						// Set selection for the code to move
						const startPos = new vscode.Position(startLineNum, 0)
						const endPos = new vscode.Position(endLineNum, document.lineAt(endLineNum).text.length)
						const range = new vscode.Range(startPos, endPos)
						editor.selection = new vscode.Selection(startPos, endPos)

						// Prepare the target file URI
						const targetAbsolutePath = path.resolve(cline.cwd, targetPath)
						const targetUri = vscode.Uri.file(targetAbsolutePath)

						// Ensure target directory exists
						const targetDir = path.dirname(targetAbsolutePath)
						await fs.mkdir(targetDir, { recursive: true })

						// Get all Move refactor code actions at the selected range
						const moveActions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
							"vscode.executeCodeActionProvider",
							document.uri,
							range,
							{
								kind: vscode.CodeActionKind.RefactorMove.value,
							},
						)

						if (!moveActions || moveActions.length === 0) {
							result = `No Move refactor available for the selected code. The code might not be a complete moveable unit (e.g., a complete function, class, or module export).`
							cline.consecutiveMistakeCount++
							cline.recordToolError("refactor_code", result)
							await cline.say("error", result)
							pushToolResult(result)
							return
						}

						// Find the appropriate move action or use the first one
						const moveAction = moveActions[0]

						// Check if the action has a command that needs the target URI
						if (moveAction.command) {
							if (
								moveAction.command.command === "typescript.moveToFile" ||
								moveAction.command.command === "javascript.moveToFile" ||
								moveAction.command.command === "_typescript.moveToFile" ||
								moveAction.command.command === "_javascript.moveToFile"
							) {
								// For TypeScript/JavaScript move commands, provide the target URI
								await vscode.commands.executeCommand(
									moveAction.command.command,
									moveAction.command.arguments?.[0], // action
									targetUri, // target file URI
								)
								success = true
								result = `Successfully moved code from lines ${startLine}-${endLine} to ${targetPath}`
							} else if (moveAction.command.command === "editor.action.refactor") {
								// Generic refactor command - provide all necessary arguments
								const args = [
									document.uri, // source document
									range, // the text range
									"move", // refactor kind
									moveAction.title, // action name
									targetUri.toString(), // target file path
								]
								await vscode.commands.executeCommand(moveAction.command.command, ...args)
								success = true
								result = `Successfully moved code from lines ${startLine}-${endLine} to ${targetPath}`
							} else {
								// Try to execute the command as-is
								await vscode.commands.executeCommand(
									moveAction.command.command,
									...(moveAction.command.arguments || []),
								)
								success = true
								result = `Successfully initiated move operation from lines ${startLine}-${endLine} to ${targetPath}`
							}
						} else if (moveAction.edit) {
							// If the action already has a WorkspaceEdit, apply it
							const editSuccess = await vscode.workspace.applyEdit(moveAction.edit)
							if (editSuccess) {
								success = true
								result = `Successfully moved code from lines ${startLine}-${endLine} to ${targetPath}`
							} else {
								result = `Failed to apply the move refactoring edit`
							}
						} else {
							result = `Move refactor action had no command or edit to apply`
						}

						// If successful, open the target file
						if (success) {
							try {
								const targetDoc = await vscode.workspace.openTextDocument(targetUri)
								await vscode.window.showTextDocument(targetDoc, { preview: false })
							} catch (error) {
								// Target file might not exist yet if it's a new file
								// This is okay, the refactoring might create it
							}
						}
					} catch (error) {
						result = `Failed to move to file: ${error instanceof Error ? error.message : String(error)}`
					}
					break
				}

				case "rename_symbol": {
					if (!startLine || !newName) {
						cline.consecutiveMistakeCount++
						cline.recordToolError("refactor_code")
						pushToolResult(
							await cline.sayAndCreateMissingParamError(
								"refactor_code",
								"start_line and new_name are required for rename_symbol",
							),
						)
						return
					}

					// Convert line number to VS Code position (0-based)
					const lineNum = parseInt(startLine) - 1

					if (isNaN(lineNum)) {
						cline.consecutiveMistakeCount++
						cline.recordToolError("refactor_code")
						const formattedError = `Invalid line number provided: start_line=${startLine}`
						await cline.say("error", formattedError)
						pushToolResult(formattedError)
						return
					}

					try {
						// Get the line text
						const line = document.lineAt(lineNum).text

						// Try multiple strategies to find a renameable symbol on this line
						let renameEdits: vscode.WorkspaceEdit | undefined
						let attemptedPositions: number[] = []

						// Strategy 1: Try to find identifiers (alphanumeric + underscore sequences)
						const identifierRegex = /\b[a-zA-Z_]\w*\b/g
						let match: RegExpExecArray | null

						while ((match = identifierRegex.exec(line)) !== null) {
							const charPos = match.index
							attemptedPositions.push(charPos)
							const position = new vscode.Position(lineNum, charPos)

							try {
								renameEdits = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
									"vscode.executeDocumentRenameProvider",
									document.uri,
									position,
									newName,
								)

								if (renameEdits && renameEdits.size > 0) {
									break // Found a renameable symbol
								}
							} catch (e) {
								// Continue to next identifier
							}
						}

						// Strategy 2: If no identifier worked, try the first non-whitespace position
						if (!renameEdits || renameEdits.size === 0) {
							let charPos = 0
							for (let i = 0; i < line.length; i++) {
								if (!/\s/.test(line[i])) {
									charPos = i
									break
								}
							}

							if (!attemptedPositions.includes(charPos)) {
								const position = new vscode.Position(lineNum, charPos)
								try {
									renameEdits = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
										"vscode.executeDocumentRenameProvider",
										document.uri,
										position,
										newName,
									)
								} catch (e) {
									// Ignore
								}
							}
						}

						if (renameEdits && renameEdits.size > 0) {
							// Apply the rename edits
							const editSuccess = await vscode.workspace.applyEdit(renameEdits)

							if (editSuccess) {
								success = true
								const fileCount = renameEdits.size
								result = `Successfully renamed symbol to '${newName}' at line ${startLine} (updated ${fileCount} file${fileCount > 1 ? "s" : ""})`
							} else {
								result = `Failed to apply rename edits`
							}
						} else {
							// Provide more helpful error message
							const linePreview = line.trim().substring(0, 50) + (line.trim().length > 50 ? "..." : "")
							result = `Cannot rename any symbol on line ${startLine}. The line contains: "${linePreview}". Make sure the line contains a renameable identifier (variable, function, class, etc.)`
						}
					} catch (error) {
						result = `Failed to rename symbol: ${error instanceof Error ? error.message : String(error)}`
					}
					break
				}

				default:
					cline.consecutiveMistakeCount++
					result = `Unknown refactoring operation: ${operation}. Supported operations are: extract_function, move_to_file, rename_symbol`
					cline.recordToolError("refactor_code", result)
					await cline.say("error", result)
					pushToolResult(result)
					return
			}

			if (success) {
				cline.consecutiveMistakeCount = 0

				// Track file edit operation
				await cline.fileContextTracker.trackFileContext(relPath, "roo_edited" as RecordSource)
				if (targetPath) {
					await cline.fileContextTracker.trackFileContext(targetPath, "roo_edited" as RecordSource)
				}

				// Used to determine if we should wait for busy terminal to update before sending api request
				cline.didEditFile = true
			} else {
				cline.consecutiveMistakeCount++
				cline.recordToolError("refactor_code", result)
			}

			// Send the result back to the LLM
			pushToolResult(result)
			return
		}
	} catch (error) {
		await handleError("refactoring code", error)
		return
	}
}
