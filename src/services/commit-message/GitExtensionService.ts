import * as vscode from "vscode"

export interface GitRepository {
	inputBox: { value: string }
	state: {
		indexChanges: Array<{
			uri: { fsPath: string }
			status: number
		}>
	}
}

export interface GitApi {
	repositories: GitRepository[]
}

export interface GitChange {
	filePath: string
	status: string
}

/**
 * Utility class for Git operations and integration
 */
export class GitExtensionService {
	private gitAPI: GitApi | null = null
	private activeRepository: GitRepository | null = null

	/**
	 * Initializes the Git extension and returns the API
	 */
	public async initializeGitExtension(): Promise<GitApi> {
		const gitExtension = vscode.extensions.getExtension("vscode.git")
		if (!gitExtension) {
			throw new Error("Git extension not found")
		}

		if (!gitExtension.isActive) {
			await gitExtension.activate()
		}

		this.gitAPI = gitExtension.exports.getAPI(1)
		if (!this.gitAPI) {
			throw new Error("Failed to get Git API")
		}
		return this.gitAPI
	}

	/**
	 * Gets the first available Git repository and stores it internally
	 * @private Internal implementation detail
	 */
	private getActiveRepository(): GitRepository | null {
		if (!this.gitAPI || this.gitAPI.repositories.length === 0) {
			this.activeRepository = null
			return null
		}
		this.activeRepository = this.gitAPI.repositories[0]
		return this.activeRepository
	}

	/**
	 * Ensures we have an active repository, fetching it if needed
	 * @private
	 */
	private ensureActiveRepository(): GitRepository | null {
		if (!this.activeRepository) {
			return this.getActiveRepository()
		}
		return this.activeRepository
	}

	/**
	 * Gathers context about staged changes in the active repository
	 */
	public async gatherStagedChanges(): Promise<GitChange[] | null> {
		const repository = this.ensureActiveRepository()
		if (!repository) {
			return null
		}

		const stagedChanges = repository.state.indexChanges
		if (!stagedChanges || stagedChanges.length === 0) {
			return null
		}

		const changes: GitChange[] = stagedChanges.map((change) => ({
			filePath: change.uri.fsPath,
			status: this.getChangeStatusText(change.status),
		}))

		return changes
	}

	/**
	 * Sets the commit message in the active repository's input box
	 */
	public setCommitMessage(message: string): void {
		const repository = this.ensureActiveRepository()
		if (!repository) {
			throw new Error("No active repository found")
		}
		repository.inputBox.value = message
	}

	/**
	 * Converts Git status number to readable text
	 */
	private getChangeStatusText(status: number): string {
		switch (status) {
			case 0:
				return "Untracked"
			case 1:
				return "Modified"
			case 2:
				return "Added"
			case 3:
				return "Deleted"
			case 4:
				return "Renamed"
			case 5:
				return "Copied"
			case 6:
				return "Updated"
			case 7:
				return "Unmerged"
			default:
				return "Unknown"
		}
	}
}
