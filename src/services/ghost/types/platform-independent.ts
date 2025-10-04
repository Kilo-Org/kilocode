/**
 * Platform-independent Ghost types following Continue.dev pattern
 *
 * These interfaces are designed to be compatible with VSCode types but can be
 * implemented by any platform (VSCode, JetBrains, Node.js, web, etc.)
 *
 * Key principle: Use simple, serializable data types that don't depend on
 * platform-specific APIs or objects.
 */

/**
 * Platform-independent diagnostic information
 */
export interface PlatformIndependentDiagnostic {
	message: string
	severity: "error" | "warning" | "info" | "hint"
	range: GhostRange
	source?: string
	code?: string | number
}

/**
 * Platform-independent suggestion context
 * This is the platform-independent equivalent of GhostSuggestionContext
 */
export interface PlatformIndependentGhostContext {
	document: GhostDocument
	position: GhostPosition
	range?: GhostRange
	prefix: string
	suffix: string
	language: string
	filepath: string
	workspacePath: string
	userInput?: string

	// Platform-independent equivalents of VSCode-specific fields
	openFiles?: GhostDocument[]
	diagnostics?: PlatformIndependentDiagnostic[]

	// Mercury Coder context (simplified)
	mercuryContext?: {
		recentlyViewedSnippets?: Array<{ filepath: string; content: string }>
		editHistory?: string[]
	}

	// Snippet context
	snippets?: any[] // Will be properly typed later

	// Recent operations (already platform-independent)
	recentOperations?: Array<{
		type: string
		description: string
		lineRange?: { start: number; end: number }
		affectedSymbol?: string
		scope?: string
		timestamp?: number
		content?: string
	}>
}

/**
 * Platform-independent position in a document
 * Compatible with vscode.Position interface
 */
export interface GhostPosition {
	/** Zero-based line number */
	line: number
	/** Zero-based character offset within the line */
	character: number
}

/**
 * Platform-independent range in a document
 * Compatible with vscode.Range interface
 */
export interface GhostRange {
	/** Start position of the range */
	start: GhostPosition
	/** End position of the range */
	end: GhostPosition
}

/**
 * Platform-independent document interface
 * Compatible with vscode.TextDocument interface methods used by Ghost
 */
export interface GhostDocument {
	/** Document URI as string (not platform-specific Uri object) */
	uri: string
	/** File name with extension */
	fileName: string
	/** Programming language identifier (e.g., "typescript", "javascript") */
	languageId: string
	/** Document version number for change tracking */
	version: number
	/** Total number of lines in the document */
	lineCount: number
	/** Whether the document has unsaved changes */
	isDirty: boolean
	/** Whether the document has been closed */
	isClosed: boolean

	/**
	 * Get text content of the document or a specific range
	 * @param range Optional range to get text from. If not provided, returns full document content
	 * @returns Text content as string
	 */
	getText(range?: GhostRange): string

	/**
	 * Get text content of a specific line
	 * @param line Zero-based line number
	 * @returns Line content as string
	 */
	lineAt(line: number): GhostLineInfo

	/**
	 * Get range that contains the entire document
	 * @returns Range from start to end of document
	 */
	validateRange(range: GhostRange): GhostRange

	/**
	 * Get position at the end of a given line
	 * @param line Zero-based line number
	 * @returns Position at end of line
	 */
	lineEndPosition(line: number): GhostPosition
}

/**
 * Information about a line in the document
 */
export interface GhostLineInfo {
	/** Line number (zero-based) */
	lineNumber: number
	/** Text content of the line */
	text: string
	/** Range that spans the entire line */
	range: GhostRange
	/** Range of the line excluding leading/trailing whitespace */
	rangeIncludingLineBreak: GhostRange
	/** First non-whitespace character position, or line end if line is empty */
	firstNonWhitespaceCharacterIndex: number
	/** Whether the line is empty or contains only whitespace */
	isEmptyOrWhitespace: boolean
}

/**
 * Platform-independent context for Ghost engine execution
 * This replaces GhostEngineContext with platform-independent types
 */
export interface GhostEngineContext {
	/** Document being processed */
	document: GhostDocument
	/** Current cursor/completion position */
	position: GhostPosition
	/** Text content before the cursor position */
	prefix: string
	/** Text content after the cursor position */
	suffix: string
	/** Programming language identifier */
	language: string
	/** File path as string */
	filepath: string
	/** Workspace root path as string */
	workspacePath: string
	/** Optional user input for context */
	userInput?: string
	/** Optional range for range-based completions */
	range?: GhostRange
}

/**
 * Platform-independent URI interface
 * Simple string-based alternative to vscode.Uri
 */
export interface GhostUri {
	/** File system path */
	fsPath: string
	/** URI scheme (file, http, etc.) */
	scheme: string
	/** String representation of the URI */
	toString(): string
}

/**
 * Helper functions for working with platform-independent types
 */
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace GhostTypes {
	/**
	 * Create a new GhostPosition
	 */
	export function createPosition(line: number, character: number): GhostPosition {
		return { line, character }
	}

	/**
	 * Create a new GhostRange
	 */
	export function createRange(start: GhostPosition, end: GhostPosition): GhostRange
	export function createRange(startLine: number, startChar: number, endLine: number, endChar: number): GhostRange
	export function createRange(
		startOrStartLine: GhostPosition | number,
		endOrStartChar: GhostPosition | number,
		endLine?: number,
		endChar?: number,
	): GhostRange {
		if (typeof startOrStartLine === "object") {
			return {
				start: startOrStartLine,
				end: endOrStartChar as GhostPosition,
			}
		} else {
			return {
				start: { line: startOrStartLine, character: endOrStartChar as number },
				end: { line: endLine!, character: endChar! },
			}
		}
	}

	/**
	 * Check if two positions are equal
	 */
	export function positionsEqual(a: GhostPosition, b: GhostPosition): boolean {
		return a.line === b.line && a.character === b.character
	}

	/**
	 * Check if two ranges are equal
	 */
	export function rangesEqual(a: GhostRange, b: GhostRange): boolean {
		return positionsEqual(a.start, b.start) && positionsEqual(a.end, b.end)
	}

	/**
	 * Check if a position is before another position
	 */
	export function positionIsBefore(a: GhostPosition, b: GhostPosition): boolean {
		return a.line < b.line || (a.line === b.line && a.character < b.character)
	}

	/**
	 * Check if a position is after another position
	 */
	export function positionIsAfter(a: GhostPosition, b: GhostPosition): boolean {
		return a.line > b.line || (a.line === b.line && a.character > b.character)
	}

	/**
	 * Check if a range contains a position
	 */
	export function rangeContains(range: GhostRange, position: GhostPosition): boolean {
		return !positionIsBefore(position, range.start) && positionIsBefore(position, range.end)
	}
}
