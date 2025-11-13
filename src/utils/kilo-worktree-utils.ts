import simpleGit from "simple-git"
import * as path from "path"
import * as vscode from "vscode"
import { promises as fs } from "fs"
import os from "os"

export function sanitizeName(input: string): string {
	return (
		input
			// Convert camelCase to dash-case
			.replace(/([a-z])([A-Z])/g, "$1-$2")
			.toLowerCase()
			// Replace any character that is not alphanumeric (a-z, A-Z, 0-9) or dash with a dash
			.replace(/[^a-z0-9-]/g, "-")
			// Replace multiple consecutive dashes with a single dash
			.replace(/-+/g, "-")
			// Limit the result to the first 50 characters
			.slice(0, 50)
			// Remove leading and trailing dashes
			.replace(/^-|-$/g, "") ||
		// Fallback to a random UUID if the sanitized result is empty
		`kilo-${crypto.randomUUID()}`
	)
}

interface CreateWorktreeResult {
	branchName: string
	directoryPath: string
}

export async function createWorktree(
	inputBranchName: string,
	workspaceUri?: vscode.Uri,
): Promise<CreateWorktreeResult> {
	// Add timestamp to ensure uniqueness
	const timestamp = Date.now()
	const sanitizedName = sanitizeName(inputBranchName)
	const branchName = `${sanitizedName}-${timestamp}`

	// Determine which workspace to use
	let workspaceRoot: string
	if (workspaceUri) {
		// Use the provided workspace URI
		workspaceRoot = workspaceUri.fsPath
	} else {
		// If no URI provided, check for active text editor's workspace
		const activeEditor = vscode.window.activeTextEditor
		if (activeEditor) {
			const activeWorkspace = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri)
			if (activeWorkspace) {
				workspaceRoot = activeWorkspace.uri.fsPath
			} else {
				// Fall back to first workspace folder
				const workspaceFolders = vscode.workspace.workspaceFolders
				if (!workspaceFolders || workspaceFolders.length === 0) {
					throw new Error("No workspace folder found")
				}
				workspaceRoot = workspaceFolders[0].uri.fsPath
			}
		} else {
			// No active editor, use first workspace folder
			const workspaceFolders = vscode.workspace.workspaceFolders
			if (!workspaceFolders || workspaceFolders.length === 0) {
				throw new Error("No workspace folder found")
			}
			workspaceRoot = workspaceFolders[0].uri.fsPath
		}
	}

	const git = simpleGit(workspaceRoot)

	// Verify git repository
	const isRepo = await git.checkIsRepo()
	if (!isRepo) {
		throw new Error("Current workspace is not a git repository")
	}

	// Check if branch already exists (unlikely with timestamp, but check anyway)
	const branches = await git.branchLocal()
	if (branches.all.includes(branchName)) {
		throw new Error(`Branch '${branchName}' already exists`)
	}

	// Create worktree directory in ~/.kilocode/worktrees
	const homeDir = os.homedir()
	const worktreesBaseDir = path.join(homeDir, ".kilocode", "worktrees")
	await fs.mkdir(worktreesBaseDir, { recursive: true })

	const directoryPath = path.join(worktreesBaseDir, branchName)

	// Check if directory already exists (unlikely with timestamp, but check anyway)
	try {
		await fs.access(directoryPath)
		throw new Error(`Directory '${directoryPath}' already exists`)
	} catch (error: any) {
		if (error.code !== "ENOENT") {
			throw error
		}
	}

	// Create the worktree
	try {
		await git.raw(["worktree", "add", "-b", branchName, directoryPath])
	} catch (error) {
		throw new Error(`Failed to create worktree: ${error instanceof Error ? error.message : String(error)}`)
	}

	return {
		branchName,
		directoryPath,
	}
}
