// kilocode_change - new file
import { CommitMessageRequest, CommitMessageResult } from "../types/core"

/**
 * Interface for IDE-specific commit message adapters.
 */
export interface ICommitMessageAdapter {
	/**
	 * Generate commit message handling file discovery, AI generation, and IDE integration.
	 */
	generateCommitMessage(request: CommitMessageRequest): Promise<CommitMessageResult>
}
