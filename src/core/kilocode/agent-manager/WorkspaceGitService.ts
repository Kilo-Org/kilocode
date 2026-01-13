// kilocode_change - new file: Service for accessing workspace git repository via VS Code Git API
import * as vscode from "vscode"
import { type GitAPI, type Repository } from "./vscodeGitTypes"

export interface BranchInfo {
	branches: string[]
	currentBranch?: string
}

export class WorkspaceGitService {
	async getBranchInfo(): Promise<BranchInfo> {
		const repository = await this.getRepository()
		if (!repository) {
			return { branches: [] }
		}

		const currentBranch = repository.state.HEAD?.name
		const branchRefs = await repository.getBranches({ remote: false })
		const branches = branchRefs.filter((ref) => ref.name).map((ref) => ref.name!)

		return { branches, currentBranch }
	}

	private async getRepository(): Promise<Repository | undefined> {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
		if (!workspaceFolder) {
			return undefined
		}

		const gitExtension = vscode.extensions.getExtension<{ getAPI: (version: number) => GitAPI }>("vscode.git")
		if (!gitExtension) {
			return undefined
		}

		if (!gitExtension.isActive) {
			await gitExtension.activate()
		}

		const gitApi = gitExtension.exports.getAPI(1)
		if (!gitApi) {
			return undefined
		}

		return gitApi.repositories.find(
			(repo) => repo.rootUri && workspaceFolder.uri.fsPath.startsWith(repo.rootUri.fsPath),
		)
	}
}
