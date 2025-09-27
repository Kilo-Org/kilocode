import { LLMClient } from "./llm-client.js"
import { AutoTriggerStrategy } from "./auto-trigger-strategy-standalone.js"
import { GhostSuggestionContext } from "./types.js"
import * as vscode from "./mock-vscode.js"

const CURSOR_MARKER = "<<<AUTOCOMPLETE_HERE>>>"

/**
 * Mock TextDocument implementation for testing
 */
class MockTextDocument implements vscode.TextDocument {
	private _text: string
	private _languageId: string

	constructor(text: string, languageId: string = "javascript") {
		this._text = text
		this._languageId = languageId
	}

	get uri(): vscode.Uri {
		return vscode.Uri.parse("file:///test.js")
	}

	get fileName(): string {
		return "test.js"
	}

	get isUntitled(): boolean {
		return false
	}

	get languageId(): string {
		return this._languageId
	}

	get version(): number {
		return 1
	}

	get isDirty(): boolean {
		return false
	}

	get isClosed(): boolean {
		return false
	}

	get eol(): vscode.EndOfLine {
		return vscode.EndOfLine.LF
	}

	get lineCount(): number {
		return this._text.split("\n").length
	}

	get encoding(): string {
		return "utf8"
	}

	save(): Promise<boolean> {
		return Promise.resolve(true)
	}

	lineAt(lineOrPosition: number | vscode.Position): vscode.TextLine {
		const lineNumber = typeof lineOrPosition === "number" ? lineOrPosition : lineOrPosition.line
		const lines = this._text.split("\n")
		const text = lines[lineNumber] || ""

		return {
			lineNumber,
			text,
			range: new vscode.Range(lineNumber, 0, lineNumber, text.length),
			rangeIncludingLineBreak: new vscode.Range(lineNumber, 0, lineNumber + 1, 0),
			firstNonWhitespaceCharacterIndex: text.search(/\S/),
			isEmptyOrWhitespace: text.trim().length === 0,
		}
	}

	offsetAt(position: vscode.Position): number {
		const lines = this._text.split("\n")
		let offset = 0

		for (let i = 0; i < position.line; i++) {
			offset += lines[i].length + 1 // +1 for newline
		}

		offset += position.character
		return offset
	}

	positionAt(offset: number): vscode.Position {
		const lines = this._text.split("\n")
		let currentOffset = 0

		for (let i = 0; i < lines.length; i++) {
			const lineLength = lines[i].length + 1
			if (currentOffset + lineLength > offset) {
				return new vscode.Position(i, offset - currentOffset)
			}
			currentOffset += lineLength
		}

		return new vscode.Position(lines.length - 1, lines[lines.length - 1].length)
	}

	getText(range?: vscode.Range): string {
		if (!range) return this._text

		const startOffset = this.offsetAt(range.start)
		const endOffset = this.offsetAt(range.end)
		return this._text.substring(startOffset, endOffset)
	}

	getWordRangeAtPosition(position: vscode.Position, regex?: RegExp): vscode.Range | undefined {
		const line = this.lineAt(position).text
		const wordPattern = regex || /\b\w+\b/g

		let match
		while ((match = wordPattern.exec(line)) !== null) {
			const start = match.index
			const end = start + match[0].length

			if (position.character >= start && position.character <= end) {
				return new vscode.Range(position.line, start, position.line, end)
			}
		}

		return undefined
	}

	validateRange(range: vscode.Range): vscode.Range {
		return range
	}

	validatePosition(position: vscode.Position): vscode.Position {
		return position
	}
}

export class AutoTriggerStrategyTester {
	private llmClient: LLMClient
	private strategy: AutoTriggerStrategy

	constructor(llmClient: LLMClient) {
		this.llmClient = llmClient
		this.strategy = new AutoTriggerStrategy()
	}

	/**
	 * Converts test input to GhostSuggestionContext
	 */
	private createContext(code: string, cursorPosition: { line: number; character: number }): GhostSuggestionContext {
		// Insert cursor marker into the code at the specified position
		const lines = code.split("\n")
		const line = lines[cursorPosition.line]
		lines[cursorPosition.line] =
			line.slice(0, cursorPosition.character) + CURSOR_MARKER + line.slice(cursorPosition.character)
		const codeWithMarker = lines.join("\n")

		const document = new MockTextDocument(codeWithMarker)
		const position = new vscode.Position(cursorPosition.line, cursorPosition.character)
		const range = new vscode.Range(position, position)

		return {
			document,
			range,
			recentOperations: [],
			diagnostics: [],
			openFiles: [],
			userInput: undefined,
			rangeASTNode: undefined,
		}
	}

	getSystemInstructions(): string {
		// Use the actual strategy's system instructions
		return this.strategy.getSystemInstructions()
	}

	buildUserPrompt(code: string, cursorPosition: { line: number; character: number }): string {
		const context = this.createContext(code, cursorPosition)
		return this.strategy.getUserPrompt(context)
	}

	async getCompletion(code: string, cursorPosition: { line: number; character: number }): Promise<string> {
		const systemPrompt = this.getSystemInstructions()
		const userPrompt = this.buildUserPrompt(code, cursorPosition)

		const response = await this.llmClient.sendPrompt(systemPrompt, userPrompt)
		return response.content
	}

	parseCompletion(xmlResponse: string): { search: string; replace: string }[] {
		const changes: { search: string; replace: string }[] = []

		// Parse XML response to extract change blocks
		const changeRegex =
			/<change>\s*<search><!\[CDATA\[(.*?)\]\]><\/search>\s*<replace><!\[CDATA\[(.*?)\]\]><\/replace>\s*<\/change>/gs

		let match
		while ((match = changeRegex.exec(xmlResponse)) !== null) {
			changes.push({
				search: match[1],
				replace: match[2],
			})
		}

		return changes
	}
}
