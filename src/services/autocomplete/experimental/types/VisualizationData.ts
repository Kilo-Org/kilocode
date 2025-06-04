import * as vscode from "vscode"

/**
 * Represents a location where the cursor might want to jump next
 */
export interface CursorJumpLocation {
	file: string // Relative file path
	line: number // 1-based line number
	column: number // 1-based column number
	confidence: number // 0-1 confidence score
	reason?: string // Optional explanation
	preview?: string // Code snippet preview
}

/**
 * Represents a predicted edit at a specific location
 */
export interface PredictedEdit {
	file: string // Relative file path
	startLine: number // 1-based start line
	endLine: number // 1-based end line
	startColumn?: number // Optional start column
	endColumn?: number // Optional end column
	originalContent?: string // Current content
	suggestedContent: string // Suggested replacement
	confidence: number // 0-1 confidence score
	editType: "insert" | "replace" | "delete"
	reason?: string // Optional explanation
}

/**
 * Represents edits in a related file
 */
export interface RelatedFileEdit {
	file: string // Relative file path
	edits: PredictedEdit[] // List of edits for this file
	priority: number // 0-1 priority score
	reason?: string // Why this file needs changes
}

/**
 * Context information for generating visualizations
 */
export interface VisualizationContext {
	currentFile: string
	currentPosition: vscode.Position
	recentEdits?: string[] // Recent edit history
	openFiles?: string[] // Currently open files
	projectContext?: any // Additional project context
}

/**
 * Combined response from the model containing all visualization types
 */
export interface AutocompleteVisualizationResponse {
	cursorJumps?: CursorJumpLocation[]
	predictedEdits?: PredictedEdit[]
	relatedFiles?: RelatedFileEdit[]
	metadata?: {
		modelConfidence: number
		processingTime: number
		contextUsed: string[]
	}
}
