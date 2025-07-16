import * as vscode from "vscode"

/**
 * A simulated vscode TextDocument for testing.
 */
export class MockTextDocument {
	private contentLines: string[]

	constructor(content: string) {
		this.contentLines = content.split("\n")
	}

	updateContent(newContent: string): void {
		this.contentLines = newContent.split("\n")
	}

	getText(range?: vscode.Range): string {
		if (!range) {
			return this.contentLines.join("\n")
		}

		const startLine = range.start.line
		const endLine = range.end.line

		if (startLine === endLine) {
			return this.contentLines[startLine].substring(range.start.character, range.end.character)
		}

		const lines: string[] = []
		for (let i = startLine; i <= endLine && i < this.contentLines.length; i++) {
			if (i === startLine) {
				lines.push(this.contentLines[i].substring(range.start.character))
			} else if (i === endLine) {
				lines.push(this.contentLines[i].substring(0, range.end.character))
			} else {
				lines.push(this.contentLines[i])
			}
		}

		return lines.join("\n")
	}

	get lineCount(): number {
		return this.contentLines.length
	}

	/**
	 * Returns information about a specific line in the document
	 * @param lineNumber The zero-based line number
	 * @returns A simplified TextLine object containing the text and position information
	 */
	lineAt(lineNumber: number): vscode.TextLine {
		if (lineNumber < 0 || lineNumber >= this.contentLines.length) {
			throw new Error(`Invalid line number: ${lineNumber}`)
		}

		const text = this.contentLines[lineNumber]
		const range = new vscode.Range(new vscode.Position(lineNumber, 0), new vscode.Position(lineNumber, text.length))

		return {
			text,
			range,
			lineNumber,
			rangeIncludingLineBreak: range,
			firstNonWhitespaceCharacterIndex: text.search(/\S|$/),
			isEmptyOrWhitespace: !/\S/.test(text),
		} as vscode.TextLine
	}
}
