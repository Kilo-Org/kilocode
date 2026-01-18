/**
 * /logout command - Clear authentication credentials
 */

import type { Command, CommandContext } from "./core/types.js"
import { saveConfig } from "../config/index.js"

/**
 * Logout by clearing authentication credentials
 */
async function logout(context: CommandContext): Promise<void> {
	const { addMessage, config } = context

	// Check if there are any providers configured
	if (!config.providers || config.providers.length === 0) {
		addMessage({
			id: Date.now().toString(),
			type: "system",
			content: "No providers configured. Nothing to logout from.",
			ts: Date.now(),
		})
		return
	}

	// Always empty the providers array and clear selected provider when logging out
	const updatedConfig = {
		...config,
		providers: [],
		provider: "",
	}

	try {
		// Skip validation when saving logout changes because we're intentionally clearing credentials
		await saveConfig(updatedConfig, true)
		addMessage({
			id: Date.now().toString(),
			type: "system",
			content: "✓ Successfully logged out. All authentication credentials have been cleared.",
			ts: Date.now(),
		})
		// Quit the CLI after successful logout
		context.exit()
	} catch (error) {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: `Failed to logout: ${error instanceof Error ? error.message : String(error)}`,
			ts: Date.now(),
		})
	}
}

export const logoutCommand: Command = {
	name: "logout",
	aliases: [],
	description: "Clear all authentication credentials from the CLI configuration",
	usage: "/logout",
	examples: ["/logout"],
	category: "settings",
	priority: 8,
	handler: async (context) => {
		await logout(context)
	},
}
