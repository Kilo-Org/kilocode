// Minimal vscode mock for standalone tsx runner
// This directory doesn't use vitest, so needs its own lightweight mock

export type Thenable<T> = Promise<T>

export class Position {
	readonly line: number
	readonly character: number

	constructor(line: number, character: number) {
		this.line = line
		this.character = character
	}

	isEqual(other: Position): boolean {
		return this.line === other.line && this.character === other.character
	}

	isBefore(other: Position): boolean {
		if (this.line < other.line) return true
		if (this.line > other.line) return false
		return this.character < other.character
	}

	isAfter(other: Position): boolean {
		return !this.isEqual(other) && !this.isBefore(other)
	}

	isBeforeOrEqual(other: Position): boolean {
		return this.isBefore(other) || this.isEqual(other)
	}

	isAfterOrEqual(other: Position): boolean {
		return this.isAfter(other) || this.isEqual(other)
	}
}

export class Range {
	readonly start: Position
	readonly end: Position

	constructor(start: Position, end: Position)
	constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number)
	constructor(
		startOrStartLine: Position | number,
		endOrStartCharacter: Position | number,
		endLine?: number,
		endCharacter?: number,
	) {
		if (typeof startOrStartLine === "number") {
			this.start = new Position(startOrStartLine, endOrStartCharacter as number)
			this.end = new Position(endLine!, endCharacter!)
		} else {
			this.start = startOrStartLine as Position
			this.end = endOrStartCharacter as Position
		}
	}

	get isEmpty(): boolean {
		return this.start.isEqual(this.end)
	}

	get isSingleLine(): boolean {
		return this.start.line === this.end.line
	}

	contains(positionOrRange: Position | Range): boolean {
		if (positionOrRange instanceof Range) {
			return this.contains(positionOrRange.start) && this.contains(positionOrRange.end)
		}
		const position = positionOrRange as Position
		return position.isAfterOrEqual(this.start) && position.isBeforeOrEqual(this.end)
	}

	isEqual(other: Range): boolean {
		return this.start.isEqual(other.start) && this.end.isEqual(other.end)
	}
}

export class Uri {
	readonly scheme: string
	readonly authority: string
	readonly path: string
	readonly query: string
	readonly fragment: string

	constructor(scheme: string, authority: string, path: string, query: string, fragment: string) {
		this.scheme = scheme
		this.authority = authority
		this.path = path
		this.query = query
		this.fragment = fragment
	}

	static parse(value: string): Uri {
		const match = value.match(/^([^:]+):(?:\/\/([^\/]+))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/)
		if (!match) {
			throw new Error("Invalid URI")
		}
		return new Uri(match[1] || "", match[2] || "", match[3] || "", match[4] || "", match[5] || "")
	}

	static file(path: string): Uri {
		return new Uri("file", "", path, "", "")
	}

	toString(): string {
		let result = this.scheme + ":"
		if (this.authority) {
			result += "//" + this.authority
		}
		result += this.path
		if (this.query) {
			result += "?" + this.query
		}
		if (this.fragment) {
			result += "#" + this.fragment
		}
		return result
	}

	get fsPath(): string {
		return this.path
	}
}

export class Selection extends Range {
	readonly anchor: Position
	readonly active: Position

	constructor(anchor: Position, active: Position)
	constructor(anchorLine: number, anchorCharacter: number, activeLine: number, activeCharacter: number)
	constructor(
		anchorOrAnchorLine: Position | number,
		activeOrAnchorCharacter: Position | number,
		activeLine?: number,
		activeCharacter?: number,
	) {
		let anchor: Position
		let active: Position

		if (typeof anchorOrAnchorLine === "number") {
			anchor = new Position(anchorOrAnchorLine, activeOrAnchorCharacter as number)
			active = new Position(activeLine!, activeCharacter!)
		} else {
			anchor = anchorOrAnchorLine as Position
			active = activeOrAnchorCharacter as Position
		}

		super(anchor, active)
		this.anchor = anchor
		this.active = active
	}

	get isReversed(): boolean {
		return this.anchor.isAfter(this.active)
	}
}

export enum EndOfLine {
	LF = 1,
	CRLF = 2,
}

export enum DiagnosticSeverity {
	Error = 0,
	Warning = 1,
	Information = 2,
	Hint = 3,
}

export interface Diagnostic {
	range: Range
	message: string
	severity: DiagnosticSeverity
	source?: string
	code?: string | number
}

export interface TextLine {
	readonly lineNumber: number
	readonly text: string
	readonly range: Range
	readonly rangeIncludingLineBreak: Range
	readonly firstNonWhitespaceCharacterIndex: number
	readonly isEmptyOrWhitespace: boolean
}

export interface TextDocument {
	readonly uri: Uri
	readonly fileName: string
	readonly isUntitled: boolean
	readonly languageId: string
	readonly version: number
	readonly isDirty: boolean
	readonly isClosed: boolean
	readonly eol: EndOfLine
	readonly lineCount: number
	readonly encoding?: string
	readonly notebook?: any
	save(): Thenable<boolean>
	lineAt(line: number): TextLine
	lineAt(position: Position): TextLine
	offsetAt(position: Position): number
	positionAt(offset: number): Position
	getText(range?: Range): string
	getWordRangeAtPosition(position: Position, regex?: RegExp): Range | undefined
	validateRange(range: Range): Range
	validatePosition(position: Position): Position
}

export interface TextEditor {
	readonly document: TextDocument
	readonly selection: Selection
	readonly selections: readonly Selection[]
	readonly visibleRanges: readonly Range[]
	readonly options: any
	readonly viewColumn?: any
	edit(callback: (editBuilder: any) => void): Thenable<boolean>
}

export const workspace = {
	asRelativePath(pathOrUri: string | Uri, includeWorkspaceFolder?: boolean): string {
		const path = typeof pathOrUri === "string" ? pathOrUri : pathOrUri.path
		return path.split("/").pop() || path
	},
}
