/**
 * /config command - Open the CLI configuration file
 */

import type { Command } from "./core/types.js"
import openConfigFile from "../config/openConfig.js"

export const configCommand: Command = {
	name: "config",
	aliases: ["c", "settings"],
	description: "Open the CLI configuration file in your default editor",
	usage: "/config",
	examples: ["/config"],
	category: "settings",
	priority: 8,
	handler: async (context) => {
		const { addMessage } = context

		addMessage({
			id: Date.now().toString(),
			type: "system",
			content: "Opening configuration file...",
			ts: Date.now(),
		})

		try {
			await openConfigFile()
		} catch (_error) {
			// Error already logged by openConfigFile
			addMessage({
				id: Date.now().toString(),
				type: "error",
				content: "Failed to open configuration file. Please check the error message above.",
				ts: Date.now(),
			})
		}
	},
}
