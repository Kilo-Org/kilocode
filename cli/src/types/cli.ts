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
	type: "user" | "assistant" | "system" | "error" | "welcome" | "empty"
	content: string
	ts: number
	partial?: boolean | undefined
	metadata?: {
		welcomeOptions?: WelcomeMessageOptions | undefined
	}
}
