//PLANREF: continue/core/autocomplete/types.ts
//PLANREF: continue/core/index.d.ts
export interface Location {
	filepath: string
	position: Position
}

export interface FileWithContents {
	filepath: string
	contents: string
}

export interface Range {
	start: Position
	end: Position
}

export interface Position {
	line: number
	character: number
}

export interface FileEdit {
	filepath: string
	range: Range
	replacement: string
}

export interface RangeInFile {
	filepath: string
	range: Range
}

export interface FileWithContents {
	filepath: string
	contents: string
}

export interface RangeInFileWithContents {
	filepath: string
	range: {
		start: { line: number; character: number }
		end: { line: number; character: number }
	}
	contents: string
}
export interface SymbolWithRange extends RangeInFile {
	name: string
	type: Parser.SyntaxNode["type"]
	content: string
}

export type FileSymbolMap = Record<string, SymbolWithRange[]>

export interface RecentlyEditedRange {
	filepath: string
	range: Range
	// lines: string[]; // We might not need to store full lines, content can be derived
	// symbols: Set<string>; // Symbols can be derived if needed
	timestamp: number
	// Store the actual content of the range for easier use
	contents: string
}
