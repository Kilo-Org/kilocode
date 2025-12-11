// kilocode_change - new file
import * as path from "path"
import { CommitMessageRequest, CommitMessageResult } from "./types/core"
import { GitExtensionService, GitChange } from "./GitExtensionService"
import { CommitMessageGenerator } from "./CommitMessageGenerator"
import { ICommitMessageIntegration } from "./adapters/ICommitMessageIntegration"
import { t } from "../../i18n"
import { GitStatus } from "./types"

export interface ChangeResolution {
	changes: GitChange[]
	files: string[]
	usedStaged: boolean
}

/**
 * Orchestrates the generic commit message generation workflow.
 * Coordinates between Git operations, change resolution, and IDE integration.
 */
export class CommitMessageOrchestrator {
	/**
	 * Generate a commit message using the generic workflow with IDE-specific integration.
	 */
	async generateCommitMessage(
		request: CommitMessageRequest,
		integration: ICommitMessageIntegration,
		messageGenerator: CommitMessageGenerator,
	): Promise<CommitMessageResult> {
		let gitService: GitExtensionService | null = null

		try {
			integration.reportProgress?.(5, t("kilocode:commitMessage.initializing"))
			gitService = new GitExtensionService(request.workspacePath)

			integration.reportProgress?.(15, t("kilocode:commitMessage.discoveringFiles"))
			const resolution = await this.resolveCommitChanges(gitService, request.selectedFiles, integration)

			if (resolution.changes.length === 0) {
				const result = { message: "", error: "No changes found" }
				await integration.handleResult(result)
				return result
			}

			integration.reportProgress?.(
				25,
				t("kilocode:commitMessage.foundChanges", { count: resolution.changes.length }),
			)

			if (!resolution.usedStaged && resolution.files.length > 0) {
				integration.showMessage?.("Generating commit message from unstaged changes", "info")
			}

			integration.reportProgress?.(40, t("kilocode:commitMessage.gettingContext"))

			const gitContext = await gitService.getCommitContext(
				resolution.changes,
				{ staged: resolution.usedStaged, includeRepoContext: true },
				resolution.files,
			)

			integration.reportProgress?.(70, t("kilocode:commitMessage.generating"))

			const message = await messageGenerator.generateMessage({
				workspacePath: request.workspacePath,
				selectedFiles: resolution.files,
				gitContext,
				onProgress: (update) => {
					if (update.percentage !== undefined) {
						// Scale AI generation progress to fit within 70-95% range
						const scaledPercentage = 70 + update.percentage * 0.25
						integration.reportProgress?.(scaledPercentage, update.message)
					}
				},
			})

			const result = { message }
			await integration.handleResult(result)

			integration.reportProgress?.(100, t("kilocode:commitMessage.generated"))
			return result
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error occurred"
			const result = { message: "", error: errorMessage }

			await integration.showMessage?.(errorMessage, "error")
			await integration.handleResult(result)

			return result
		} finally {
			gitService?.dispose()
		}
	}

	/**
	 * Resolve which changes should be included in the commit message generation.
	 * Handles file discovery, filtering, and matching strategies.
	 */
	private async resolveCommitChanges(
		gitService: GitExtensionService,
		selectedFiles?: string[],
		integration?: ICommitMessageIntegration,
	): Promise<ChangeResolution> {
		// If specific files are selected, we don't need to query for all changes
		// We can construct the change objects directly from the selected files.
		if (selectedFiles && selectedFiles.length > 0) {
			const changes: GitChange[] = selectedFiles.map((filePath) => {
				// A simple way to get status is to check git status for each file
				// For now, we assume 'Modified' and 'unstaged' as a safe default for commit dialog selections.
				// A more robust implementation might run `git status --porcelain -- <file>` for each.
				const status: GitStatus = "M" // Default to Modified
				const staged = false // Default to unstaged
				return {
					filePath,
					status,
					staged,
				}
			})
			return {
				changes,
				files: selectedFiles,
				usedStaged: false, // Assume unstaged as commit dialog selections are typically unstaged
			}
		}

		// Try staged changes first
		let changes = await gitService.gatherChanges({ staged: true })
		let usedStaged = true

		// Fall back to unstaged if no staged changes
		if (changes.length === 0) {
			changes = await gitService.gatherChanges({ staged: false })
			usedStaged = false
		}

		return {
			changes,
			files: changes.map((change) => change.filePath),
			usedStaged,
		}
	}
}
