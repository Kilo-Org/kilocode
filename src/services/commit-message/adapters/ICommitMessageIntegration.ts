// kilocode_change - new file
import { GitChange } from "../GitExtensionService"
import { CommitMessageResult } from "../types/core"

/**
 * Interface for IDE-specific commit message integration operations.
 * Adapters implement this interface to provide platform-specific functionality.
 */
export interface ICommitMessageIntegration {
	/**
	 * Report progress to the IDE's progress system (optional)
	 */
	reportProgress?(percentage: number, message?: string): void

	/**
	 * Show messages to the user through the IDE's notification system (optional)
	 */
	showMessage?(message: string, type: "info" | "error" | "warning"): Promise<void>

	/**
	 * Handle the final result (e.g., set commit message in input box)
	 */
	handleResult(result: CommitMessageResult): Promise<void>
}
