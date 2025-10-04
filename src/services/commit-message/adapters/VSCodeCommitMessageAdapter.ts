// kilocode_change - new file
import * as vscode from "vscode"
import { ICommitMessageAdapter } from "./ICommitMessageAdapter"
import { BaseCommitMessageAdapter } from "./BaseCommitMessageAdapter"
import { CommitMessageRequest, CommitMessageResult, MessageType, ProgressReporter } from "../types/core"
import { VscGenerationRequest, VSCodeMessageTypeMap } from "../types/vscode"
import { GitExtensionService, GitChange } from "../GitExtensionService"
import { t } from "../../../i18n"
import { CommitMessageGenerator } from "../CommitMessageGenerator"

export class VSCodeCommitMessageAdapter extends BaseCommitMessageAdapter implements ICommitMessageAdapter {
	private targetRepository: VscGenerationRequest | null = null

	constructor(
		private context: vscode.ExtensionContext,
		private outputChannel: vscode.OutputChannel,
		private messageGenerator: CommitMessageGenerator,
	) {
		super()
	}

	async generateCommitMessage(request: CommitMessageRequest): Promise<CommitMessageResult> {
		try {
			const targetRepository = await this.determineTargetRepository(request.workspacePath)
			if (!targetRepository?.rootUri) {
				throw new Error("Could not determine Git repository")
			}
			this.targetRepository = targetRepository
			const workspaceRoot = request.workspacePath

			return await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.SourceControl,
					title: t("kilocode:commitMessage.generating"),
					cancellable: false,
				},
				async (progress) => {
					const reporter: ProgressReporter = {
						report: (value) => progress.report(value),
					}

					try {
						reporter.report({ increment: 5, message: t("kilocode:commitMessage.generating") })
						const selection = await this.getSelectedChanges(workspaceRoot)

						if (selection.files.length === 0) {
							await this.showMessage(t("kilocode:commitMessage.noChanges"), "info")
							return { message: "", error: "No changes found" }
						}

						if (!selection.usedStaged && selection.files.length > 0) {
							this.showMessage(t("kilocode:commitMessage.generatingFromUnstaged"), "info").catch(() => {})
						}

						reporter.report({ increment: 15, message: t("kilocode:commitMessage.generating") })

						const gitContext = await this.gitService!.getCommitContext(
							selection.changes,
							{ staged: selection.usedStaged, includeRepoContext: true },
							selection.files,
						)

						reporter.report({ increment: 10, message: t("kilocode:commitMessage.generating") })
						const generatedMessage = await this.messageGenerator.generateMessage({
							workspacePath: workspaceRoot,
							selectedFiles: selection.files,
							gitContext,
							onProgress: (update) => {
								if (update.increment) {
									const scaledIncrement = Math.round(update.increment * 0.6)
									reporter.report({ increment: scaledIncrement, message: update.message })
								}
							},
						})

						reporter.report({ increment: 10, message: t("kilocode:commitMessage.progress.generating") })
						await this.setCommitMessage(generatedMessage)

						reporter.report({ increment: 0, message: t("kilocode:commitMessage.generated") })

						return { message: generatedMessage }
					} catch (error) {
						const errorMessage = error instanceof Error ? error.message : "Unknown error occurred"
						await this.showMessage(t("kilocode:commitMessage.generationFailed", { errorMessage }), "error")
						return { message: "", error: errorMessage }
					}
				},
			)
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error occurred"
			return { message: "", error: errorMessage }
		}
	}

	private async setCommitMessage(message: string): Promise<void> {
		if (this.targetRepository) {
			this.targetRepository.inputBox.value = message
		}
	}

	private async showMessage(message: string, type: MessageType): Promise<void> {
		const methodName = VSCodeMessageTypeMap[type]
		const method = vscode.window[methodName] as (message: string) => Thenable<string | undefined>
		await method(message)
	}

	private async determineTargetRepository(workspacePath: string): Promise<VscGenerationRequest | null> {
		try {
			const gitExtension = vscode.extensions.getExtension("vscode.git")
			if (!gitExtension) {
				return null
			}

			if (!gitExtension.isActive) {
				try {
					await gitExtension.activate()
				} catch (activationError) {
					return null
				}
			}

			const gitApi = gitExtension.exports.getAPI(1)
			if (!gitApi) {
				return null
			}

			for (const repo of gitApi.repositories ?? []) {
				if (repo.rootUri && workspacePath.startsWith(repo.rootUri.fsPath)) {
					return repo
				}
			}

			return gitApi.repositories[0] ?? null
		} catch (error) {
			console.error("Error determining target repository:", error)
			return null
		}
	}

	private async getSelectedChanges(
		workspacePath: string,
	): Promise<{ files: string[]; changes: GitChange[]; usedStaged: boolean }> {
		const { changes, staged } = await this.gatherGitChanges(workspacePath)

		return {
			files: changes.map((change) => change.filePath),
			changes,
			usedStaged: staged,
		}
	}

	private async gatherGitChanges(workspacePath: string) {
		if (this.currentWorkspaceRoot !== workspacePath) {
			this.gitService?.dispose()
			this.gitService = new GitExtensionService(workspacePath)
			this.currentWorkspaceRoot = workspacePath
		}
		if (!this.gitService) {
			throw new Error("Failed to initialize Git service")
		}

		let staged = true
		let changes = await this.gitService.gatherChanges({ staged })

		if (changes.length === 0) {
			staged = false
			changes = await this.gitService.gatherChanges({ staged })
		}

		return { changes, staged }
	}

	override dispose(): void {
		super.dispose()
		this.targetRepository = null
	}
}
