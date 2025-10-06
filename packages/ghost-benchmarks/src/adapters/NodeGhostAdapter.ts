import {
	GhostEngineContext,
	GhostDocument,
	GhostPosition,
	GhostRange,
	GhostLineInfo,
	GhostTypes,
} from "../../../../src/services/ghost/types/platform-independent"
import { GhostEngineResult } from "../../../../src/services/ghost/GhostEngine"
import type { BenchmarkTestCase } from "../types/BenchmarkTypes"

// Simple Node.js implementations for benchmark environment compatible with VSCode interface
class SimplePosition {
	constructor(
		public readonly line: number,
		public readonly character: number,
	) {}

	isBefore(other: SimplePosition): boolean {
		return this.line < other.line || (this.line === other.line && this.character < other.character)
	}

	isBeforeOrEqual(other: SimplePosition): boolean {
		return this.line < other.line || (this.line === other.line && this.character <= other.character)
	}

	isAfter(other: SimplePosition): boolean {
		return !this.isBeforeOrEqual(other)
	}

	isAfterOrEqual(other: SimplePosition): boolean {
		return !this.isBefore(other)
	}

	isEqual(other: SimplePosition): boolean {
		return this.line === other.line && this.character === other.character
	}

	compareTo(other: SimplePosition): number {
		if (this.line < other.line) return -1
		if (this.line > other.line) return 1
		return this.character - other.character
	}

	translate(lineDelta?: number, characterDelta?: number): SimplePosition
	translate(change: { lineDelta?: number; characterDelta?: number }): SimplePosition
	translate(
		lineDeltaOrChange?: number | { lineDelta?: number; characterDelta?: number },
		characterDelta?: number,
	): SimplePosition {
		if (typeof lineDeltaOrChange === "object") {
			return new SimplePosition(
				this.line + (lineDeltaOrChange.lineDelta || 0),
				this.character + (lineDeltaOrChange.characterDelta || 0),
			)
		}
		return new SimplePosition(this.line + (lineDeltaOrChange || 0), this.character + (characterDelta || 0))
	}

	with(line?: number, character?: number): SimplePosition {
		return new SimplePosition(
			line !== undefined ? line : this.line,
			character !== undefined ? character : this.character,
		)
	}
}

class SimpleRange {
	constructor(
		public readonly start: SimplePosition,
		public readonly end: SimplePosition,
	) {}

	get isEmpty(): boolean {
		return this.start.isEqual(this.end)
	}

	get isSingleLine(): boolean {
		return this.start.line === this.end.line
	}

	contains(positionOrRange: SimplePosition | SimpleRange): boolean {
		if (positionOrRange instanceof SimplePosition) {
			return this.start.isBeforeOrEqual(positionOrRange) && this.end.isAfterOrEqual(positionOrRange)
		}
		return this.contains(positionOrRange.start) && this.contains(positionOrRange.end)
	}

	isEqual(other: SimpleRange): boolean {
		return this.start.isEqual(other.start) && this.end.isEqual(other.end)
	}

	intersection(range: SimpleRange): SimpleRange | undefined {
		const start = this.start.isAfter(range.start) ? this.start : range.start
		const end = this.end.isBefore(range.end) ? this.end : range.end
		if (start.isBeforeOrEqual(end)) {
			return new SimpleRange(start, end)
		}
		return undefined
	}

	union(other: SimpleRange): SimpleRange {
		const start = this.start.isBefore(other.start) ? this.start : other.start
		const end = this.end.isAfter(other.end) ? this.end : other.end
		return new SimpleRange(start, end)
	}

	with(start?: SimplePosition, end?: SimplePosition): SimpleRange {
		return new SimpleRange(start || this.start, end || this.end)
	}
}

class SimpleUri {
	public readonly scheme: string = "file"
	public readonly authority: string = ""
	public readonly path: string
	public readonly query: string = ""
	public readonly fragment: string = ""

	constructor(public readonly fsPath: string) {
		this.path = fsPath
	}

	static file(path: string): SimpleUri {
		return new SimpleUri(path)
	}

	toString(): string {
		return `file://${this.fsPath}`
	}

	toJSON(): any {
		return {
			scheme: this.scheme,
			authority: this.authority,
			path: this.path,
			query: this.query,
			fragment: this.fragment,
			fsPath: this.fsPath,
		}
	}

	with(change: { scheme?: string; authority?: string; path?: string; query?: string; fragment?: string }): SimpleUri {
		// Simple implementation - just return this for compatibility
		return this
	}
}

/**
 * Node.js Document Adapter that implements GhostDocument interface
 * Wraps MockTextDocument to provide platform-independent interface for benchmarks
 */
export class NodeDocumentAdapter implements GhostDocument {
	private lines: string[]

	constructor(
		private content: string,
		private filepath: string,
		private language: string = "plaintext",
	) {
		this.lines = content.split("\n")
	}

	get uri(): string {
		return `file://${this.filepath}`
	}

	get fileName(): string {
		return this.filepath
	}

	get languageId(): string {
		return this.language
	}

	get version(): number {
		return 1
	}

	get lineCount(): number {
		return this.lines.length
	}

	get isDirty(): boolean {
		return false
	}

	get isClosed(): boolean {
		return false
	}

	getText(range?: GhostRange): string {
		if (!range) {
			return this.content
		}

		const startLine = Math.max(0, Math.min(range.start.line, this.lines.length - 1))
		const endLine = Math.max(0, Math.min(range.end.line, this.lines.length - 1))

		if (startLine === endLine) {
			const line = this.lines[startLine] || ""
			const startChar = Math.max(0, range.start.character)
			const endChar = Math.min(line.length, range.end.character)
			return line.substring(startChar, endChar)
		}

		const result: string[] = []
		for (let i = startLine; i <= endLine; i++) {
			const line = this.lines[i] || ""
			if (i === startLine) {
				result.push(line.substring(Math.max(0, range.start.character)))
			} else if (i === endLine) {
				result.push(line.substring(0, Math.min(line.length, range.end.character)))
			} else {
				result.push(line)
			}
		}

		return result.join("\n")
	}

	lineAt(line: number): GhostLineInfo {
		const lineIndex = Math.max(0, Math.min(line, this.lines.length - 1))
		const text = this.lines[lineIndex] || ""

		return {
			lineNumber: lineIndex,
			text,
			range: {
				start: { line: lineIndex, character: 0 },
				end: { line: lineIndex, character: text.length },
			},
			rangeIncludingLineBreak: {
				start: { line: lineIndex, character: 0 },
				end: { line: lineIndex, character: text.length + 1 },
			},
			firstNonWhitespaceCharacterIndex: text.search(/\S/),
			isEmptyOrWhitespace: text.trim().length === 0,
		}
	}

	validateRange(range: GhostRange): GhostRange {
		// Simple validation - ensure range is within document bounds
		const validatedRange: GhostRange = {
			start: {
				line: Math.max(0, Math.min(range.start.line, this.lineCount - 1)),
				character: Math.max(0, range.start.character),
			},
			end: {
				line: Math.max(0, Math.min(range.end.line, this.lineCount - 1)),
				character: Math.max(0, range.end.character),
			},
		}

		// Ensure start comes before end
		if (
			validatedRange.start.line > validatedRange.end.line ||
			(validatedRange.start.line === validatedRange.end.line &&
				validatedRange.start.character > validatedRange.end.character)
		) {
			validatedRange.end = { ...validatedRange.start }
		}

		return validatedRange
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

	/**
	 * Convert a position to an offset in the document
	 */
	offsetAt(position: GhostPosition): number {
		const validatedPosition = this.validatePosition(position)
		let offset = 0

		// Add lengths of all lines before the target line
		for (let i = 0; i < validatedPosition.line; i++) {
			offset += this.lines[i].length + 1 // +1 for newline
		}

		// Add characters within the target line
		offset += validatedPosition.character

		return offset
	}

	/**
	 * Convert an offset to a position in the document
	 */
	positionAt(offset: number): GhostPosition {
		if (offset <= 0) {
			return { line: 0, character: 0 }
		}

		let remainingOffset = offset
		let line = 0

		// Find which line the offset falls on
		for (; line < this.lines.length; line++) {
			const lineLength = this.lines[line].length + 1 // +1 for newline
			if (remainingOffset <= lineLength) {
				break
			}
			remainingOffset -= lineLength
		}

		// Ensure we don't go beyond the last line
		if (line >= this.lines.length) {
			line = this.lines.length - 1
			remainingOffset = this.lines[line].length
		}

		return {
			line,
			character: Math.min(remainingOffset, this.lines[line].length),
		}
	}

	/**
	 * Validate a position to ensure it's within document bounds
	 */
	private validatePosition(position: GhostPosition): GhostPosition {
		const line = Math.max(0, Math.min(position.line, this.lineCount - 1))
		const lineText = this.lines[line] || ""
		const character = Math.max(0, Math.min(position.character, lineText.length))

		return { line, character }
	}
}

/**
 * Node.js Ghost Adapter - Converts benchmark test cases to platform-independent Ghost types
 * This enables the same GhostEngine to be used by benchmark system
 */
export class NodeGhostAdapter {
	/**
	 * Convert BenchmarkTestCase to platform-independent GhostEngineContext
	 */
	static toGhostEngineContext(testCase: BenchmarkTestCase, documentContent: string): GhostEngineContext {
		// Extract prefix and suffix from document and cursor position
		const { prefix, suffix } = this.extractPrefixSuffix(documentContent, testCase.cursorPosition)

		// Detect language from file extension
		const language = this.detectLanguage(testCase.activeFile)

		return {
			document: new NodeDocumentAdapter(documentContent, testCase.activeFile, language),
			position: {
				line: testCase.cursorPosition.line,
				character: testCase.cursorPosition.character,
			},
			prefix,
			suffix,
			language,
			filepath: testCase.activeFile,
			workspacePath: "/mock/workspace",
			userInput: undefined, // Benchmarks don't typically have user input
			range: GhostTypes.createRange(
				testCase.cursorPosition.line,
				testCase.cursorPosition.character,
				testCase.cursorPosition.line,
				testCase.cursorPosition.character,
			),
		}
	}

	/**
	 * Convert GhostEngineResult (already platform-independent) for benchmark use
	 */
	static fromGhostEngineResult(result: GhostEngineResult): GhostEngineResult {
		// Result is already platform-independent, no conversion needed
		return result
	}

	/**
	 * Extract prefix and suffix text from document at given position
	 */
	private static extractPrefixSuffix(
		documentText: string,
		position: GhostPosition,
	): { prefix: string; suffix: string } {
		const lines = documentText.split("\n")
		let offset = 0

		// Calculate offset to cursor position
		for (let i = 0; i < position.line && i < lines.length; i++) {
			offset += lines[i].length + 1 // +1 for newline
		}
		offset += position.character

		const prefix = documentText.substring(0, offset)
		const suffix = documentText.substring(offset)

		return { prefix, suffix }
	}

	/**
	 * Detect programming language from file extension
	 */
	private static detectLanguage(filepath: string): string {
		const ext = filepath.split(".").pop()?.toLowerCase() || ""

		const languageMap: Record<string, string> = {
			js: "javascript",
			jsx: "javascriptreact",
			ts: "typescript",
			tsx: "typescriptreact",
			py: "python",
			java: "java",
			c: "c",
			cpp: "cpp",
			cc: "cpp",
			cxx: "cpp",
			h: "c",
			hpp: "cpp",
			cs: "csharp",
			go: "go",
			rs: "rust",
			php: "php",
			rb: "ruby",
			swift: "swift",
			kt: "kotlin",
			scala: "scala",
			sh: "shellscript",
			bash: "shellscript",
			zsh: "shellscript",
			fish: "shellscript",
			ps1: "powershell",
			html: "html",
			htm: "html",
			css: "css",
			scss: "scss",
			sass: "sass",
			less: "less",
			json: "json",
			xml: "xml",
			yaml: "yaml",
			yml: "yaml",
			toml: "toml",
			ini: "ini",
			cfg: "ini",
			conf: "ini",
			md: "markdown",
			markdown: "markdown",
			txt: "plaintext",
		}

		return languageMap[ext] || "plaintext"
	}

	/**
	 * Create simple mock workspace setup for benchmarks
	 */
	static createMockWorkspace(): {
		addDocument: (filepath: string, content: string) => string
		getDocument: (filepath: string) => string | undefined
		clear: () => void
	} {
		const documents = new Map<string, string>()

		return {
			addDocument: (filepath: string, content: string): string => {
				documents.set(filepath, content)
				return content
			},

			getDocument: (filepath: string): string | undefined => {
				return documents.get(filepath)
			},

			clear: (): void => {
				documents.clear()
			},
		}
	}

	/**
	 * Helper to create a complete benchmark execution context
	 */
	static createBenchmarkContext(testCase: BenchmarkTestCase): {
		engineContext: GhostEngineContext
		mockDocument: string
		workspace: ReturnType<typeof NodeGhostAdapter.createMockWorkspace>
	} {
		const workspace = this.createMockWorkspace()

		// Add all input files to workspace
		for (const [filename, content] of Object.entries(testCase.inputFiles)) {
			workspace.addDocument(filename, content)
		}

		// Get the active document
		const mockDocument = workspace.getDocument(testCase.activeFile)
		if (!mockDocument) {
			throw new Error(`Active file not found: ${testCase.activeFile}`)
		}

		// Create engine context
		const engineContext = this.toGhostEngineContext(testCase, mockDocument)

		return {
			engineContext,
			mockDocument,
			workspace,
		}
	}
}
