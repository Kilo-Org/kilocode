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
	operation: "extract_function" | "move_to_file" | "rename_symbol"
	start_line?: number // Made optional for rename_symbol
	end_line?: number
	new_name?: string
	old_name?: string // Added for rename_symbol
	target_path?: string
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
	const operationsParam: string | undefined = block.params.operations

	// Support legacy single operation format for backward compatibility
	const legacyOperation: string | undefined = block.params.operation
	const legacyStartLine: string | undefined = block.params.start_line
	const legacyEndLine: string | undefined = block.params.end_line
	const legacyNewName: string | undefined = block.params.new_name
	const legacyTargetPath: string | undefined = block.params.target_path

	const sharedMessageProps: ClineSayTool = {
		tool: "refactorCode",
		path: getReadablePath(cline.cwd, removeClosingTag("path", relPath)),
		content: "",
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

			// Parse operations - support both single and batch formats
			let operations: RefactorOperation[]

			if (operationsParam) {
				try {
					const parsed = JSON.parse(operationsParam)
					operations = Array.isArray(parsed) ? parsed : [parsed]
				} catch (error) {
					cline.consecutiveMistakeCount++
					cline.recordToolError("refactor_code")
					const formattedError = `Invalid operations format. Expected JSON object or array: ${error}`
					await cline.say("error", formattedError)
					pushToolResult(formattedError)
					return
				}
			} else if (legacyOperation) {
				// Support legacy format
				operations = [
					{
						operation: legacyOperation as RefactorOperation["operation"],
						start_line: legacyStartLine ? parseInt(legacyStartLine) : 0,
						end_line: legacyEndLine ? parseInt(legacyEndLine) : undefined,
						new_name: legacyNewName,
						target_path: legacyTargetPath,
					},
				]
			} else {
				cline.consecutiveMistakeCount++
				cline.recordToolError("refactor_code")
				pushToolResult(await cline.sayAndCreateMissingParamError("refactor_code", "operations"))
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

			// Prepare operation descriptions for approval
			const operationDescriptions: string[] = []
			for (const op of operations) {
				switch (op.operation) {
					case "extract_function":
						operationDescriptions.push(
							`Extract function '${op.new_name}' from lines ${op.start_line}-${op.end_line}`,
						)
						break
					case "move_to_file":
						operationDescriptions.push(
							`Move code from lines ${op.start_line}-${op.end_line} to ${op.target_path}`,
						)
						break
					case "rename_symbol":
						if (op.old_name) {
							operationDescriptions.push(`Rename '${op.old_name}' to '${op.new_name}'`)
						} else {
							operationDescriptions.push(`Rename symbol at line ${op.start_line} to '${op.new_name}'`)
						}
						break
				}
			}

			const batchDescription =
				operations.length > 1
					? `Batch refactoring (${operations.length} operations):\n${operationDescriptions.map((d, i) => `${i + 1}. ${d}`).join("\n")}`
					: operationDescriptions[0]

			// Ask for approval BEFORE applying the refactoring
			const approvalMessage = JSON.stringify({
				...sharedMessageProps,
				content: batchDescription,
			} satisfies ClineSayTool)

			const didApprove = await askApproval("tool", approvalMessage)

			if (!didApprove) {
				pushToolResult("Refactoring cancelled by user")
				return
			}

			// Now proceed with the refactoring after approval
			const results: string[] = []
			let overallSuccess = true

			for (let i = 0; i < operations.length; i++) {
				const op = operations[i]
				let result: string
				let success = false

				// Re-read the document in case it was modified by previous operations
				if (i > 0) {
					await document.save()
					const updatedDoc = await vscode.workspace.openTextDocument(absolutePath)
					await vscode.window.showTextDocument(updatedDoc)
				}

				switch (op.operation) {
					case "extract_function": {
						if (!op.start_line || !op.end_line || !op.new_name) {
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
						const startLineNum = op.start_line - 1
						const endLineNum = op.end_line - 1

						if (isNaN(startLineNum) || isNaN(endLineNum)) {
							result = `Invalid line numbers provided: start_line=${op.start_line}, end_line=${op.end_line}`
							results.push(result)
							overallSuccess = false
							continue
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
										op.new_name,
									)

									if (renameEdits && renameEdits.size > 0) {
										await vscode.workspace.applyEdit(renameEdits)
										success = true
										result = `Successfully extracted function '${op.new_name}' from lines ${op.start_line}-${op.end_line}`
									} else {
										// Extraction succeeded but rename failed
										success = true
										result = `Successfully extracted function from lines ${op.start_line}-${op.end_line}, but could not rename to '${op.new_name}'. You may need to rename it manually.`
									}
								} catch (renameError) {
									// Extraction succeeded but rename failed
									success = true
									result = `Successfully extracted function from lines ${op.start_line}-${op.end_line}, but could not rename to '${op.new_name}'. You may need to rename it manually.`
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
						if (!op.start_line || !op.end_line || !op.target_path) {
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
						const startLineNum = op.start_line - 1
						const endLineNum = op.end_line - 1

						if (isNaN(startLineNum) || isNaN(endLineNum)) {
							result = `Invalid line numbers provided: start_line=${op.start_line}, end_line=${op.end_line}`
							results.push(result)
							overallSuccess = false
							continue
						}

						// Validate target path access
						const targetAccessAllowed = cline.rooIgnoreController?.validateAccess(op.target_path)
						if (!targetAccessAllowed) {
							result = formatResponse.rooIgnoreError(op.target_path)
							results.push(result)
							overallSuccess = false
							continue
						}

						try {
							// Set selection for the code to move
							const startPos = new vscode.Position(startLineNum, 0)
							const endPos = new vscode.Position(endLineNum, document.lineAt(endLineNum).text.length)
							const range = new vscode.Range(startPos, endPos)
							editor.selection = new vscode.Selection(startPos, endPos)

							// Prepare the target file URI
							const targetAbsolutePath = path.resolve(cline.cwd, op.target_path)
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
									result = `Successfully moved code from lines ${op.start_line}-${op.end_line} to ${op.target_path}`
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
									result = `Successfully moved code from lines ${op.start_line}-${op.end_line} to ${op.target_path}`
								} else {
									// Try to execute the command as-is
									await vscode.commands.executeCommand(
										moveAction.command.command,
										...(moveAction.command.arguments || []),
									)
									success = true
									result = `Successfully initiated move operation from lines ${op.start_line}-${op.end_line} to ${op.target_path}`
								}
							} else if (moveAction.edit) {
								// If the action already has a WorkspaceEdit, apply it
								const editSuccess = await vscode.workspace.applyEdit(moveAction.edit)
								if (editSuccess) {
									success = true
									result = `Successfully moved code from lines ${op.start_line}-${op.end_line} to ${op.target_path}`
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
						if (!op.new_name || (!op.start_line && !op.old_name)) {
							result = `Missing required parameters for rename_symbol: new_name and either start_line or old_name`
							results.push(result)
							overallSuccess = false
							continue
						}

						try {
							let renamePosition: vscode.Position | undefined

							if (op.start_line) {
								// Use provided line number
								const lineNum = op.start_line - 1
								if (!isNaN(lineNum) && lineNum >= 0 && lineNum < document.lineCount) {
									const line = document.lineAt(lineNum).text

									// If old_name is provided, verify it exists on this line
									if (op.old_name) {
										const charPos = line.indexOf(op.old_name)
										if (charPos >= 0) {
											renamePosition = new vscode.Position(lineNum, charPos)
										}
									} else {
										// Try to find any identifier on the line
										const identifierRegex = /\b[a-zA-Z_]\w*\b/g
										let match: RegExpExecArray | null

										while ((match = identifierRegex.exec(line)) !== null) {
											const pos = new vscode.Position(lineNum, match.index)
											try {
												// Test if this position is renameable
												const testRename =
													await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
														"vscode.executeDocumentRenameProvider",
														document.uri,
														pos,
														op.new_name,
													)
												if (testRename && testRename.size > 0) {
													renamePosition = pos
													break
												}
											} catch (e) {
												// Continue to next identifier
											}
										}
									}
								}
							} else if (op.old_name) {
								// Search for old_name in the entire file
								const text = document.getText()
								const regex = new RegExp(
									`\\b${op.old_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
									"g",
								)
								let match: RegExpExecArray | null

								while ((match = regex.exec(text)) !== null) {
									const pos = document.positionAt(match.index)
									try {
										// Test if this position is renameable
										const testRename = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
											"vscode.executeDocumentRenameProvider",
											document.uri,
											pos,
											op.new_name,
										)
										if (testRename && testRename.size > 0) {
											renamePosition = pos
											break // Use the first renameable occurrence
										}
									} catch (e) {
										// Continue to next occurrence
									}
								}
							}

							if (!renamePosition) {
								result = op.old_name
									? `Cannot find renameable symbol '${op.old_name}' in the file`
									: `Cannot find renameable symbol at line ${op.start_line}`
								results.push(result)
								overallSuccess = false
								continue
							}

							// Perform the rename
							const renameEdits = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
								"vscode.executeDocumentRenameProvider",
								document.uri,
								renamePosition,
								op.new_name,
							)

							if (renameEdits && renameEdits.size > 0) {
								const editSuccess = await vscode.workspace.applyEdit(renameEdits)

								if (editSuccess) {
									success = true
									const fileCount = renameEdits.size
									result = op.old_name
										? `Successfully renamed '${op.old_name}' to '${op.new_name}' (updated ${fileCount} file${fileCount > 1 ? "s" : ""})`
										: `Successfully renamed symbol to '${op.new_name}' at line ${op.start_line} (updated ${fileCount} file${fileCount > 1 ? "s" : ""})`
								} else {
									result = `Failed to apply rename edits`
								}
							} else {
								result = `No rename edits were generated`
							}
						} catch (error) {
							result = `Failed to rename symbol: ${error instanceof Error ? error.message : String(error)}`
						}
						break
					}

					default:
						result = `Unknown refactoring operation: ${op.operation}. Supported operations are: extract_function, move_to_file, rename_symbol`
						overallSuccess = false
				}

				results.push(result)
				if (success) {
					// Track file edit operation
					await cline.fileContextTracker.trackFileContext(relPath, "roo_edited" as RecordSource)
					if (op.target_path) {
						await cline.fileContextTracker.trackFileContext(op.target_path, "roo_edited" as RecordSource)
					}
				} else {
					overallSuccess = false
				}
			}

			// Save the document after all operations are completed
			await document.save()

			if (overallSuccess) {
				cline.consecutiveMistakeCount = 0
				// Used to determine if we should wait for busy terminal to update before sending api request
				cline.didEditFile = true
			} else {
				cline.consecutiveMistakeCount++
				cline.recordToolError("refactor_code", results.join("\n"))
			}

			// Send the results back to the LLM
			const finalResult =
				operations.length > 1
					? `Batch refactoring completed:\n${results.map((r, i) => `${i + 1}. ${r}`).join("\n")}`
					: results[0]

			pushToolResult(finalResult)
			return
		}
	} catch (error) {
		await handleError("refactoring code", error)
		return
	}
}
