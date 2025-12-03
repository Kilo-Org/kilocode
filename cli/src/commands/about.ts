import type { Command } from "./core/types.js"
import { commandRegistry } from "./core/registry.js"

export const aboutCommand: Command = {
	name: "about",
	aliases: ["a", "info"],
	description: "Show information about the CLI",
	usage: "/about",
	examples: ["/about"],
	category: "settings",
	priority: 9,
	handler: async (context) => {
		const { args, addMessage } = context

		// If a specific command is requested
		if (args.length > 0 && args[0]) {
			const commandName = args[0]
			const command = commandRegistry.get(commandName)

			if (!command) {
				addMessage({
					id: Date.now().toString(),
					type: "error",
					content: `Command "${commandName}" not found. Use /help to see all available commands.`,
					ts: Date.now(),
				})
				return
			}

			// Show detailed help for specific command
			const helpText = [`**${command.name}** - ${command.description}`, "", `**Usage:** ${command.usage}`, ""]

			addMessage({
				id: Date.now().toString(),
				type: "system",
				content: helpText.join("\n"),
				ts: Date.now(),
			})
			return
		}

		addMessage({
			id: Date.now().toString(),
			type: "system",
			content: "This is Kilocode CLI by Involvex\nhttps://github.com/involvex/kilocode",
			ts: Date.now(),
		})
	},
}
