import * as vscode from "vscode"

/**
 * Interface for the comment processor options
 */
export interface CommentProcessorOptions {
	/** File URI being processed */
	fileUri: vscode.Uri
	/** Content of the file */
	content: string
	/** Language identifier of the file */
	languageId?: string
}

/**
 * Interface for AI comment data extracted from files
 */
export interface AICommentData {
	/** The comment content without the AI directive */
	content: string
	/** Start position of the comment in the document */
	startPos: vscode.Position
	/** End position of the comment in the document */
	endPos: vscode.Position
	/** The surrounding code context for better understanding */
	context?: string
	/** The file URI the comment was found in */
	fileUri: vscode.Uri
}

/**
 * Interface for comment processing result
 */
export interface CommentProcessingResult {
	/** List of AI comments found in the file */
	comments: AICommentData[]
	/** Any potential processing errors */
	errors?: Error[]
}

/**
 * Interface for AI response processing options
 */
export interface AIResponseOptions {
	/** The original AI comment data */
	commentData: AICommentData
	/** The AI-generated response */
	response: string
}

/**
 * Configuration options for WatchModeService
 */
export interface WatchModeConfig {
	/** The model to use for AI processing */
	model: string
	/** Prefix for AI comments (e.g., "KO!") */
	commentPrefix: string
}

/**
 * Type for API handler factory function
 */
export type ApiHandlerFactory = () => Promise<any>

export enum TriggerType {
	Edit = "edit",
	Ask = "ask",
}

export interface DiffBlock {
	type: "SEARCH" | "REPLACE"
	content: string
}

export interface DiffEdit {
	filePath: string
	blocks: DiffBlock[]
}

export interface AIResponse {
	edits: DiffEdit[]
	explanation: string
	triggerType: TriggerType
}
