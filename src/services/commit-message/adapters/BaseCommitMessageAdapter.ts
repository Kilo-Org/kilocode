// kilocode_change - new file
import { GitExtensionService } from "../GitExtensionService"

/**
 * Base adapter providing shared Git service management.
 */
export abstract class BaseCommitMessageAdapter {
	protected gitService: GitExtensionService | null = null
	protected currentWorkspaceRoot: string | null = null

	protected initializeGitService(workspacePath: string): GitExtensionService {
		if (this.currentWorkspaceRoot !== workspacePath) {
			this.gitService?.dispose()
			this.gitService = new GitExtensionService(workspacePath)
			this.currentWorkspaceRoot = workspacePath
		}

		if (!this.gitService) {
			throw new Error("Failed to initialize Git service")
		}

		return this.gitService
	}

	public dispose(): void {
		this.gitService?.dispose()
		this.gitService = null
		this.currentWorkspaceRoot = null
	}
}
