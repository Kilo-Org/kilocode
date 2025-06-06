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

export interface GitAPI {
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
	private gitAPI: GitAPI | null = null

	/**
	 * Initializes the Git extension and returns the API
	 */
	public async initializeGitExtension(): Promise<GitAPI> {
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
	 * Gets the first available Git repository
	 */
	public getActiveRepository(): GitRepository | null {
		if (!this.gitAPI || this.gitAPI.repositories.length === 0) {
			return null
		}
		return this.gitAPI.repositories[0]
	}

	/**
	 * Gathers context about staged changes in the repository
	 */
	public async gatherStagedChanges(repository: GitRepository): Promise<string | null> {
		const stagedChanges = repository.state.indexChanges
		if (!stagedChanges || stagedChanges.length === 0) {
			return null
		}

		const changes: GitChange[] = stagedChanges.map((change) => ({
			filePath: change.uri.fsPath,
			status: this.getChangeStatusText(change.status),
		}))

		return this.formatChangesForAI(changes)
	}

	/**
	 * Sets the commit message in the repository's input box
	 */
	public setCommitMessage(repository: GitRepository, message: string): void {
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

	/**
	 * Formats changes for AI consumption
	 */
	private formatChangesForAI(changes: GitChange[]): string {
		const changesByType = changes.reduce(
			(acc, change) => {
				if (!acc[change.status]) {
					acc[change.status] = []
				}
				acc[change.status].push(change.filePath)
				return acc
			},
			{} as Record<string, string[]>,
		)

		let context = "Staged changes:\n"
		for (const [status, files] of Object.entries(changesByType)) {
			context += `\n${status} files:\n`
			files.forEach((file) => {
				context += `- ${file}\n`
			})
		}

		return context
	}
}
