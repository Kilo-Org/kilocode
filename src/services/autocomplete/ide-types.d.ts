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

// AIDIFF: Added IdeInfo interface to support getIdeInfo() method in the IDE abstraction layer.
// PLANREF: continue/core/index.d.ts (IdeInfo)
export interface IdeInfo {
	ideType: string // e.g., "vscode", "jetbrains"
	name: string // e.g., "Visual Studio Code"
	version: string // e.g., "1.85.1"
	remoteName?: string // e.g., "ssh-remote", undefined for local
	extensionVersion: string // Version of this extension
}
