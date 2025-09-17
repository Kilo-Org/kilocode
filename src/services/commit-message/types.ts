// kilocode_change - new file
import * as vscode from "vscode"

export interface GitChange {
	filePath: string
	status: string
}

export interface GitOptions {
	staged: boolean
}

export interface GitProgressOptions extends GitOptions {
	onProgress?: (percentage: number) => void
}

/**
 * VSCode Git repository interface for internal VSCode usage
 */
export interface VscGenerationRequest {
	inputBox: { value: string }
	rootUri?: vscode.Uri
}
