/**
 * Tool parameter type definitions for native protocol
 */

/**
 * Read mode for the read_file tool.
 * - "slice": Simple offset/limit reading (default)
 * - "indentation": Semantic block extraction based on code structure
 */
export type ReadFileMode = "slice" | "indentation"

/**
 * Indentation-mode configuration for the read_file tool.
 */
export interface IndentationParams {
	/** 1-based line number to anchor indentation extraction (defaults to offset) */
	anchor_line?: number
	/** Maximum indentation levels to include above anchor (0 = unlimited) */
	max_levels?: number
	/** Include sibling blocks at the same indentation level */
	include_siblings?: boolean
	/** Include file header (imports, comments at top) */
	include_header?: boolean
	/** Hard cap on lines returned for indentation mode */
	max_lines?: number
}

/**
 * Parameters for the read_file tool (new format).
 *
 * NOTE: This is the canonical, single-file-per-call shape.
 */
export interface ReadFileParams {
	/** Path to the file, relative to workspace */
	path: string
	/** Reading mode: "slice" (default) or "indentation" */
	mode?: ReadFileMode
	/** 1-based line number to start reading from (slice mode, default: 1) */
	offset?: number
	/** Maximum number of lines to read (default: 2000) */
	limit?: number
	/** Indentation-mode configuration (only used when mode === "indentation") */
	indentation?: IndentationParams
}

// ─── Legacy Format Types (Backward Compatibility) ─────────────────────────────

/**
 * Line range specification for legacy read_file format.
 * Represents a contiguous range of lines [start, end] (1-based, inclusive).
 */
export interface LineRange {
	start: number
	end: number
}

/**
 * File entry for legacy read_file format.
 * Supports reading multiple disjoint line ranges from a single file.
 */
export interface FileEntry {
	/** Path to the file, relative to workspace */
	path: string
	/** Optional list of line ranges to read (if omitted, reads entire file) */
	lineRanges?: LineRange[]
}

/**
 * Legacy parameters for the read_file tool (pre-refactor format).
 * Supports reading multiple files in a single call with optional line ranges.
 *
 * @deprecated Use ReadFileParams instead. This format is maintained for
 * backward compatibility with existing chat histories.
 */
export interface LegacyReadFileParams {
	/** Array of file entries to read */
	files: FileEntry[]
	/** Discriminant flag for type narrowing */
	_legacyFormat: true
}

/**
 * Union type for read_file tool parameters.
 * Supports both new single-file format and legacy multi-file format.
 */
export type ReadFileToolParams = ReadFileParams | LegacyReadFileParams

/**
 * Type guard to check if params are in legacy format.
 */
export function isLegacyReadFileParams(params: ReadFileToolParams): params is LegacyReadFileParams {
	return "_legacyFormat" in params && params._legacyFormat === true
}

export interface Coordinate {
	x: number
	y: number
}

export interface Size {
	width: number
	height: number
}

export interface BrowserActionParams {
	action: "launch" | "click" | "hover" | "type" | "scroll_down" | "scroll_up" | "resize" | "close" | "screenshot"
	url?: string
	coordinate?: Coordinate
	size?: Size
	text?: string
	path?: string
}

export interface GenerateImageParams {
	prompt: string
	path: string
	image?: string
}
