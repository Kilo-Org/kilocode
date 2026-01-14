/**
 * Next Edit WebView Handlers
 *
 * Handles webview messages and coordinates with NextEditSession service.
 * This module manages the communication between the webview UI and the Next Edit backend.
 *
 * @module webviewHandlers
 */

import * as vscode from "vscode"
import { NextEditSession } from "./NextEditSession"
import { SessionStorage } from "./SessionStorage"
import { EditAnalyzer } from "./EditAnalyzer"
import { EditSequencer } from "./EditSequencer"
import { EditExecutor } from "./EditExecutor"

/**
 * Message types for Next Edit webview communication
 */
export type NextEditWebviewMessage =
	| {
			type: "nextEdit.start"
			goal: string
			includePatterns?: string[]
			excludePatterns?: string[]
			maxFiles?: number
	  }
	| { type: "nextEdit.accept" }
	| { type: "nextEdit.skip" }
	| { type: "nextEdit.undo" }
	| { type: "nextEdit.getProgress" }
	| { type: "nextEdit.endSession" }

/**
 * Response types for Next Edit webview communication
 */
export type NextEditWebviewResponse =
	| { type: "nextEdit.started"; sessionId: string; goal: string }
	| { type: "nextEdit.progress"; sessionId: string; progress: any }
	| { type: "nextEdit.edit"; sessionId: string; edit: any }
	| { type: "nextEdit.completed"; sessionId: string }
	| { type: "nextEdit.error"; sessionId?: string; error: string }

/**
 * Next Edit WebView Handler class
 */
export class NextEditWebviewHandler {
	private sessionService: NextEditSession
	private currentSessionId: string | null = null
	private currentEditId: string | null = null
	private context: vscode.ExtensionContext

	constructor(context: vscode.ExtensionContext) {
		this.context = context

		// Initialize services
		const storage = new SessionStorage(context)
		const analyzer = new EditAnalyzer(context)
		const sequencer = new EditSequencer()
		const executor = new EditExecutor(context)

		this.sessionService = new NextEditSession(context, storage, analyzer, sequencer, executor)
	}

	/**
	 * Handle webview message
	 */
	async handleMessage(
		message: NextEditWebviewMessage,
		webview: vscode.Webview,
	): Promise<NextEditWebviewResponse | null> {
		try {
			switch (message.type) {
				case "nextEdit.start":
					return await this.handleStart(message, webview)
				case "nextEdit.accept":
					return await this.handleAccept(webview)
				case "nextEdit.skip":
					return await this.handleSkip(webview)
				case "nextEdit.undo":
					return await this.handleUndo(webview)
				case "nextEdit.getProgress":
					return await this.handleGetProgress(webview)
				case "nextEdit.endSession":
					return await this.handleEndSession(webview)
				default:
					return { type: "nextEdit.error", error: `Unknown message type: ${(message as any).type}` }
			}
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error)
			return { type: "nextEdit.error", sessionId: this.currentSessionId || undefined, error: errorMsg }
		}
	}

	/**
	 * Handle start session message
	 */
	private async handleStart(
		message: Extract<NextEditWebviewMessage, { type: "nextEdit.start" }>,
		webview: vscode.Webview,
	): Promise<NextEditWebviewResponse> {
		// Get workspace URI
		const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
		if (!workspaceUri) {
			throw new Error("No workspace folder found")
		}

		// Start session
		const session = await this.sessionService.start(workspaceUri, message.goal, {
			includePatterns: message.includePatterns,
			excludePatterns: message.excludePatterns,
			maxFiles: message.maxFiles,
		})

		this.currentSessionId = session.id

		// Send response
		const response: NextEditWebviewResponse = {
			type: "nextEdit.started",
			sessionId: session.id,
			goal: message.goal,
		}

		// Get and send first edit
		await this.sendNextEdit(webview)

		return response
	}

	/**
	 * Handle accept edit message
	 */
	private async handleAccept(webview: vscode.Webview): Promise<NextEditWebviewResponse> {
		if (!this.currentSessionId || !this.currentEditId) {
			throw new Error("No active session or edit")
		}

		await this.sessionService.applyEdit(this.currentSessionId, this.currentEditId)

		// Send next edit or completion
		await this.sendNextEdit(webview)

		return {
			type: "nextEdit.progress",
			sessionId: this.currentSessionId,
			progress: await this.sessionService.getProgress(this.currentSessionId),
		}
	}

	/**
	 * Handle skip edit message
	 */
	private async handleSkip(webview: vscode.Webview): Promise<NextEditWebviewResponse> {
		if (!this.currentSessionId || !this.currentEditId) {
			throw new Error("No active session or edit")
		}

		await this.sessionService.skipEdit(this.currentSessionId, this.currentEditId)

		// Send next edit or completion
		await this.sendNextEdit(webview)

		return {
			type: "nextEdit.progress",
			sessionId: this.currentSessionId,
			progress: await this.sessionService.getProgress(this.currentSessionId),
		}
	}

	/**
	 * Handle undo message
	 */
	private async handleUndo(webview: vscode.Webview): Promise<NextEditWebviewResponse> {
		if (!this.currentSessionId) {
			throw new Error("No active session")
		}

		await this.sessionService.undoLastEdit(this.currentSessionId)

		// Send next edit
		await this.sendNextEdit(webview)

		return {
			type: "nextEdit.progress",
			sessionId: this.currentSessionId,
			progress: await this.sessionService.getProgress(this.currentSessionId),
		}
	}

	/**
	 * Handle get progress message
	 */
	private async handleGetProgress(webview: vscode.Webview): Promise<NextEditWebviewResponse> {
		if (!this.currentSessionId) {
			throw new Error("No active session")
		}

		const progress = await this.sessionService.getProgress(this.currentSessionId)
		return { type: "nextEdit.progress", sessionId: this.currentSessionId, progress }
	}

	/**
	 * Handle end session message
	 */
	private async handleEndSession(webview: vscode.Webview): Promise<NextEditWebviewResponse> {
		if (!this.currentSessionId) {
			throw new Error("No active session")
		}

		await this.sessionService.complete(this.currentSessionId)

		const response: NextEditWebviewResponse = {
			type: "nextEdit.completed",
			sessionId: this.currentSessionId,
		}

		this.currentSessionId = null
		this.currentEditId = null
		return response
	}

	/**
	 * Send next edit to webview
	 */
	private async sendNextEdit(webview: vscode.Webview): Promise<void> {
		if (!this.currentSessionId) {
			return
		}

		try {
			const { edit, context } = await this.sessionService.getNextEdit(this.currentSessionId)

			this.currentEditId = edit.id

			webview.postMessage({
				type: "nextEdit.edit",
				sessionId: this.currentSessionId,
				edit: { ...edit, context },
			})
		} catch (error) {
			// No more edits, session completed
			webview.postMessage({
				type: "nextEdit.completed",
				sessionId: this.currentSessionId,
			})
			this.currentSessionId = null
			this.currentEditId = null
		}
	}

	/**
	 * Get current session ID
	 */
	getCurrentSessionId(): string | null {
		return this.currentSessionId
	}

	/**
	 * Check if session is active
	 */
	isSessionActive(): boolean {
		return this.currentSessionId !== null
	}
}

/**
 * Global handler instance
 */
let globalHandler: NextEditWebviewHandler | null = null

/**
 * Get or create global handler instance
 */
export function getGlobalHandler(context: vscode.ExtensionContext): NextEditWebviewHandler {
	if (!globalHandler) {
		globalHandler = new NextEditWebviewHandler(context)
	}
	return globalHandler
}

/**
 * Reset global handler (for testing)
 */
export function resetGlobalHandler(): void {
	globalHandler = null
}
