/**
 * /mode command - Switch between different modes
 */

import type { Command, ArgumentValue } from "./core/types.js"
import { DEFAULT_MODES } from "../constants/modes/defaults.js"

// Convert modes to ArgumentValue format
const MODE_VALUES: ArgumentValue[] = DEFAULT_MODES.map((mode) => ({
	value: mode.slug,
	...(mode.description && { description: mode.description }),
}))

// Extract mode slugs for validation
const AVAILABLE_MODE_SLUGS = DEFAULT_MODES.map((mode) => mode.slug)

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
			values: MODE_VALUES,
			placeholder: "Select a mode",
			validate: (value) => {
				const isValid = AVAILABLE_MODE_SLUGS.includes(value.toLowerCase())
				return {
					valid: isValid,
					...(isValid ? {} : { error: `Invalid mode. Available: ${AVAILABLE_MODE_SLUGS.join(", ")}` }),
				}
			},
		},
	],
	handler: async (context) => {
		const { args, addMessage, setMode } = context

		if (args.length === 0 || !args[0]) {
			// Show current mode and available modes
			addMessage({
				id: Date.now().toString(),
				type: "system",
				content: [
					"**Available Modes:**",
					"",
					...DEFAULT_MODES.map((mode) => `  - **${mode.name}** (${mode.slug}): ${mode.description}`),
					"",
					"Usage: /mode <mode-name>",
				].join("\n"),
				ts: Date.now(),
			})
			return
		}

		const requestedMode = args[0].toLowerCase()

		if (!AVAILABLE_MODE_SLUGS.includes(requestedMode)) {
			addMessage({
				id: Date.now().toString(),
				type: "error",
				content: `Invalid mode "${requestedMode}". Available modes: ${AVAILABLE_MODE_SLUGS.join(", ")}`,
				ts: Date.now(),
			})
			return
		}

		// Find the mode to get its display name
		const mode = DEFAULT_MODES.find((m) => m.slug === requestedMode)
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
