/**
 * /indexconfig command - Configure codebase indexing settings
 */

import type { Command } from "./core/types.js"

export const indexConfigCommand: Command = {
	name: "indexconfig",
	aliases: ["index", "idx"],
	description: "Configure codebase indexing settings for semantic search",
	usage: "/indexconfig",
	examples: ["/indexconfig"],
	category: "settings",
	priority: 7,
	handler: async (context) => {
		const { addMessage } = context

		addMessage({
			id: Date.now().toString(),
			type: "system",
			content:
				"Codebase indexing configuration is managed through the main config file. Use /config to edit settings.",
			ts: Date.now(),
		})
	},
}
