/**
 * /help command - Display available commands
 */

import type { Command } from "./core/types.js"
import { commandRegistry } from "./core/registry.js"

export const helpCommand: Command = {
	name: "help",
	aliases: ["h", "?"],
	description: "Display available commands and their usage",
	usage: "/help [command]",
	examples: ["/help", "/help mode", "/help settings"],
	category: "system",
	priority: 10,
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

			if (command.aliases.length > 0) {
				helpText.push(`**Aliases:** ${command.aliases.join(", ")}`)
				helpText.push("")
			}

			if (command.examples.length > 0) {
				helpText.push("**Examples:**")
				command.examples.forEach((example) => {
					helpText.push(`  ${example}`)
				})
				helpText.push("")
			}

			if (command.options && command.options.length > 0) {
				helpText.push("**Options:**")
				command.options.forEach((option) => {
					const optionStr = option.alias ? `--${option.name}, -${option.alias}` : `--${option.name}`
					const required = option.required ? " (required)" : ""
					helpText.push(`  ${optionStr}${required} - ${option.description}`)
				})
			}

			addMessage({
				id: Date.now().toString(),
				type: "system",
				content: helpText.join("\n"),
				ts: Date.now(),
			})
			return
		}

		// Show all commands grouped by category
		const categories: Record<string, Command[]> = {
			chat: [],
			settings: [],
			navigation: [],
			system: [],
		}

		commandRegistry.getAll().forEach((cmd) => {
			const category = categories[cmd.category]
			if (category) {
				category.push(cmd)
			}
		})

		const helpText = ["**Available Commands**", ""]

		// Chat commands
		if (categories.chat && categories.chat.length > 0) {
			helpText.push("**Chat:**")
			categories.chat.forEach((cmd) => {
				helpText.push(`  /${cmd.name} - ${cmd.description}`)
			})
			helpText.push("")
		}

		// Settings commands
		if (categories.settings && categories.settings.length > 0) {
			helpText.push("**Settings:**")
			categories.settings.forEach((cmd) => {
				helpText.push(`  /${cmd.name} - ${cmd.description}`)
			})
			helpText.push("")
		}

		// Navigation commands
		if (categories.navigation && categories.navigation.length > 0) {
			helpText.push("**Navigation:**")
			categories.navigation.forEach((cmd) => {
				helpText.push(`  /${cmd.name} - ${cmd.description}`)
			})
			helpText.push("")
		}

		// System commands
		if (categories.system && categories.system.length > 0) {
			helpText.push("**System:**")
			categories.system.forEach((cmd) => {
				helpText.push(`  /${cmd.name} - ${cmd.description}`)
			})
			helpText.push("")
		}

		helpText.push("Type /help <command> for detailed information about a specific command.")

		addMessage({
			id: Date.now().toString(),
			type: "system",
			content: helpText.join("\n"),
			ts: Date.now(),
		})
	},
}
