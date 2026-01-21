/**
 * /commands command - Manage custom slash commands
 */

import type { Command } from "./core/types.js"
import { getCustomSlashCommands, registerCustomSlashCommands } from "../services/customSlashCommands.js"

export const commandsCommand: Command = {
	name: "commands",
	aliases: ["cmds"],
	description: "List or reload custom slash commands",
	usage: "/commands [list|reload]",
	examples: ["/commands", "/commands list", "/commands reload"],
	category: "system",
	priority: 6,
	handler: async (context) => {
		const { args, addMessage, workspacePath } = context
		const subcommand = (args[0] || "list").toLowerCase()

		if (subcommand === "reload" || subcommand === "refresh") {
			const commands = await registerCustomSlashCommands(workspacePath)
			addMessage({
				id: Date.now().toString(),
				type: "system",
				content: `Reloaded ${commands.length} custom command${commands.length === 1 ? "" : "s"}.`,
				ts: Date.now(),
			})
			return
		}

		const commands = getCustomSlashCommands()
		if (commands.length === 0) {
			addMessage({
				id: Date.now().toString(),
				type: "system",
				content:
					"No custom commands found. Add Markdown files to .kilocode/commands or ~/.kilocode/cli/commands.",
				ts: Date.now(),
			})
			return
		}

		const grouped = {
			project: commands.filter((cmd) => cmd.metadata.scope === "project"),
			user: commands.filter((cmd) => cmd.metadata.scope === "user"),
		}

		const lines: string[] = ["**Custom Commands**", ""]

		if (grouped.project.length > 0) {
			lines.push("**Project:**")
			grouped.project.forEach((cmd) => {
				const hint = cmd.metadata.argumentHint ? ` ${cmd.metadata.argumentHint}` : ""
				lines.push(`  /${cmd.name}${hint} - ${cmd.description}`)
			})
			lines.push("")
		}

		if (grouped.user.length > 0) {
			lines.push("**User:**")
			grouped.user.forEach((cmd) => {
				const hint = cmd.metadata.argumentHint ? ` ${cmd.metadata.argumentHint}` : ""
				lines.push(`  /${cmd.name}${hint} - ${cmd.description}`)
			})
			lines.push("")
		}

		lines.push("Use /commands reload to rescan custom commands.")

		addMessage({
			id: Date.now().toString(),
			type: "system",
			content: lines.join("\n"),
			ts: Date.now(),
		})
	},
}
