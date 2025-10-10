import type { CliMessage, WelcomeMessageOptions } from "../../types/cli.js"

// Counter to ensure unique IDs even when created in the same millisecond
let messageCounter = 0

/**
 * Creates a welcome message with customizable options
 * @param options - Customization options for the welcome message
 * @returns A CliMessage of type "welcome"
 */
export function createWelcomeMessage(options?: WelcomeMessageOptions): CliMessage {
	const timestamp = Date.now()
	const id = `welcome-${timestamp}-${messageCounter++}`

	return {
		id,
		type: "welcome",
		content: "", // Content is rendered by WelcomeMessageContent component
		ts: timestamp,
		metadata: {
			welcomeOptions: options,
		},
	}
}
