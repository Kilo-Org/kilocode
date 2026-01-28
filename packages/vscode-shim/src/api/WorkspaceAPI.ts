/**
 * WorkspaceAPI class for VSCode API
 */

import * as fs from "fs"
import * as path from "path"
import { logs } from "../utils/logger.js"
import { Uri } from "../classes/Uri.js"
import { Position } from "../classes/Position.js"
import { Range } from "../classes/Range.js"
import { EventEmitter } from "../classes/EventEmitter.js"
import { WorkspaceEdit } from "../classes/TextEdit.js"
import { FileSystemAPI } from "./FileSystemAPI.js"
import { MockWorkspaceConfiguration } from "./WorkspaceConfiguration.js"
import type { ExtensionContextImpl } from "../context/ExtensionContext.js"
import type {
	TextDocument,
	TextLine,
	WorkspaceFoldersChangeEvent,
	WorkspaceFolder,
	TextDocumentChangeEvent,
	ConfigurationChangeEvent,
	TextDocumentContentProvider,
	FileSystemWatcher,
	RelativePattern,
} from "../interfaces/document.js"
import type { Disposable, WorkspaceConfiguration } from "../interfaces/workspace.js"
import type { Thenable } from "../types.js"

/**
 * Workspace API mock for CLI mode
 */
export class WorkspaceAPI {
	public workspaceFolders: WorkspaceFolder[] | undefined
	public name: string | undefined
	public workspaceFile: Uri | undefined
	public fs: FileSystemAPI
	public textDocuments: TextDocument[] = []
	private _onDidChangeWorkspaceFolders = new EventEmitter<WorkspaceFoldersChangeEvent>()
	private _onDidOpenTextDocument = new EventEmitter<TextDocument>()
	private _onDidChangeTextDocument = new EventEmitter<TextDocumentChangeEvent>()
	private _onDidCloseTextDocument = new EventEmitter<TextDocument>()
	private context: ExtensionContextImpl

	constructor(workspacePath: string, context: ExtensionContextImpl) {
		this.context = context
		this.workspaceFolders = [
			{
				uri: Uri.file(workspacePath),
				name: path.basename(workspacePath),
				index: 0,
			},
		]
		this.name = path.basename(workspacePath)
		this.fs = new FileSystemAPI()
	}

	asRelativePath(pathOrUri: string | Uri, includeWorkspaceFolder?: boolean): string {
		const fsPath = typeof pathOrUri === "string" ? pathOrUri : pathOrUri.fsPath

		// If no workspace folders, return the original path
		if (!this.workspaceFolders || this.workspaceFolders.length === 0) {
			return fsPath
		}

		// Try to find a workspace folder that contains this path
		for (const folder of this.workspaceFolders) {
			const workspacePath = folder.uri.fsPath

			// Normalize paths for comparison (handle different path separators)
			const normalizedFsPath = path.normalize(fsPath)
			const normalizedWorkspacePath = path.normalize(workspacePath)

			// Check if the path is within this workspace folder
			if (normalizedFsPath.startsWith(normalizedWorkspacePath)) {
				// Get the relative path
				let relativePath = path.relative(normalizedWorkspacePath, normalizedFsPath)

				// If includeWorkspaceFolder is true and there are multiple workspace folders,
				// prepend the workspace folder name
				if (includeWorkspaceFolder && this.workspaceFolders.length > 1) {
					relativePath = path.join(folder.name, relativePath)
				}

				return relativePath
			}
		}

		// If not within any workspace folder, return the original path
		return fsPath
	}

	onDidChangeWorkspaceFolders(listener: (event: WorkspaceFoldersChangeEvent) => void): Disposable {
		return this._onDidChangeWorkspaceFolders.event(listener)
	}

	onDidChangeConfiguration(listener: (event: ConfigurationChangeEvent) => void): Disposable {
		// Create a mock configuration change event emitter
		const emitter = new EventEmitter<ConfigurationChangeEvent>()
		return emitter.event(listener)
	}

	onDidChangeTextDocument(listener: (event: TextDocumentChangeEvent) => void): Disposable {
		return this._onDidChangeTextDocument.event(listener)
	}

	onDidOpenTextDocument(listener: (event: TextDocument) => void): Disposable {
		logs.debug("Registering onDidOpenTextDocument listener", "VSCode.Workspace")
		return this._onDidOpenTextDocument.event(listener)
	}

	onDidCloseTextDocument(listener: (event: TextDocument) => void): Disposable {
		return this._onDidCloseTextDocument.event(listener)
	}

	getConfiguration(section?: string): WorkspaceConfiguration {
		return new MockWorkspaceConfiguration(section, this.context)
	}

	findFiles(_include: string, _exclude?: string): Thenable<Uri[]> {
		// Basic implementation - could be enhanced with glob patterns
		return Promise.resolve([])
	}

	async openTextDocument(uri: Uri): Promise<TextDocument> {
		logs.debug(`openTextDocument called for: ${uri.fsPath}`, "VSCode.Workspace")

		// Read file content
		let content = ""
		try {
			content = fs.readFileSync(uri.fsPath, "utf-8")
			logs.debug(`File content read successfully, length: ${content.length}`, "VSCode.Workspace")
		} catch (error) {
			logs.warn(`Failed to read file: ${uri.fsPath}`, "VSCode.Workspace", { error })
		}

		const lines = content.split("\n")
		const document: TextDocument = {
			uri,
			fileName: uri.fsPath,
			languageId: "plaintext",
			version: 1,
			isDirty: false,
			isClosed: false,
			lineCount: lines.length,
			getText: (range?: Range) => {
				if (!range) {
					return content
				}
				return lines.slice(range.start.line, range.end.line + 1).join("\n")
			},
			lineAt: (line: number): TextLine => {
				const text = lines[line] || ""
				return {
					text,
					range: new Range(new Position(line, 0), new Position(line, text.length)),
					rangeIncludingLineBreak: new Range(new Position(line, 0), new Position(line + 1, 0)),
					firstNonWhitespaceCharacterIndex: text.search(/\S/),
					isEmptyOrWhitespace: text.trim().length === 0,
				}
			},
			offsetAt: (position: Position) => {
				let offset = 0
				for (let i = 0; i < position.line && i < lines.length; i++) {
					offset += (lines[i]?.length || 0) + 1 // +1 for newline
				}
				offset += position.character
				return offset
			},
			positionAt: (offset: number) => {
				let currentOffset = 0
				for (let i = 0; i < lines.length; i++) {
					const lineLength = (lines[i]?.length || 0) + 1 // +1 for newline
					if (currentOffset + lineLength > offset) {
						return new Position(i, offset - currentOffset)
					}
					currentOffset += lineLength
				}
				return new Position(lines.length - 1, lines[lines.length - 1]?.length || 0)
			},
			save: () => Promise.resolve(true),
			validateRange: (range: Range) => range,
			validatePosition: (position: Position) => position,
		}

		// Add to textDocuments array
		this.textDocuments.push(document)
		logs.debug(`Document added to textDocuments array, total: ${this.textDocuments.length}`, "VSCode.Workspace")

		// Fire the event after a small delay to ensure listeners are fully registered
		logs.debug("Waiting before firing onDidOpenTextDocument", "VSCode.Workspace")
		await new Promise((resolve) => setTimeout(resolve, 10))
		logs.debug("Firing onDidOpenTextDocument event", "VSCode.Workspace")
		this._onDidOpenTextDocument.fire(document)
		logs.debug("onDidOpenTextDocument event fired", "VSCode.Workspace")

		return document
	}

	async applyEdit(edit: WorkspaceEdit): Promise<boolean> {
		// In CLI mode, we need to apply the edits to the actual files
		try {
			for (const [uri, edits] of edit.entries()) {
				let filePath = uri.fsPath

				// On Windows, strip leading slash if present (e.g., /C:/path becomes C:/path)
				if (process.platform === "win32" && filePath.startsWith("/")) {
					filePath = filePath.slice(1)
				}

				let content = ""

				// Read existing content if file exists
				try {
					content = fs.readFileSync(filePath, "utf-8")
				} catch {
					// File doesn't exist, start with empty content
				}

				// Apply edits in reverse order to maintain correct positions
				const sortedEdits = edits.sort((a, b) => {
					const lineDiff = b.range.start.line - a.range.start.line
					if (lineDiff !== 0) return lineDiff
					return b.range.start.character - a.range.start.character
				})

				const lines = content.split("\n")
				for (const textEdit of sortedEdits) {
					const startLine = textEdit.range.start.line
					const startChar = textEdit.range.start.character
					const endLine = textEdit.range.end.line
					const endChar = textEdit.range.end.character

					if (startLine === endLine) {
						// Single line edit
						const line = lines[startLine] || ""
						lines[startLine] = line.substring(0, startChar) + textEdit.newText + line.substring(endChar)
					} else {
						// Multi-line edit
						const firstLine = lines[startLine] || ""
						const lastLine = lines[endLine] || ""
						const newContent =
							firstLine.substring(0, startChar) + textEdit.newText + lastLine.substring(endChar)
						lines.splice(startLine, endLine - startLine + 1, newContent)
					}
				}

				// Write back to file
				const newContent = lines.join("\n")
				fs.writeFileSync(filePath, newContent, "utf-8")

				// Update the in-memory document object to reflect the new content
				// This is critical for CLI mode where DiffViewProvider reads from the document object
				const document = this.textDocuments.find((doc: TextDocument) => doc.uri.fsPath === filePath)
				if (document) {
					const newLines = newContent.split("\n")

					// Update document properties with new content
					document.lineCount = newLines.length
					document.getText = (range?: Range) => {
						if (!range) {
							return newContent
						}
						return newLines.slice(range.start.line, range.end.line + 1).join("\n")
					}
					document.lineAt = (line: number): TextLine => {
						const text = newLines[line] || ""
						return {
							text,
							range: new Range(new Position(line, 0), new Position(line, text.length)),
							rangeIncludingLineBreak: new Range(new Position(line, 0), new Position(line + 1, 0)),
							firstNonWhitespaceCharacterIndex: text.search(/\S/),
							isEmptyOrWhitespace: text.trim().length === 0,
						}
					}
					document.offsetAt = (position: Position) => {
						let offset = 0
						for (let i = 0; i < position.line && i < newLines.length; i++) {
							offset += (newLines[i]?.length || 0) + 1 // +1 for newline
						}
						offset += position.character
						return offset
					}
					document.positionAt = (offset: number) => {
						let currentOffset = 0
						for (let i = 0; i < newLines.length; i++) {
							const lineLength = (newLines[i]?.length || 0) + 1 // +1 for newline
							if (currentOffset + lineLength > offset) {
								return new Position(i, offset - currentOffset)
							}
							currentOffset += lineLength
						}
						return new Position(newLines.length - 1, newLines[newLines.length - 1]?.length || 0)
					}
				}
			}
			return true
		} catch (error) {
			logs.error("Failed to apply workspace edit", "VSCode.Workspace", { error })
			return false
		}
	}

	createFileSystemWatcher(
		_globPattern?: string | RelativePattern,
		_ignoreCreateEvents?: boolean,
		_ignoreChangeEvents?: boolean,
		_ignoreDeleteEvents?: boolean,
	): FileSystemWatcher {
		const emitter = new EventEmitter<Uri>()
		return {
			onDidChange: (listener: (e: Uri) => void) => emitter.event(listener),
			onDidCreate: (listener: (e: Uri) => void) => emitter.event(listener),
			onDidDelete: (listener: (e: Uri) => void) => emitter.event(listener),
			dispose: () => emitter.dispose(),
		}
	}

	registerTextDocumentContentProvider(_scheme: string, _provider: TextDocumentContentProvider): Disposable {
		return { dispose: () => {} }
	}
}
