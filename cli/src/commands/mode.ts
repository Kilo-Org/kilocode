/**
 * /mode command - Switch between different modes
 */

import type { Command } from "./core/types.js"
import { getAllModes } from "../constants/modes/defaults.js"

export const modeCommand: Command = {
	name: "mode",
	aliases: ["m"],
	description: "Switch to a different mode",
	usage: "/mode <mode-name>",
	examples: ["/mode code", "/mode architect", "/mode debug"],
	category: "settings",
	priority: 9,
	arguments: [
		{
			name: "mode-name",
			description: "The mode to switch to",
			required: true,
			// Values will be populated dynamically from context
			placeholder: "Select a mode",
		},
	],
	handler: async (context) => {
		const { args, addMessage, setMode, customModes } = context

		// Get all available modes (default + custom)
		const allModes = getAllModes(customModes)
		const availableSlugs = allModes.map((mode) => mode.slug)

		if (args.length === 0 || !args[0]) {
			// Show current mode and available modes
			const modesList = allModes.map((mode) => {
				// Treat undefined source as "global" (for built-in modes from @roo-code/types)
				const source =
					mode.source === "project" ? " (project)" : mode.source === "global" || !mode.source ? " (global)" : ""
				return `  - **${mode.name}** (${mode.slug})${source}: ${mode.description || "No description"}`
			})

			addMessage({
				id: Date.now().toString(),
				type: "system",
				content: ["**Available Modes:**", "", ...modesList, "", "Usage: /mode <mode-name>"].join("\n"),
				ts: Date.now(),
			})
			return
		}

		const requestedMode = args[0].toLowerCase()

		if (!availableSlugs.includes(requestedMode)) {
			addMessage({
				id: Date.now().toString(),
				type: "error",
				content: `Invalid mode "${requestedMode}". Available modes: ${availableSlugs.join(", ")}`,
				ts: Date.now(),
			})
			return
		}

		// Find the mode to get its display name
		const mode = allModes.find((m) => m.slug === requestedMode)
		const modeName = mode?.name || requestedMode

		setMode(requestedMode)

		addMessage({
			id: Date.now().toString(),
			type: "system",
			content: `Switched to **${modeName}** mode.`,
			ts: Date.now(),
		})
	},
}
