import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"
// jscodeshift is now imported dynamically in the performCodeMove function
import { ClineSayTool } from "../../shared/ExtensionMessage"
import { getReadablePath } from "../../utils/path"
import { Task } from "../task/Task"
import { ToolUse, RemoveClosingTag } from "../../shared/tools"
import { formatResponse } from "../prompts/responses"
import { AskApproval, HandleError, PushToolResult } from "../../shared/tools"
import { fileExistsAtPath } from "../../utils/fs"
import { RecordSource } from "../context-tracking/FileContextTrackerTypes"

export interface RefactorOperation {
	operation: "move_to_file" | "rename_symbol"
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
			await cline.ask("tool", JSON.stringify(sharedMessageProps), block.partial).catch(() => { })
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

			// Save original file content for potential rollback
			const originalContent = document.getText()

			// Now proceed with the refactoring after approval
			const results: string[] = []
			let overallSuccess = true

			// Track modified files for verification
			const modifiedFiles = new Set<string>()
			modifiedFiles.add(absolutePath)

			// Group operations by type to ensure move_to_file operations are processed first
			// This helps prevent issues with mixed batch operations
			const moveOperations = operations.filter(op => op.operation === "move_to_file");
			const renameOperations = operations.filter(op => op.operation === "rename_symbol");
			const otherOperations = operations.filter(op =>
				op.operation !== "move_to_file" && op.operation !== "rename_symbol");

			// Process operations in the optimal order: moves first, then renames, then others
			const orderedOperations = [...moveOperations, ...renameOperations, ...otherOperations];

			for (let i = 0; i < orderedOperations.length; i++) {
				const op = orderedOperations[i]
				let result: string = ""
				let success = false

				// Re-read the document in case it was modified by previous operations
				if (i > 0) {
					await document.save()
					// Ensure document is properly refreshed between operations
					await vscode.commands.executeCommand("workbench.action.files.revert")
					const updatedDoc = await vscode.workspace.openTextDocument(absolutePath)
					await vscode.window.showTextDocument(updatedDoc)
				}

				switch (op.operation) {
					case "move_to_file": {
						if (!op.start_line || !op.end_line || !op.target_path) {
							result = `Missing required parameters for move_to_file: start_line, end_line, and target_path`
							results.push(result)
							overallSuccess = false
							continue
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
							// No retry logic - just try once with the exact line range
							let moveSuccess = false;

							// Set selection for the code to move
							const startPos = new vscode.Position(startLineNum, 0)
							const endPos = new vscode.Position(endLineNum, document.lineAt(endLineNum).text.length)
							const range = new vscode.Range(startPos, endPos)
							editor.selection = new vscode.Selection(startPos, endPos)

							// Prepare the target file URI
							const targetAbsolutePath = path.resolve(cline.cwd, op.target_path)
							const targetUri = vscode.Uri.file(targetAbsolutePath)

							// Add target file to modified files list
							modifiedFiles.add(targetAbsolutePath)

							// Ensure target directory exists
							const targetDir = path.dirname(targetAbsolutePath)
							await fs.mkdir(targetDir, { recursive: true })

							// Get all Move refactor code actions at the selected range
							const moveActions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
								"vscode.executeCodeActionProvider",
								document.uri,
								range,
								vscode.CodeActionKind.RefactorMove.value,
							)

							// Helper function for code movement using jscodeshift
							const performCodeMove = async () => {
								try {
									// Import the moveCode function from our service
									const { moveCode } = await import("../../services/code-transform/moveCode");

									// Call the moveCode function with the appropriate parameters
									// Ensure start_line and end_line are defined before passing them
									if (!op.start_line || !op.end_line) {
										throw new Error("Missing required start_line or end_line parameter");
									}

									// Convert line numbers to numbers to ensure they're valid
									const startLine = Number(op.start_line);
									const endLine = Number(op.end_line);

									// Validate line numbers
									if (isNaN(startLine) || isNaN(endLine) || startLine < 1 || endLine < startLine) {
										throw new Error(`Invalid line numbers: start_line=${op.start_line}, end_line=${op.end_line}`);
									}

									const moveResult = await moveCode(
										absolutePath,
										targetAbsolutePath,
										startLine,
										endLine
									);

									if (moveResult.success) {
										success = true;
										moveSuccess = true;

										// Include information about imports if they were added
										const importInfo = moveResult.importsAdded
											? ` and added imports for ${moveResult.exportedNames?.join(', ')}`
											: '';

										result = `Successfully moved code from lines ${op.start_line}-${op.end_line} to ${op.target_path}${importInfo}`;
									} else {
										success = false;
										moveSuccess = false;
										result = moveResult.error || "Unknown error during code move";
									}
								} catch (error) {
									success = false;
									moveSuccess = false;
									result = `Error during code move: ${error instanceof Error ? error.message : String(error)}`;
								}
							};

							if (!moveActions || moveActions.length === 0) {
								// If no move actions available, use our jscodeshift-based move
								// This handles cases where the language server doesn't support move refactoring
								await performCodeMove();
							} else {
								// Find the move to file action
								const moveToFileAction = moveActions.find(
									(action) =>
										/^Move\s+[\s\S]*\s+to\s+(a\s+)?file/i.test(action.title) ||
										action.title.toLowerCase().includes("move to file"),
								)

								if (!moveToFileAction) {
									result = `No "Move to file" action available. Found actions: ${moveActions.map((a) => a.title).join(", ")}. Using jscodeshift-based move instead.`
									// Fall back to jscodeshift-based move
									await performCodeMove();
									continue;
								}

								if (!moveToFileAction.edit) {
									// If the move action has no edit, use our jscodeshift-based move
									// This handles cases where the action requires UI interaction
									console.log("Move to file action has no edit, using jscodeshift move");
									await performCodeMove();
								} else {
									// Apply the workspace edit from the code action
									const editSuccess = await vscode.workspace.applyEdit(moveToFileAction.edit)

									if (editSuccess) {
										// The edit might create content for a new file but not actually create the file
										// So we need to ensure the file exists
										try {
											await fs.access(targetAbsolutePath)
										} catch {
											// File doesn't exist, create it
											// The workspace edit should have added the content, but we need to create the file
											await vscode.workspace.fs.writeFile(targetUri, Buffer.from("", "utf-8"))
										}

										// Verify that code was actually moved
										// Read the target file to verify content was added
										try {
											const targetContent = await fs.readFile(targetAbsolutePath, "utf-8")
											if (targetContent.trim().length > 0) {
												success = true
												moveSuccess = true;
												result = `Successfully moved code from lines ${op.start_line}-${op.end_line} to ${op.target_path}`
											} else {
												success = false
												moveSuccess = false;
												result = `Failed to move code: Target file is empty. This may indicate an issue with the code movement operation.`
											}
										} catch (error) {
											success = false
											moveSuccess = false;
											result = `Failed to verify code movement: ${error instanceof Error ? error.message : String(error)}`
										}
									} else {
										success = false;
										moveSuccess = false;
										result = `Failed to apply move to file edit`
									}
								}
							}

							// If successful, open the target file
							if (moveSuccess) {
								try {
									const targetDoc = await vscode.workspace.openTextDocument(targetUri)
									await vscode.window.showTextDocument(targetDoc, { preview: false })
								} catch (error) {
									// Ignore errors opening the file
								}
							}
						} catch (error) {
							result = `Failed to move to file: ${error instanceof Error ? error.message : String(error)}`
						}
						break
					}

					case "rename_symbol": {
						if (!op.new_name || (!op.start_line && !op.old_name)) {
							result = `Missing required parameters for rename_symbol: new_name and either start_line or old_name`;
							results.push(result);
							overallSuccess = false;
							continue;
						}

						try {
							let renamePosition: vscode.Position | undefined;

							if (op.start_line) {
								// Use provided line number
								const lineNum = op.start_line - 1;
								if (!isNaN(lineNum) && lineNum >= 0 && lineNum < document.lineCount) {
									const line = document.lineAt(lineNum).text;

									// If old_name is provided, verify it exists on this line
									if (op.old_name) {
										const charPos = line.indexOf(op.old_name);
										if (charPos >= 0) {
											renamePosition = new vscode.Position(lineNum, charPos);
										}
									} else {
										// Try to find the first renameable symbol on the line
										// This regex attempts to find potential identifiers or property access
										const symbolRegex = /([a-zA-Z_$][0-9a-zA-Z_$]*(\.[a-zA-Z_$][0-9a-zA-Z_$]*)*)/g;
										let match: RegExpExecArray | null;

										while ((match = symbolRegex.exec(line)) !== null) {
											const _symbolText = match[0]; // Prefix with _ to indicate unused
											const pos = new vscode.Position(lineNum, match.index);
											try {
												// Test if this position is renameable
												const testRename =
													await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
														"vscode.executeDocumentRenameProvider",
														document.uri,
														pos,
														op.new_name,
													);
												if (testRename && testRename.size > 0) {
													renamePosition = pos;
													break; // Found a renameable symbol, stop searching this line
												}
											} catch (e) {
												// Continue to next potential symbol on the line
											}
										}
									}
								}
							} else if (op.old_name) {
								// Search for old_name in the entire file and find the first renameable occurrence
								const text = document.getText();
								const regex = new RegExp(
									`\\b${op.old_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
									"g",
								);
								let match: RegExpExecArray | null;

								// Find the first occurrence of the symbol
								match = regex.exec(text);

								if (match) {
									const pos = document.positionAt(match.index);
									try {
										// Test if this position is renameable
										const testRename = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
											"vscode.executeDocumentRenameProvider",
											document.uri,
											pos,
											op.new_name,
										);
										if (testRename && testRename.size > 0) {
											renamePosition = pos;
										}
									} catch (e) {
										// If the first occurrence isn't renameable, we report an error below.
										// We don't try other occurrences when renaming by name, as the VS Code
										// rename provider should handle all references.
									}
								}

								// If we couldn't find a renameable occurrence, report an error
								if (!renamePosition && match) {
									result = `Found symbol '${op.old_name}' but it is not renameable at the first occurrence.`;
									results.push(result);
									overallSuccess = false;
									continue;
								}
							}

							// If we still couldn't find a position, report an error
							if (!renamePosition) {
								result = op.old_name
									? `Cannot find renameable symbol '${op.old_name}' in the file. Check if the symbol name is correct and exists in the file.`
									: `Cannot find renameable symbol at line ${op.start_line}. Check if the line number is correct and contains a valid symbol.`;
								results.push(result);
								overallSuccess = false;
								continue;
							}

							// Perform the rename
							let renameEdits = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
								"vscode.executeDocumentRenameProvider",
								document.uri,
								renamePosition,
								op.new_name,
							);

							// Apply the rename edits provided by the language server
							const renameSuccess = await vscode.workspace.applyEdit(renameEdits);

							if (renameSuccess) {
								success = true;
								result = `Successfully renamed symbol to '${op.new_name}'`;
							} else {
								success = false;
								result = op.old_name
									? `Failed to rename '${op.old_name}' to '${op.new_name}'. The language server may not support renaming this symbol.`
									: `Failed to rename symbol at line ${op.start_line} to '${op.new_name}'. The language server may not support renaming this symbol.`;
							}

						} catch (error) {
							result = `Failed to rename symbol: ${error instanceof Error ? error.message : String(error)}`;
						}
						break;
					}

					default: {
						result = `Unknown refactoring operation: ${op.operation}. Supported operations are: move_to_file, rename_symbol`;
						overallSuccess = false;
						results.push(result);
						break;
					}
				}

				// If an operation failed, set overallSuccess to false
				if (!success) {
					overallSuccess = false;
				}

				// Track modified files for context
				if (success) {
					if (op.target_path) {
						await cline.fileContextTracker.trackFileContext(op.target_path, "roo_edited" as RecordSource);
					}
					await cline.fileContextTracker.trackFileContext(relPath, "roo_edited" as RecordSource);
				} else {
					// If an operation failed, mark the original file as potentially corrupted
					await cline.fileContextTracker.trackFileContext(relPath, "roo_edited" as RecordSource);
				}

				// Rollback changes if any operation failed in a batch
				if (operations.length > 1 && !overallSuccess) {
					const isCriticalFailure = result.includes("file corruption") ||
						result.includes("syntax error") ||
						result.includes("Failed to apply") ||
						result.includes("No valid nodes found") ||
						result.includes("Target file is empty");

					if (isCriticalFailure) {
						try {
							await fs.writeFile(absolutePath, originalContent, "utf-8");
							results[results.length - 1] += " (changes were rolled back to prevent file corruption)";
						} catch (rollbackError) {
							results[results.length - 1] += " (failed to roll back changes, file may be corrupted)";
							handleError("rolling back refactoring changes", rollbackError);
						}
					}
				}

				results.push(result); // Add the result of the current operation
			}

			// Save the document after all operations are complete
			await document.save();

			// Report overall result
			if (overallSuccess) {
				cline.consecutiveMistakeCount = 0;
				cline.didEditFile = true;
				const finalResult =
					operations.length > 1
						? `Batch refactoring completed successfully:\n${results.map((r, i) => `${i + 1}. ${r}`).join("\n")}`
						: results[0];
				pushToolResult(finalResult);
			} else {
				cline.consecutiveMistakeCount++;
				cline.recordToolError("refactor_code", results.join("\n"));
				const finalResult =
					operations.length > 1
						? `Batch refactoring failed:\n${results.map((r, i) => `${i + 1}. ${r}`).join("\n")}`
						: results[0];
				await cline.say("error", finalResult);
				pushToolResult(finalResult);
			}

		}
	} catch (error) {
		await handleError("refactoring code", error);
	}
}
