/**
 * File Opener Service
 *
 * Handles AI-driven file opening with tab management and workspace coordination
 */

import * as vscode from "vscode"
import { Logger } from "../error-handler"
import { DiffEventManager } from "../event-system"

export interface OpenFileRequest {
	filePath: string
	action?: "open" | "focus" | "background"
	createIfNotExists?: boolean
}

export interface OpenFileResponse {
	success: boolean
	fileBufferId?: string
	isNewTab?: boolean
	error?: string
}

export interface OpenMultipleFilesResponse {
	success: boolean
	results: Array<{
		filePath: string
		success: boolean
		isNewTab: boolean
		error?: string
	}>
}

/**
 * File opener service for multi-file workflows
 */
export class FileOpenerService {
	private activeTabs: Map<string, { uri: vscode.Uri; document: vscode.TextDocument }> = new Map()
	private workspaceRoot: string

	constructor() {
		// Detect workspace root
		const workspaceFolders = vscode.workspace.workspaceFolders
		this.workspaceRoot = workspaceFolders?.[0]?.uri.fsPath || ""
	}

	/**
	 * Initialize service
	 */
	async initialize(): Promise<void> {
		try {
			// Register workspace change listeners
			vscode.workspace.onDidChangeWorkspaceFolders(this.onWorkspaceFoldersChanged.bind(this))
			vscode.workspace.onDidChangeTextDocument(this.onDocumentChanged.bind(this))
			vscode.window.onDidChangeActiveTextEditor(this.onActiveEditorChanged.bind(this))
			vscode.window.onDidChangeVisibleTextEditors(this.onVisibleEditorsChanged.bind(this))

			// Restore existing tabs from workspace
			await this.restoreExistingTabs()

			Logger.info("FileOpenerService.initialize", "File opener service initialized")
		} catch (error) {
			Logger.error("FileOpenerService.initialize", "Failed to initialize file opener service", error)
		}
	}

	/**
	 * Open a single file
	 */
	async openFile(request: OpenFileRequest): Promise<OpenFileResponse> {
		try {
			Logger.debug("FileOpenerService.openFile", `Opening file: ${request.filePath}`)

			// Check if file already exists in workspace
			const existingTab = this.findExistingTab(request.filePath)
			if (existingTab) {
				// Focus existing tab
				await vscode.window.showTextDocument(existingTab.document)

				return {
					success: true,
					fileBufferId: this.generateFileBufferId(request.filePath),
					isNewTab: false,
				}
			}

			// Check if file exists
			const uri = vscode.Uri.file(request.filePath)
			try {
				await vscode.workspace.fs.stat(uri)
			} catch (error) {
				if (request.createIfNotExists) {
					// Create file if it doesn't exist
					await vscode.workspace.fs.writeFile(uri, new Uint8Array())
					Logger.info("FileOpenerService.openFile", `Created new file: ${request.filePath}`)
				} else {
					return {
						success: false,
						error: "File does not exist",
					}
				}
			}

			// Open the document
			const document = await vscode.workspace.openTextDocument(uri)

			// Track the tab
			const fileBufferId = this.generateFileBufferId(request.filePath)
			this.activeTabs.set(fileBufferId, {
				uri,
				document,
			})

			// Show in appropriate view column
			if (request.action === "focus") {
				await vscode.window.showTextDocument(document, vscode.ViewColumn.One)
			} else if (request.action === "background") {
				await vscode.window.showTextDocument(document, vscode.ViewColumn.Two)
			} else {
				await vscode.window.showTextDocument(document)
			}

			Logger.info("FileOpenerService.openFile", `Opened file: ${request.filePath}`)

			return {
				success: true,
				fileBufferId,
				isNewTab: true,
			}
		} catch (error) {
			const errorMessage = `Failed to open file: ${error instanceof Error ? error.message : String(error)}`
			Logger.error("FileOpenerService.openFile", errorMessage, error)

			return {
				success: false,
				error: errorMessage,
			}
		}
	}

	/**
	 * Open multiple files
	 */
	async openMultipleFiles(filePaths: string[]): Promise<OpenMultipleFilesResponse> {
		try {
			Logger.debug("FileOpenerService.openMultipleFiles", `Opening ${filePaths.length} files`)

			const results = []

			for (const filePath of filePaths) {
				const result = await this.openFile({ filePath })
				results.push({
					filePath,
					success: result.success,
					isNewTab: result.isNewTab || false,
					error: result.error,
				})
			}

			const success = results.every((r) => r.success)

			Logger.info(
				"FileOpenerService.openMultipleFiles",
				`Opened ${results.filter((r) => r.success).length}/${filePaths.length} files successfully`,
			)

			return {
				success,
				results,
			}
		} catch (error) {
			const errorMessage = `Failed to open multiple files: ${error instanceof Error ? error.message : String(error)}`
			Logger.error("FileOpenerService.openMultipleFiles", errorMessage, error)

			return {
				success: false,
				results: [],
			}
		}
	}

	/**
	 * Close a file
	 */
	async closeFile(filePath: string): Promise<boolean> {
		try {
			Logger.debug("FileOpenerService.closeFile", `Closing file: ${filePath}`)

			const fileBufferId = this.generateFileBufferId(filePath)
			const tab = this.activeTabs.get(fileBufferId)

			if (tab) {
				// Close the document
				await tab.document.save()

				// Remove from tracking
				this.activeTabs.delete(fileBufferId)

				Logger.info("FileOpenerService.closeFile", `Closed file: ${filePath}`)
				return true
			}

			return false
		} catch (error) {
			Logger.error("FileOpenerService.closeFile", "Failed to close file", error)
			return false
		}
	}

	/**
	 * Get all open files
	 */
	getOpenFiles(): Array<{ filePath: string; fileBufferId: string }> {
		const files: Array<{ filePath: string; fileBufferId: string }> = []

		for (const [fileBufferId, tab] of this.activeTabs.entries()) {
			files.push({
				filePath: tab.uri.fsPath,
				fileBufferId,
			})
		}

		return files
	}

	/**
	 * Get file by path
	 */
	getFileByPath(filePath: string): { filePath: string; fileBufferId: string } | undefined {
		for (const [fileBufferId, tab] of this.activeTabs.entries()) {
			if (tab.uri.fsPath === filePath) {
				return {
					filePath,
					fileBufferId,
				}
			}
		}

		return undefined
	}

	/**
	 * Check if file is open
	 */
	isFileOpen(filePath: string): boolean {
		return this.activeTabs.has(this.generateFileBufferId(filePath))
	}

	/**
	 * Get active tab for file
	 */
	getActiveTab(filePath: string): vscode.TextEditor | undefined {
		const fileBufferId = this.generateFileBufferId(filePath)
		const tab = this.activeTabs.get(fileBufferId)
		return tab?.document
			? vscode.window.visibleTextEditors.find((editor) => editor.document === tab.document)
			: undefined
	}

	/**
	 * Find existing tab
	 */
	private findExistingTab(filePath: string): { uri: vscode.Uri; document: vscode.TextDocument } | undefined {
		for (const tab of vscode.window.tabGroups.all.flatMap((group) => group.tabs)) {
			if (tab.input instanceof vscode.TabInputText && tab.input.uri.fsPath === filePath) {
				const editor = vscode.window.visibleTextEditors.find((e) => e.document.uri.fsPath === filePath)
				if (editor) {
					return {
						uri: tab.input.uri,
						document: editor.document,
					}
				}
			}
		}

		return undefined
	}

	/**
	 * Restore existing tabs from workspace
	 */
	private async restoreExistingTabs(): Promise<void> {
		try {
			const visibleEditors = vscode.window.visibleTextEditors

			for (const editor of visibleEditors) {
				if (editor.document) {
					const filePath = editor.document.uri.fsPath
					const fileBufferId = this.generateFileBufferId(filePath)

					this.activeTabs.set(fileBufferId, {
						uri: editor.document.uri,
						document: editor.document,
					})
				}
			}

			Logger.info("FileOpenerService.restoreExistingTabs", `Restored ${this.activeTabs.size} existing tabs`)
		} catch (error) {
			Logger.error("FileOpenerService.restoreExistingTabs", "Failed to restore existing tabs", error)
		}
	}

	/**
	 * Generate file buffer ID
	 */
	private generateFileBufferId(filePath: string): string {
		return `buffer_${filePath.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}`
	}

	/**
	 * Handle workspace folders changed
	 */
	private onWorkspaceFoldersChanged(event: vscode.WorkspaceFoldersChangeEvent): void {
		Logger.debug("FileOpenerService.onWorkspaceFoldersChanged", "Workspace folders changed")

		// Re-detect workspace root
		const workspaceFolders = vscode.workspace.workspaceFolders
		this.workspaceRoot = workspaceFolders?.[0]?.uri.fsPath || ""
	}

	/**
	 * Handle document changed
	 */
	private onDocumentChanged(event: vscode.TextDocumentChangeEvent): void {
		Logger.debug("FileOpenerService.onDocumentChanged", `Document changed: ${event.document.uri.fsPath}`)

		// Update file state if document is saved
		if (event.document.isDirty === false) {
			const fileBufferId = this.generateFileBufferId(event.document.uri.fsPath)
			const tab = this.activeTabs.get(fileBufferId)

			if (tab) {
				// Update tab reference
				this.activeTabs.set(fileBufferId, {
					uri: tab.uri,
					document: event.document,
				})
			}
		}
	}

	/**
	 * Handle active editor changed
	 */
	private onActiveEditorChanged(editor: vscode.TextEditor | undefined): void {
		Logger.debug("FileOpenerService.onActiveEditorChanged", "Active editor changed")
	}

	/**
	 * Handle visible editors changed
	 */
	private onVisibleEditorsChanged(editors: readonly vscode.TextEditor[]): void {
		Logger.debug("FileOpenerService.onVisibleEditorsChanged", `Visible editors changed: ${editors.length} editors`)
	}
}
