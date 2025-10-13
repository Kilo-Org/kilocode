/**
 * /exit command - Exit the CLI
 */

import type { Command } from "./core/types.js"

export const exitCommand: Command = {
	name: "exit",
	aliases: ["quit", "q"],
	description: "Exit the CLI",
	usage: "/exit",
	examples: ["/exit"],
	category: "system",
	handler: async (context) => {
		const { exit } = context
		exit()
	},
}
