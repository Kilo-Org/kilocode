// kilocode_change - updated for backwards compatibility
import * as vscode from "vscode"

// Git status codes from git status command
export type GitStatus = "M" | "A" | "D" | "R" | "C" | "U" | "?" | "Unknown"

// Legacy types (kept for backwards compatibility)
export interface GitChange {
	filePath: string
	status: GitStatus
	staged: boolean
}

export interface GitOptions {
	staged: boolean
}

export interface GitProgressOptions extends GitOptions {
	onProgress?: (percentage: number) => void
	includeRepoContext?: boolean
}

/**
 * VSCode Git repository interface for internal VSCode usage
 */
export interface VscGenerationRequest {
	inputBox: { value: string }
	rootUri?: vscode.Uri
}
