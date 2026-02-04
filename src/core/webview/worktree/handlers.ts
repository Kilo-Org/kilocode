/**
 * Worktree Handlers
 *
 * VSCode-specific handlers that bridge webview messages to the core worktree services.
 * These handlers handle VSCode-specific logic like opening folders and managing state.
 */

import * as vscode from "vscode"
import * as path from "path"
import * as os from "os"

import type {
	WorktreeResult,
	BranchInfo,
	WorktreeIncludeStatus,
	WorktreeListResponse,
	WorktreeDefaultsResponse,
} from "@roo-code/types"
import { worktreeService, worktreeIncludeService, type CopyProgressCallback } from "@roo-code/core"

import type { ClineProvider } from "../ClineProvider"

/**
 * Generate a random alphanumeric suffix for branch/folder names.
 */
function generateRandomSuffix(length = 5): string {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
	let result = ""

	for (let i = 0; i < length; i++) {
		result += chars.charAt(Math.floor(Math.random() * chars.length))
	}

	return result
}

async function isWorkspaceSubfolder(cwd: string): Promise<boolean> {
	const gitRoot = await worktreeService.getGitRootPath(cwd)

	if (!gitRoot) {
		return false
	}

	// Normalize paths for comparison.
	const normalizedCwd = path.normalize(cwd)
	const normalizedGitRoot = path.normalize(gitRoot)

	// If cwd is deeper than git root, it's a subfolder.
	return normalizedCwd !== normalizedGitRoot && normalizedCwd.startsWith(normalizedGitRoot)
}

export async function handleListWorktrees(provider: ClineProvider): Promise<WorktreeListResponse> {
	const workspaceFolders = vscode.workspace.workspaceFolders
	const isMultiRoot = workspaceFolders ? workspaceFolders.length > 1 : false

	if (!workspaceFolders || workspaceFolders.length === 0) {
		return {
			worktrees: [],
			isGitRepo: false,
			isMultiRoot: false,
			isSubfolder: false,
			gitRootPath: "",
			error: "No workspace folder open",
		}
	}

	// Multi-root workspaces not supported for worktrees.
	if (isMultiRoot) {
		return {
			worktrees: [],
			isGitRepo: false,
			isMultiRoot: true,
			isSubfolder: false,
			gitRootPath: "",
			error: "Worktrees are not supported in multi-root workspaces",
		}
	}

	const cwd = provider.cwd
	const isGitRepo = await worktreeService.checkGitRepo(cwd)

	if (!isGitRepo) {
		return {
			worktrees: [],
			isGitRepo: false,
			isMultiRoot: false,
			isSubfolder: false,
			gitRootPath: "",
			error: "Not a git repository",
		}
	}

	const isSubfolder = await isWorkspaceSubfolder(cwd)
	const gitRootPath = (await worktreeService.getGitRootPath(cwd)) || ""

	if (isSubfolder) {
		return {
			worktrees: [],
			isGitRepo: true,
			isMultiRoot: false,
			isSubfolder: true,
			gitRootPath,
			error: "Worktrees are not supported when workspace is a subfolder of a git repository",
		}
	}

	try {
		const worktrees = await worktreeService.listWorktrees(cwd)

		return {
			worktrees,
			isGitRepo: true,
			isMultiRoot: false,
			isSubfolder: false,
			gitRootPath,
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)

		return {
			worktrees: [],
			isGitRepo: true,
			isMultiRoot: false,
			isSubfolder: false,
			gitRootPath,
			error: `Failed to list worktrees: ${errorMessage}`,
		}
	}
}

export async function handleCreateWorktree(
	provider: ClineProvider,
	options: {
		path: string
		branch?: string
		baseBranch?: string
		createNewBranch?: boolean
	},
	onCopyProgress?: CopyProgressCallback,
): Promise<WorktreeResult> {
	const cwd = provider.cwd

	const isGitRepo = await worktreeService.checkGitRepo(cwd)

	if (!isGitRepo) {
		return {
			success: false,
			message: "Not a git repository",
		}
	}

	const result = await worktreeService.createWorktree(cwd, options)

	// If successful and .worktreeinclude exists, copy the files.
	if (result.success && result.worktree) {
		try {
			const copiedItems = await worktreeIncludeService.copyWorktreeIncludeFiles(
				cwd,
				result.worktree.path,
				onCopyProgress,
			)
			if (copiedItems.length > 0) {
				result.message += ` (copied ${copiedItems.length} item(s) from .worktreeinclude)`
			}
		} catch (error) {
			// Log but don't fail the worktree creation.
			provider.log(`Warning: Failed to copy .worktreeinclude files: ${error}`)
		}
	}

	return result
}

export async function handleDeleteWorktree(
	provider: ClineProvider,
	worktreePath: string,
	force = false,
): Promise<WorktreeResult> {
	const cwd = provider.cwd
	return worktreeService.deleteWorktree(cwd, worktreePath, force)
}

export async function handleSwitchWorktree(
	provider: ClineProvider,
	worktreePath: string,
	newWindow: boolean,
): Promise<WorktreeResult> {
	try {
		const worktreeUri = vscode.Uri.file(worktreePath)

		if (newWindow) {
			// Set the auto-open path so the new window opens Roo Code sidebar.
			await provider.contextProxy.setValue("worktreeAutoOpenPath", worktreePath)

			// Open in new window.
			await vscode.commands.executeCommand("vscode.openFolder", worktreeUri, { forceNewWindow: true })
		} else {
			// For current window, we need to flush pending state first since window will reload.
			await provider.contextProxy.setValue("worktreeAutoOpenPath", worktreePath)

			// Open in current window (this will reload the window).
			await vscode.commands.executeCommand("vscode.openFolder", worktreeUri, { forceNewWindow: false })
		}

		return {
			success: true,
			message: `Opened worktree at ${worktreePath}`,
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		return {
			success: false,
			message: `Failed to switch worktree: ${errorMessage}`,
		}
	}
}

export async function handleGetAvailableBranches(provider: ClineProvider): Promise<BranchInfo> {
	const cwd = provider.cwd
	// Include branches already in worktrees since we use this for base branch selection
	return worktreeService.getAvailableBranches(cwd, true)
}

export async function handleGetWorktreeDefaults(provider: ClineProvider): Promise<WorktreeDefaultsResponse> {
	const suffix = generateRandomSuffix()
	const workspaceFolders = vscode.workspace.workspaceFolders
	const projectName = workspaceFolders?.[0]?.name || "project"

	const dotRooPath = path.join(os.homedir(), ".roo")
	const suggestedPath = path.join(dotRooPath, "worktrees", `${projectName}-${suffix}`)

	return {
		suggestedBranch: `worktree/roo-${suffix}`,
		suggestedPath,
	}
}

export async function handleGetWorktreeIncludeStatus(provider: ClineProvider): Promise<WorktreeIncludeStatus> {
	const cwd = provider.cwd
	return worktreeIncludeService.getStatus(cwd)
}

export async function handleCheckBranchWorktreeInclude(provider: ClineProvider, branch: string): Promise<boolean> {
	const cwd = provider.cwd
	return worktreeIncludeService.branchHasWorktreeInclude(cwd, branch)
}

export async function handleCreateWorktreeInclude(provider: ClineProvider, content: string): Promise<WorktreeResult> {
	const cwd = provider.cwd

	try {
		await worktreeIncludeService.createWorktreeInclude(cwd, content)

		// Open the file in the editor for easy editing
		try {
			const filePath = path.join(cwd, ".worktreeinclude")
			const document = await vscode.workspace.openTextDocument(filePath)
			await vscode.window.showTextDocument(document)
		} catch {
			// Opening the file in editor is a convenience feature - don't fail the operation
		}

		return {
			success: true,
			message: ".worktreeinclude file created",
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		return {
			success: false,
			message: `Failed to create .worktreeinclude: ${errorMessage}`,
		}
	}
}

export async function handleCheckoutBranch(provider: ClineProvider, branch: string): Promise<WorktreeResult> {
	const cwd = provider.cwd
	return worktreeService.checkoutBranch(cwd, branch)
}
