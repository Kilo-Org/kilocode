export interface WelcomeMessageOptions {
	// Clear viewport before showing the message
	clearScreen?: boolean
	// Display options
	showInstructions?: boolean
	// Content customization
	instructions?: string[] // Custom instruction lines
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
