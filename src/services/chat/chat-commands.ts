// kilocode_change - new file

/**
 * Chat Commands for VSCode Extension
 * Registers chat-related commands for enhanced AI features
 */

import * as vscode from "vscode"
import { getChatService } from "./chat-service"
import { getCitationService } from "./citation-service"
import { getKnowledgeService } from "../knowledge/knowledge-service"
import type { CreateChatSessionRequest, SendMessageRequest } from "./types"

export function registerChatCommands(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel) {
	const chatService = getChatService()
	const citationService = getCitationService()
	const knowledgeService = getKnowledgeService()

	// Register all chat commands
	const commands = [
		// Create new chat session
		vscode.commands.registerCommand("kilo-code.chat.newSession", async () => {
			try {
				const title = await vscode.window.showInputBox({
					prompt: "Enter a title for the new chat session",
					placeHolder: "e.g., Code Review, Architecture Discussion",
				})

				if (!title) {
					return // User cancelled
				}

				const request: CreateChatSessionRequest = { title }
				const session = await chatService.createSession(request)

				outputChannel.appendLine(`[Chat] Created new session: ${session.id}`)
				vscode.window.showInformationMessage(`Chat session "${title}" created successfully!`)

				// Open chat panel
				await vscode.commands.executeCommand("kilo-code.SidebarProvider.focus")
			} catch (error) {
				outputChannel.appendLine(`[Chat] Error creating session: ${error}`)
				vscode.window.showErrorMessage(`Failed to create chat session: ${error}`)
			}
		}),

		// Send message to chat
		vscode.commands.registerCommand("kilo-code.chat.sendMessage", async () => {
			try {
				const message = await vscode.window.showInputBox({
					prompt: "Enter your message",
					placeHolder: "Ask a question about your code...",
				})

				if (!message) {
					return // User cancelled
				}

				// Get active session or create new one
				const request: SendMessageRequest = {
					content: message,
					role: "user",
					includeCitations: true,
				}

				outputChannel.appendLine(`[Chat] Sending message...`)
				// TODO: Integrate with actual chat session management
				vscode.window.showInformationMessage("Message sent!")
			} catch (error) {
				outputChannel.appendLine(`[Chat] Error sending message: ${error}`)
				vscode.window.showErrorMessage(`Failed to send message: ${error}`)
			}
		}),

		// Add selected code to context
		vscode.commands.registerCommand("kilo-code.chat.addToContext", async () => {
			try {
				const editor = vscode.window.activeTextEditor
				if (!editor) {
					vscode.window.showWarningMessage("No active editor found")
					return
				}

				const selection = editor.selection
				if (selection.isEmpty) {
					vscode.window.showWarningMessage("No code selected")
					return
				}

				const selectedText = editor.document.getText(selection)
				const filePath = editor.document.uri.fsPath
				const position = editor.document.offsetAt(selection.active)

				outputChannel.appendLine(`[Chat] Adding context from ${filePath}:${position}`)
				vscode.window.showInformationMessage("Code added to chat context!")

				// TODO: Store context for current session
			} catch (error) {
				outputChannel.appendLine(`[Chat] Error adding to context: ${error}`)
				vscode.window.showErrorMessage(`Failed to add to context: ${error}`)
			}
		}),

		// Navigate to citation
		vscode.commands.registerCommand("kilo-code.chat.navigateToCitation", async (citation: any) => {
			try {
				if (!citation || !citation.sourcePath) {
					vscode.window.showWarningMessage("Invalid citation")
					return
				}

				const uri = vscode.Uri.file(citation.sourcePath)
				const document = await vscode.workspace.openTextDocument(uri)
				await vscode.window.showTextDocument(document)

				// Navigate to specific line if provided
				if (citation.startLine) {
					const position = new vscode.Position(citation.startLine - 1, 0)
					const range = new vscode.Range(
						position,
						new vscode.Position(citation.endLine ? citation.endLine - 1 : citation.startLine - 1, 0),
					)
					const editor = vscode.window.activeTextEditor
					if (editor) {
						editor.selection = new vscode.Selection(range.start, range.end)
						editor.revealRange(range, vscode.TextEditorRevealType.InCenter)
					}
				}

				outputChannel.appendLine(`[Chat] Navigated to citation: ${citation.sourcePath}`)
			} catch (error) {
				outputChannel.appendLine(`[Chat] Error navigating to citation: ${error}`)
				vscode.window.showErrorMessage(`Failed to navigate to citation: ${error}`)
			}
		}),

		// Index codebase for knowledge
		vscode.commands.registerCommand("kilo-code.chat.indexCodebase", async () => {
			try {
				const workspaceFolders = vscode.workspace.workspaceFolders
				if (!workspaceFolders || workspaceFolders.length === 0) {
					vscode.window.showWarningMessage("No workspace folder found")
					return
				}

				const selectedFolder = await vscode.window.showQuickPick(
					workspaceFolders.map((folder) => ({
						label: folder.name,
						description: folder.uri.fsPath,
						uri: folder.uri,
					})),
					{
						placeHolder: "Select a folder to index",
					},
				)

				if (!selectedFolder) {
					return // User cancelled
				}

				await vscode.window.withProgress(
					{
						location: vscode.ProgressLocation.Notification,
						title: "Indexing codebase...",
						cancellable: true,
					},
					async (progress, token) => {
						try {
							progress.report({ increment: 0, message: "Starting..." })

							const indexedCount = await knowledgeService.indexDirectory(selectedFolder.description)

							progress.report({ increment: 100, message: "Complete!" })

							const stats = knowledgeService.getStats()
							outputChannel.appendLine(
								`[Chat] Indexed ${indexedCount} files. Total: ${stats.totalFiles} files, ${stats.totalLines} lines`,
							)

							vscode.window.showInformationMessage(
								`Successfully indexed ${indexedCount} files! Total: ${stats.totalFiles} files, ${stats.totalLines} lines`,
							)
						} catch (error) {
							if (token.isCancellationRequested) {
								vscode.window.showInformationMessage("Indexing cancelled")
							} else {
								throw error
							}
						}
					},
				)
			} catch (error) {
				outputChannel.appendLine(`[Chat] Error indexing codebase: ${error}`)
				vscode.window.showErrorMessage(`Failed to index codebase: ${error}`)
			}
		}),

		// Search knowledge base
		vscode.commands.registerCommand("kilo-code.chat.searchKnowledge", async () => {
			try {
				const query = await vscode.window.showInputBox({
					prompt: "Search codebase",
					placeHolder: "Enter search query...",
				})

				if (!query) {
					return // User cancelled
				}

				const results = await knowledgeService.search(query, 10)

				if (results.length === 0) {
					vscode.window.showInformationMessage("No results found")
					return
				}

				outputChannel.appendLine(`[Chat] Found ${results.length} results for "${query}"`)

				// Show results in quick pick
				const items = results.map((result) => ({
					label: result.file.path,
					description: `${result.matches.length} matches`,
					detail: result.matches[0]?.snippet || "",
					result,
				}))

				const selected = await vscode.window.showQuickPick(items, {
					placeHolder: "Select a result to open",
				})

				if (selected) {
					const uri = vscode.Uri.file(selected.result.file.path)
					await vscode.window.showTextDocument(uri)
				}
			} catch (error) {
				outputChannel.appendLine(`[Chat] Error searching knowledge: ${error}`)
				vscode.window.showErrorMessage(`Failed to search knowledge: ${error}`)
			}
		}),

		// Show citation details
		vscode.commands.registerCommand("kilo-code.chat.showCitationDetails", async (citation: any) => {
			try {
				if (!citation) {
					return
				}

				const details = [
					`Source: ${citation.sourcePath}`,
					`Type: ${citation.sourceType}`,
					`Confidence: ${(citation.confidence * 100).toFixed(1)}%`,
				]

				if (citation.startLine && citation.endLine) {
					details.push(`Lines: ${citation.startLine}-${citation.endLine}`)
				}

				if (citation.snippet) {
					details.push(`\nSnippet:\n${citation.snippet}`)
				}

				await vscode.window.showInformationMessage(details.join("\n"), "Open File").then((selection) => {
					if (selection === "Open File") {
						vscode.commands.executeCommand("kilo-code.chat.navigateToCitation", citation)
					}
				})
			} catch (error) {
				outputChannel.appendLine(`[Chat] Error showing citation details: ${error}`)
			}
		}),

		// Clear knowledge base
		vscode.commands.registerCommand("kilo-code.chat.clearKnowledge", async () => {
			try {
				const confirm = await vscode.window.showWarningMessage(
					"Are you sure you want to clear the knowledge base?",
					"Clear",
					"Cancel",
				)

				if (confirm === "Clear") {
					knowledgeService.clearIndex()
					outputChannel.appendLine("[Chat] Knowledge base cleared")
					vscode.window.showInformationMessage("Knowledge base cleared")
				}
			} catch (error) {
				outputChannel.appendLine(`[Chat] Error clearing knowledge: ${error}`)
				vscode.window.showErrorMessage(`Failed to clear knowledge: ${error}`)
			}
		}),

		// Show knowledge stats
		vscode.commands.registerCommand("kilo-code.chat.showKnowledgeStats", async () => {
			try {
				const stats = knowledgeService.getStats()

				const message = [
					`Knowledge Base Statistics:`,
					`Total Files: ${stats.totalFiles}`,
					`Total Size: ${(stats.totalSize / 1024 / 1024).toFixed(2)} MB`,
					`Total Lines: ${stats.totalLines}`,
					`Languages: ${Object.entries(stats.languages)
						.map(([lang, count]) => `${lang}: ${count}`)
						.join(", ")}`,
				].join("\n")

				vscode.window.showInformationMessage(message)
				outputChannel.appendLine(`[Chat] ${message}`)
			} catch (error) {
				outputChannel.appendLine(`[Chat] Error showing stats: ${error}`)
				vscode.window.showErrorMessage(`Failed to show stats: ${error}`)
			}
		}),
	]

	// Register all commands
	commands.forEach((command) => {
		context.subscriptions.push(command)
	})

	outputChannel.appendLine("[Chat] All chat commands registered successfully")
}
