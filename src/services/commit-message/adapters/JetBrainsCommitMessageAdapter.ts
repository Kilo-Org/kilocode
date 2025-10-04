// kilocode_change - new file
import { ICommitMessageAdapter } from "./ICommitMessageAdapter"
import { BaseCommitMessageAdapter } from "./BaseCommitMessageAdapter"
import { CommitMessageRequest, CommitMessageResult, ProgressUpdate } from "../types/core"
import { GitExtensionService, GitChange } from "../GitExtensionService"
import { CommitMessageGenerator } from "../CommitMessageGenerator"

export class JetBrainsCommitMessageAdapter extends BaseCommitMessageAdapter implements ICommitMessageAdapter {
	constructor(private messageGenerator: CommitMessageGenerator) {
		super()
	}

	async generateCommitMessage(request: CommitMessageRequest): Promise<CommitMessageResult> {
		try {
			const { workspacePath } = request
			let { selectedFiles } = request

			const gitService = this.initializeGitService(workspacePath)

			if (!selectedFiles || selectedFiles.length === 0) {
				let allChanges = await gitService.gatherChanges({ staged: true })
				if (allChanges.length === 0) {
					allChanges = await gitService.gatherChanges({ staged: false })
				}
				selectedFiles = allChanges.map((change) => change.filePath)
			}

			if (selectedFiles.length === 0) {
				return {
					message: "",
					error: "No files available for commit message generation",
				}
			}

			const changes = await this.resolveChangesForFiles(selectedFiles)

			if (changes.length === 0) {
				return {
					message: "",
					error: "No valid changes found for the provided files",
				}
			}

			const normalizedSelectedFiles = changes.map((change) => change.filePath)

			const defaultStaged = changes.every((change) => change.staged === false) ? false : true
			const gitContext = await gitService.getCommitContext(
				changes,
				{ staged: defaultStaged, includeRepoContext: true },
				normalizedSelectedFiles,
			)

			const generatedMessage = await this.messageGenerator.generateMessage({
				workspacePath,
				selectedFiles: normalizedSelectedFiles,
				gitContext,
				onProgress: this.createProgressCallback(),
			})

			return {
				message: generatedMessage,
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error occurred"
			return {
				message: "",
				error: errorMessage,
			}
		}
	}

	private async resolveChangesForFiles(selectedFiles: string[]): Promise<GitChange[]> {
		if (!this.gitService) {
			throw new Error("Git service not initialized")
		}

		const matchedChanges: GitChange[] = []
		const stagedChanges = await this.gitService.gatherChanges({ staged: true })
		const unstagedChanges = await this.gitService.gatherChanges({ staged: false })

		const addChange = (change: GitChange) => {
			if (!matchedChanges.some((existing) => existing.filePath === change.filePath)) {
				matchedChanges.push(change)
			}
		}

		for (const filePath of selectedFiles) {
			const stagedMatch = stagedChanges.find(
				(change) => change.filePath === filePath || change.filePath.endsWith(filePath),
			)
			if (stagedMatch) {
				addChange(stagedMatch)
				continue
			}

			const unstagedMatch = unstagedChanges.find(
				(change) => change.filePath === filePath || change.filePath.endsWith(filePath),
			)
			if (unstagedMatch) {
				addChange(unstagedMatch)
				continue
			}
		}

		return matchedChanges
	}

	private createProgressCallback(): (progress: ProgressUpdate) => void {
		return () => {
			// Future: send progress updates to JetBrains via RPC
		}
	}
}
