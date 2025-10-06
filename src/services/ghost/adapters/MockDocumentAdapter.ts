import { GhostDocument, GhostPosition, GhostRange, GhostLineInfo } from "../types/platform-independent"
import { MockTextDocument } from "../../mocking/MockTextDocument"
import * as vscode from "vscode"

/**
 * Mock Document Adapter that implements GhostDocument interface
 * Wraps MockTextDocument to provide platform-independent interface for testing
 */
export class MockDocumentAdapter implements GhostDocument {
	constructor(private mockDoc: MockTextDocument) {}

	get uri(): string {
		return this.mockDoc.uri.toString()
	}

	get fileName(): string {
		return this.mockDoc.fileName
	}

	get languageId(): string {
		return this.mockDoc.languageId
	}

	get version(): number {
		return this.mockDoc.version
	}

	get lineCount(): number {
		return this.mockDoc.lineCount
	}

	get isDirty(): boolean {
		return this.mockDoc.isDirty
	}

	get isClosed(): boolean {
		return this.mockDoc.isClosed
	}

	getText(range?: GhostRange): string {
		if (!range) {
			return this.mockDoc.getText()
		}

		const vscodeRange = new vscode.Range(
			range.start.line,
			range.start.character,
			range.end.line,
			range.end.character,
		)
		return this.mockDoc.getText(vscodeRange)
	}

	lineAt(line: number): GhostLineInfo {
		const vscodeLine = this.mockDoc.lineAt(line)

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
		// MockTextDocument doesn't have validateRange, so we'll do basic validation
		const validatedRange = this.basicValidateRange(vscodeRange)
		return this.convertVSCodeRangeToGhost(validatedRange)
	}

	lineEndPosition(line: number): GhostPosition {
		if (line < 0 || line >= this.lineCount) {
			return { line: Math.max(0, Math.min(line, this.lineCount - 1)), character: 0 }
		}

		const lineInfo = this.lineAt(line)
		return {
			line: lineInfo.lineNumber,
			character: lineInfo.text.length,
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

	private basicValidateRange(range: vscode.Range): vscode.Range {
		// Basic validation for MockTextDocument
		const maxLine = Math.max(0, this.lineCount - 1)

		const startLine = Math.max(0, Math.min(range.start.line, maxLine))
		const endLine = Math.max(0, Math.min(range.end.line, maxLine))

		// Get actual line lengths for character validation
		const startLineLength = startLine < this.lineCount ? this.lineAt(startLine).text.length : 0
		const endLineLength = endLine < this.lineCount ? this.lineAt(endLine).text.length : 0

		const startChar = Math.max(0, Math.min(range.start.character, startLineLength))
		const endChar = Math.max(0, Math.min(range.end.character, endLineLength))

		return new vscode.Range(startLine, startChar, endLine, endChar)
	}
}
