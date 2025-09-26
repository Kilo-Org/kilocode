/**
 * JetBrains-specific types for commit message integration.
 * These types define the contract for communication between
 * the VSCode extension and JetBrains IDEs via RPC or other mechanisms.
 */

export type JetbrainsGenerationRequest = [workspacePath: string, selectedFiles: string[]]

/**
 * JetBrains RPC request structure for commit message generation.
 */
export interface JetBrainsCommitMessageRequest {
	/** The workspace path where the project is located */
	workspacePath: string

	/** Pre-selected files from JetBrains IDE (always provided) */
	selectedFiles: string[]

	/** Optional metadata about the request */
	metadata?: Record<string, any>
}

/**
 * JetBrains RPC response structure for commit message generation.
 */
export interface JetBrainsCommitMessageResponse {
	/** The generated commit message */
	message: string

	/** Error message if generation failed */
	error?: string

	/** Success status */
	success: boolean
}

/**
 * JetBrains progress update structure sent via RPC.
 */
export interface JetBrainsProgressUpdate {
	/** Current stage of the generation process */
	stage: string

	/** Progress percentage (0-100) */
	percentage: number

	/** Human-readable progress message */
	message?: string
}

/**
 * JetBrains notification structure sent via RPC.
 */
export interface JetBrainsNotification {
	/** Notification message */
	message: string

	/** Notification type */
	type: "info" | "error" | "warning"

	/** Optional title for the notification */
	title?: string
}
