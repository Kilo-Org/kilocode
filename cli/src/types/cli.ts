import type { ModeConfig } from "./messages.js"

export interface WelcomeMessageOptions {
	// Clear viewport before showing the message
	clearScreen?: boolean
	// Display options
	showInstructions?: boolean
	// Content customization
	instructions?: string[] // Custom instruction lines
	// Parallel mode branch name
	worktreeBranch?: string | undefined
	// Workspace directory
	workspace?: string | undefined
}

export interface CliMessage {
	id: string
	type: "user" | "assistant" | "system" | "error" | "welcome" | "empty" | "requestCheckpointRestoreApproval"
	content: string
	ts: number
	partial?: boolean | undefined
	metadata?: {
		welcomeOptions?: WelcomeMessageOptions | undefined
	}
	payload?: unknown
}

export interface CLIOptions {
	mode?: string
	workspace?: string
	ci?: boolean
	yolo?: boolean
	json?: boolean
	jsonInteractive?: boolean
	prompt?: string
	timeout?: number
	customModes?: ModeConfig[]
	parallel?: boolean
	worktreeBranch?: string | undefined
	continue?: boolean
	provider?: string
	model?: string
	session?: string
	fork?: string
	noSplash?: boolean
	appendSystemPrompt?: string
	attachments?: string[] | undefined
}
