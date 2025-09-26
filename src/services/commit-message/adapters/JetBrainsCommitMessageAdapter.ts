import { ICommitMessageAdapter } from "./ICommitMessageAdapter"
import { CommitMessageRequest, CommitMessageResult, MessageType, ProgressUpdate } from "../types/core"
import { GitExtensionService, GitChange } from "../GitExtensionService"
import { CommitMessageGenerator } from "../CommitMessageGenerator"

/**
 * JetBrains-specific adapter for commit message generation.
 * Handles JetBrains workflow where files are always pre-selected,
 * validates provided files, and returns results without setting UI elements.
 */
export class JetBrainsCommitMessageAdapter implements ICommitMessageAdapter {
	private gitService: GitExtensionService | null = null
	private currentWorkspaceRoot: string | null = null

	constructor(private messageGenerator: CommitMessageGenerator) {}

	/**
	 * Generate a commit message for JetBrains.
	 * Validates provided files, generates message using the generator, and returns result.
	 */
	async generateCommitMessage(request: CommitMessageRequest): Promise<CommitMessageResult> {
		console.log("🔧 JetBrainsAdapter.generateCommitMessage: Starting generation")
		console.log("🔧 JetBrainsAdapter.generateCommitMessage: Request object:", JSON.stringify(request, null, 2))
		console.log("🔧 JetBrainsAdapter.generateCommitMessage: selectedFiles type:", typeof request.selectedFiles)
		console.log("🔧 JetBrainsAdapter.generateCommitMessage: selectedFiles value:", request.selectedFiles)
		console.log("🔧 JetBrainsAdapter.generateCommitMessage: selectedFiles length:", request.selectedFiles?.length)

		try {
			const { workspacePath } = request
			let { selectedFiles } = request

			// Initialize git service if needed
			if (this.currentWorkspaceRoot !== workspacePath) {
				this.gitService?.dispose()
				this.gitService = new GitExtensionService(workspacePath)
				this.currentWorkspaceRoot = workspacePath
			}

			if (!this.gitService) {
				return {
					message: "",
					error: "Failed to initialize Git service",
				}
			}

			// If no files are selected/checked, discover all available changes
			if (!selectedFiles || selectedFiles.length === 0) {
				console.log("🔧 JetBrainsAdapter.generateCommitMessage: No files provided, discovering all changes...")

				// Get all staged changes first, fallback to unstaged
				let allChanges = await this.gitService.gatherChanges({ staged: true })
				if (allChanges.length === 0) {
					allChanges = await this.gitService.gatherChanges({ staged: false })
				}

				selectedFiles = allChanges.map((change) => change.filePath)
				console.log(
					"🔧 JetBrainsAdapter.generateCommitMessage: Discovered",
					selectedFiles.length,
					"files automatically",
				)
			} else {
				console.log(
					"🔧 JetBrainsAdapter.generateCommitMessage: Using provided files, count:",
					selectedFiles.length,
				)
			}

			// Final validation - if still no files, return error
			if (selectedFiles.length === 0) {
				console.log("🔧 JetBrainsAdapter.generateCommitMessage: No files available (checked or discovered)")
				return {
					message: "",
					error: "No files available for commit message generation",
				}
			}

			// Validate that provided/discovered files exist and have git changes
			const changes = await this.resolveChangesForFiles(selectedFiles)
			console.log("🔧 JetBrains adapter - validated file changes:", changes.length)

			if (changes.length === 0) {
				return {
					message: "",
					error: "No valid changes found for the provided files",
				}
			}

			const normalizedSelectedFiles = changes.map((change) => change.filePath)

			// Generate git context for the validated files
			const defaultStaged = changes.every((change) => change.staged === false) ? false : true
			const gitContext = await this.gitService.getCommitContext(
				changes,
				{ staged: defaultStaged, includeRepoContext: true },
				normalizedSelectedFiles,
			)

			console.log("🔧 JetBrains adapter - generated git context length:", gitContext.length)

			// Generate commit message using the shared generator
			const generatedMessage = await this.messageGenerator.generateMessage({
				workspacePath,
				selectedFiles: normalizedSelectedFiles,
				gitContext,
				onProgress: this.createProgressCallback(),
			})

			console.log("🔧 JetBrains adapter - successfully generated message:", generatedMessage)

			return {
				message: generatedMessage,
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error occurred"
			console.error("🔧 Error in JetBrains generateCommitMessage:", error)
			return {
				message: "",
				error: errorMessage,
			}
		}
	}

	/**
	 * Set the commit message for JetBrains.
	 * Currently a stub - JetBrains receives the result and handles UI setting.
	 */
	private async setCommitMessage(message: string): Promise<void> {
		// JetBrains handles message setting via RPC response
		// This method is here for interface compliance
		console.log("🔧 JetBrains adapter - message would be set:", message)
	}

	/**
	 * Show a notification message to the user for JetBrains.
	 * Currently a stub - could be enhanced to send notifications via RPC.
	 */
	private async showMessage(message: string, type: MessageType): Promise<void> {
		// JetBrains could receive notifications via RPC
		// This is a stub for future implementation
		console.log(`🔧 JetBrains adapter - ${type} message:`, message)
	}

	/**
	 * Validate that provided files exist in workspace and have git changes.
	 * Unlike VSCode, this doesn't discover files - only validates provided ones.
	 */
	private async resolveChangesForFiles(selectedFiles: string[]): Promise<GitChange[]> {
		if (!this.gitService) {
			throw new Error("Git service not initialized")
		}

		const matchedChanges: GitChange[] = []

		const stagedChanges = await this.gitService.gatherChanges({ staged: true })
		const unstagedChanges = await this.gitService.gatherChanges({ staged: false })

		console.log(
			"🔧 JetBrains adapter - all staged changes:",
			stagedChanges.map((c) => c.filePath),
		)
		console.log(
			"🔧 JetBrains adapter - all unstaged changes:",
			unstagedChanges.map((c) => c.filePath),
		)

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

			console.warn("🔧 JetBrains adapter - file not found in git changes:", filePath)
		}

		return matchedChanges
	}

	/**
	 * Create a progress callback for the message generator.
	 * For now, this just logs progress - could be enhanced to send to JetBrains via RPC.
	 */
	private createProgressCallback(): (progress: ProgressUpdate) => void {
		return (progress: ProgressUpdate) => {
			console.log(`🔧 JetBrains adapter progress - ${progress.stage}:`, {
				message: progress.message,
				percentage: progress.percentage,
				increment: progress.increment,
			})
			// Future: send progress updates to JetBrains via RPC
		}
	}

	/**
	 * Cleanup resources when adapter is disposed.
	 */
	dispose(): void {
		this.gitService?.dispose()
		this.gitService = null
		this.currentWorkspaceRoot = null
	}
}
