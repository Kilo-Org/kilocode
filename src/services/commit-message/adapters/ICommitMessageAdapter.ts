import { CommitMessageRequest, CommitMessageResult } from "../types/core"

/**
 * Simplified interface for IDE-specific commit message adapters.
 * Each adapter handles everything internally: file discovery/validation,
 * progress reporting, AI generation, and message setting.
 */
export interface ICommitMessageAdapter {
	/**
	 * Generate a commit message for the given request.
	 * This handles the complete flow internally:
	 * - File selection/discovery (VS Code) or validation (JetBrains)
	 * - Progress reporting during generation
	 * - Calling the AI to generate the message
	 * - Setting the message in the appropriate IDE location
	 */
	generateCommitMessage(request: CommitMessageRequest): Promise<CommitMessageResult>
}
