/**
 * Type definitions for Task-related metadata
 */

/**
 * GPT-5 specific metadata stored with assistant messages
 * for maintaining conversation continuity across requests
 */
export interface Gpt5Metadata {
	/**
	 * The response ID from the previous GPT-5 API response
	 * Used to maintain conversation continuity in subsequent requests
	 */
	previous_response_id?: string
}

/**
 * Extended ClineMessage type with GPT-5 metadata
 */
export interface ClineMessageWithMetadata {
	metadata?: {
		gpt5?: Gpt5Metadata
		[key: string]: any
	}
}
