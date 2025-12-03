/**
 * /config command - Interactive CLI configuration editor
 */

import type { Command } from "./core/types.js"
import { startInteractiveConfigEditor } from "../config/interactiveEditor.js"

export const configCommand: Command = {
	name: "config",
	aliases: ["c", "settings"],
	description: "Interactive CLI configuration editor",
	usage: "/config [menu_option]",
	examples: ["/config", "/config 1", "/config 2"],
	category: "settings",
	priority: 8,
	arguments: [
		{
			name: "menu_option",
			description: "Menu option number to select directly (1-6)",
			required: false,
			placeholder: "Enter menu option number or leave empty for interactive menu",
		},
	],
	handler: async (context) => {
		const { args, addMessage } = context

		addMessage({
			id: Date.now().toString(),
			type: "system",
			content: "Starting interactive configuration editor...",
			ts: Date.now(),
		})

		try {
			const directOption = args.length > 0 && args[0] ? parseInt(args[0]) : undefined
			await startInteractiveConfigEditor(context, directOption)
		} catch (error) {
			addMessage({
				id: Date.now().toString(),
				type: "error",
				content: `Failed to start configuration editor: ${error instanceof Error ? error.message : String(error)}`,
				ts: Date.now(),
			})
		}
	},
}
