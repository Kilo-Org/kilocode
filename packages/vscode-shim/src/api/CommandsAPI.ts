/**
 * CommandsAPI class for VSCode API
 */

import { logs } from "../utils/logger.js"
import { Uri } from "../classes/Uri.js"
import { Position } from "../classes/Position.js"
import { Range } from "../classes/Range.js"
import { Selection } from "../classes/Selection.js"
import { ViewColumn, EndOfLine } from "../types.js"
import type { Thenable } from "../types.js"
import type { TextEditor, TextEditorEdit } from "../interfaces/editor.js"
import type { TextDocument } from "../interfaces/document.js"
import type { Disposable } from "../interfaces/workspace.js"
import type { WorkspaceAPI } from "./WorkspaceAPI.js"
import type { WindowAPI } from "./WindowAPI.js"

/**
 * Commands API mock for CLI mode
 */
export class CommandsAPI {
	private commands: Map<string, (...args: unknown[]) => unknown> = new Map()

	registerCommand(command: string, callback: (...args: unknown[]) => unknown): Disposable {
		this.commands.set(command, callback)
		return {
			dispose: () => {
				this.commands.delete(command)
			},
		}
	}

	executeCommand<T = unknown>(command: string, ...rest: unknown[]): Thenable<T> {
		const handler = this.commands.get(command)
		if (handler) {
			try {
				const result = handler(...rest)
				return Promise.resolve(result as T)
			} catch (error) {
				return Promise.reject(error)
			}
		}

		// Handle built-in commands
		switch (command) {
			case "workbench.action.files.saveFiles":
			case "workbench.action.closeWindow":
			case "workbench.action.reloadWindow":
				return Promise.resolve(undefined as T)
			case "vscode.diff":
				// Simulate opening a diff view for the CLI
				// The extension's DiffViewProvider expects this to create a diff editor
				return this.handleDiffCommand(
					rest[0] as Uri,
					rest[1] as Uri,
					rest[2] as string | undefined,
					rest[3],
				) as Thenable<T>
			default:
				logs.warn(`Unknown command: ${command}`, "VSCode.Commands")
				return Promise.resolve(undefined as T)
		}
	}

	private async handleDiffCommand(
		originalUri: Uri,
		modifiedUri: Uri,
		title?: string,
		_options?: unknown,
	): Promise<void> {
		// The DiffViewProvider is waiting for the modified document to appear in visibleTextEditors
		// We need to simulate this by opening the document and adding it to visible editors

		logs.info(`[DIFF] Handling vscode.diff command`, "VSCode.Commands", {
			originalUri: originalUri?.toString(),
			modifiedUri: modifiedUri?.toString(),
			title,
		})

		if (!modifiedUri) {
			logs.warn("[DIFF] vscode.diff called without modified URI", "VSCode.Commands")
			return
		}

		// Get the workspace API to open the document
		const workspace = (global as unknown as { vscode?: { workspace?: WorkspaceAPI } }).vscode?.workspace
		const window = (global as unknown as { vscode?: { window?: WindowAPI } }).vscode?.window

		if (!workspace || !window) {
			logs.warn("[DIFF] VSCode APIs not available for diff command", "VSCode.Commands")
			return
		}

		logs.info(
			`[DIFF] Current visibleTextEditors count: ${window.visibleTextEditors?.length || 0}`,
			"VSCode.Commands",
		)

		try {
			// The document should already be open from the showTextDocument call
			// Find it in the existing textDocuments
			logs.info(`[DIFF] Looking for already-opened document: ${modifiedUri.fsPath}`, "VSCode.Commands")
			let document = workspace.textDocuments.find((doc: TextDocument) => doc.uri.fsPath === modifiedUri.fsPath)

			if (!document) {
				// If not found, open it now
				logs.info(`[DIFF] Document not found, opening: ${modifiedUri.fsPath}`, "VSCode.Commands")
				document = await workspace.openTextDocument(modifiedUri)
				logs.info(`[DIFF] Document opened successfully, lineCount: ${document.lineCount}`, "VSCode.Commands")
			} else {
				logs.info(`[DIFF] Found existing document, lineCount: ${document.lineCount}`, "VSCode.Commands")
			}

			// Create a mock editor for the diff view
			const mockEditor: TextEditor = {
				document,
				selection: new Selection(new Position(0, 0), new Position(0, 0)),
				selections: [new Selection(new Position(0, 0), new Position(0, 0))],
				visibleRanges: [new Range(new Position(0, 0), new Position(0, 0))],
				options: {},
				viewColumn: ViewColumn.One,
				edit: async (callback: (editBuilder: TextEditorEdit) => void) => {
					// Create a mock edit builder
					const editBuilder: TextEditorEdit = {
						replace: (_range: Range | Position | Selection, _text: string) => {
							// In CLI mode, we don't actually edit here
							// The DiffViewProvider will handle the actual edits
							logs.debug("Mock edit builder replace called", "VSCode.Commands")
						},
						insert: (_position: Position, _text: string) => {
							logs.debug("Mock edit builder insert called", "VSCode.Commands")
						},
						delete: (_range: Range | Selection) => {
							logs.debug("Mock edit builder delete called", "VSCode.Commands")
						},
						setEndOfLine: (_endOfLine: EndOfLine) => {
							logs.debug("Mock edit builder setEndOfLine called", "VSCode.Commands")
						},
					}
					callback(editBuilder)
					return true
				},
				insertSnippet: () => Promise.resolve(true),
				setDecorations: () => {},
				revealRange: () => {},
				show: () => {},
				hide: () => {},
			}

			// Add the editor to visible editors
			if (!window.visibleTextEditors) {
				window.visibleTextEditors = []
			}

			// Check if this editor is already in visibleTextEditors (from showTextDocument)
			const existingEditor = window.visibleTextEditors.find(
				(e: TextEditor) => e.document.uri.fsPath === modifiedUri.fsPath,
			)

			if (existingEditor) {
				logs.info(`[DIFF] Editor already in visibleTextEditors, updating it`, "VSCode.Commands")
				// Update the existing editor with the mock editor properties
				Object.assign(existingEditor, mockEditor)
			} else {
				logs.info(`[DIFF] Adding new mock editor to visibleTextEditors`, "VSCode.Commands")
				window.visibleTextEditors.push(mockEditor)
			}

			logs.info(`[DIFF] visibleTextEditors count: ${window.visibleTextEditors.length}`, "VSCode.Commands")

			// The onDidChangeVisibleTextEditors event was already fired by showTextDocument
			// We don't need to fire it again here
			logs.info(
				`[DIFF] Diff view simulation complete (events already fired by showTextDocument)`,
				"VSCode.Commands",
			)
		} catch (error) {
			logs.error("[DIFF] Error simulating diff view", "VSCode.Commands", { error })
		}
	}
}
