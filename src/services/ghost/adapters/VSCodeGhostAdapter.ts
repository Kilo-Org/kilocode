import * as vscode from "vscode"
import {
	GhostEngineContext,
	GhostDocument,
	GhostPosition,
	GhostRange,
	GhostLineInfo,
} from "../types/platform-independent"
import { GhostEngineResult } from "../GhostEngine"
import { GhostSuggestionContext } from "../types"

/**
 * VSCode Document Adapter that implements GhostDocument interface
 * Wraps vscode.TextDocument to provide platform-independent interface
 */
export class VSCodeDocumentAdapter implements GhostDocument {
	constructor(private vscodeDoc: vscode.TextDocument) {}

	get uri(): string {
		return this.vscodeDoc.uri.toString()
	}

	get fileName(): string {
		return this.vscodeDoc.fileName
	}

	get languageId(): string {
		return this.vscodeDoc.languageId
	}

	get version(): number {
		return this.vscodeDoc.version
	}

	get lineCount(): number {
		return this.vscodeDoc.lineCount
	}

	get isDirty(): boolean {
		return this.vscodeDoc.isDirty
	}

	get isClosed(): boolean {
		return this.vscodeDoc.isClosed
	}

	getText(range?: GhostRange): string {
		if (!range) {
			return this.vscodeDoc.getText()
		}

		const vscodeRange = new vscode.Range(
			range.start.line,
			range.start.character,
			range.end.line,
			range.end.character,
		)
		return this.vscodeDoc.getText(vscodeRange)
	}

	lineAt(line: number): GhostLineInfo {
		const vscodeLine = this.vscodeDoc.lineAt(line)

		return {
			lineNumber: vscodeLine.lineNumber,
			text: vscodeLine.text,
			range: this.convertVSCodeRangeToGhost(vscodeLine.range),
			rangeIncludingLineBreak: this.convertVSCodeRangeToGhost(vscodeLine.rangeIncludingLineBreak),
			firstNonWhitespaceCharacterIndex: vscodeLine.firstNonWhitespaceCharacterIndex,
			isEmptyOrWhitespace: vscodeLine.isEmptyOrWhitespace,
		}
	}

	validateRange(range: GhostRange): GhostRange {
		const vscodeRange = this.convertGhostRangeToVSCode(range)
		const validatedVSCodeRange = this.vscodeDoc.validateRange(vscodeRange)
		return this.convertVSCodeRangeToGhost(validatedVSCodeRange)
	}

	lineEndPosition(line: number): GhostPosition {
		const vscodeLine = this.vscodeDoc.lineAt(line)
		return {
			line: vscodeLine.lineNumber,
			character: vscodeLine.text.length,
		}
	}

	private convertVSCodeRangeToGhost(vscodeRange: vscode.Range): GhostRange {
		return {
			start: { line: vscodeRange.start.line, character: vscodeRange.start.character },
			end: { line: vscodeRange.end.line, character: vscodeRange.end.character },
		}
	}

	private convertGhostRangeToVSCode(ghostRange: GhostRange): vscode.Range {
		return new vscode.Range(
			ghostRange.start.line,
			ghostRange.start.character,
			ghostRange.end.line,
			ghostRange.end.character,
		)
	}
}

/**
 * VSCode Ghost Adapter - Converts between VSCode types and platform-independent Ghost types
 * This enables the same GhostEngine to be used by VSCode extension
 */
export class VSCodeGhostAdapter {
	/**
	 * Convert VSCode-specific GhostSuggestionContext to platform-independent GhostEngineContext
	 */
	static toGhostEngineContext(vscodeContext: GhostSuggestionContext): GhostEngineContext {
		if (!vscodeContext.document) {
			throw new Error("Document is required in GhostSuggestionContext")
		}

		// Extract position - could be from range or current editor position
		let position: GhostPosition
		if (vscodeContext.range) {
			position = {
				line: vscodeContext.range.start.line,
				character: vscodeContext.range.start.character,
			}
		} else if (vscode.window.activeTextEditor) {
			const activePosition = vscode.window.activeTextEditor.selection.active
			position = {
				line: activePosition.line,
				character: activePosition.character,
			}
		} else {
			// Fallback to start of document
			position = { line: 0, character: 0 }
		}

		// Extract prefix and suffix from document and position
		const { prefix, suffix } = this.extractPrefixSuffix(vscodeContext.document, position)

		// Get workspace path
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
		const workspacePath = workspaceFolder ? workspaceFolder.uri.fsPath : ""

		return {
			document: new VSCodeDocumentAdapter(vscodeContext.document),
			position,
			prefix,
			suffix,
			language: vscodeContext.document.languageId,
			filepath: vscodeContext.document.fileName,
			workspacePath,
			userInput: vscodeContext.userInput,
			range: vscodeContext.range
				? {
						start: { line: vscodeContext.range.start.line, character: vscodeContext.range.start.character },
						end: { line: vscodeContext.range.end.line, character: vscodeContext.range.end.character },
					}
				: undefined,
		}
	}

	/**
	 * Convert GhostEngineResult back to VSCode-compatible result
	 * (Currently the result is already compatible, but this provides future extensibility)
	 */
	static fromGhostEngineResult(result: GhostEngineResult): GhostEngineResult {
		// For now, the result structure is already compatible
		// In the future, we might need to convert platform-independent types back to VSCode types
		return result
	}

	/**
	 * Extract prefix and suffix text from document at given position
	 */
	private static extractPrefixSuffix(
		document: vscode.TextDocument,
		position: GhostPosition,
	): { prefix: string; suffix: string } {
		const text = document.getText()
		const offset = document.offsetAt(new vscode.Position(position.line, position.character))

		const prefix = text.substring(0, offset)
		const suffix = text.substring(offset)

		return { prefix, suffix }
	}

	/**
	 * Helper to create GhostEngineContext from current VSCode editor state
	 */
	static fromCurrentEditor(userInput?: string): GhostEngineContext | null {
		const editor = vscode.window.activeTextEditor
		if (!editor) {
			return null
		}

		const document = editor.document
		const position = editor.selection.active
		const { prefix, suffix } = this.extractPrefixSuffix(document, {
			line: position.line,
			character: position.character,
		})

		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
		const workspacePath = workspaceFolder ? workspaceFolder.uri.fsPath : ""

		return {
			document: new VSCodeDocumentAdapter(document),
			position: { line: position.line, character: position.character },
			prefix,
			suffix,
			language: document.languageId,
			filepath: document.fileName,
			workspacePath,
			userInput,
		}
	}

	/**
	 * Convert VSCode Position to GhostPosition
	 */
	static convertPosition(vscodePosition: vscode.Position): GhostPosition {
		return {
			line: vscodePosition.line,
			character: vscodePosition.character,
		}
	}

	/**
	 * Convert GhostPosition to VSCode Position
	 */
	static convertPositionToVSCode(ghostPosition: GhostPosition): vscode.Position {
		return new vscode.Position(ghostPosition.line, ghostPosition.character)
	}

	/**
	 * Convert VSCode Range to GhostRange
	 */
	static convertRange(vscodeRange: vscode.Range): GhostRange {
		return {
			start: this.convertPosition(vscodeRange.start),
			end: this.convertPosition(vscodeRange.end),
		}
	}

	/**
	 * Convert GhostRange to VSCode Range
	 */
	static convertRangeToVSCode(ghostRange: GhostRange): vscode.Range {
		return new vscode.Range(
			this.convertPositionToVSCode(ghostRange.start),
			this.convertPositionToVSCode(ghostRange.end),
		)
	}
}
