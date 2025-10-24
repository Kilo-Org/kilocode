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

		await openConfigFile()
	},
}
