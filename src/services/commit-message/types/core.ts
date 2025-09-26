import * as vscode from "vscode"

/**
 * Core request type for commit message generation.
 * Different IDEs provide different information in the request.
 */
export interface CommitMessageRequest {
	/** Always required - the workspace path where git operations occur */
	workspacePath: string

	/** JetBrains: always provided, VS Code: undefined (discovers files) */
	selectedFiles?: string[]
}

/**
 * Result of commit message generation attempt.
 */
export interface CommitMessageResult {
	/** The generated commit message (empty string if error occurred) */
	message: string

	/** Error message if generation failed */
	error?: string
}

/**
 * Parameters for pure message generation (IDE-agnostic).
 */
export interface GenerateMessageParams {
	/** The workspace path */
	workspacePath: string

	/** Always populated list of files to include in commit */
	selectedFiles: string[]

	/** Git context string containing diffs and file information */
	gitContext: string

	/** Optional callback for progress updates during generation */
	onProgress?: (progress: ProgressUpdate) => void
}

/**
 * Options for building AI prompts.
 */
export interface PromptOptions {
	/** Custom support prompts for specialized commit types */
	customSupportPrompts?: Record<string, string>

	/** Previous git context for context-aware generation */
	previousContext?: string

	/** Previous commit message for iterative improvement */
	previousMessage?: string
}

/**
 * Progress update information.
 */
export interface ProgressUpdate {
	/** Current stage of the generation process */
	stage: "file-discovery" | "git-context" | "ai-generation" | "completion"

	/** Human-readable progress message */
	message?: string

	/** Absolute percentage (0-100) */
	percentage?: number

	/** Incremental progress amount */
	increment?: number
}

/**
 * Progress task definition for IDE-specific progress reporting.
 */
export interface ProgressTask<T> {
	/** Function that executes the task with progress reporting */
	execute: (progress: ProgressReporter) => Promise<T>

	/** Title to display in progress UI */
	title: string

	/** Where to show the progress indicator */
	location: ProgressLocation

	/** Whether the task can be cancelled */
	cancellable?: boolean
}

/**
 * Progress reporter interface for IDE-specific implementations.
 */
export interface ProgressReporter {
	/** Report progress with optional message and increment */
	report(value: { message?: string; increment?: number }): void
}

/**
 * Message type for notifications.
 */
export type MessageType = "info" | "error" | "warning"

/**
 * Progress location for IDE-specific progress indicators.
 */
export type ProgressLocation = "SourceControl" | "Notification" | "Window"
