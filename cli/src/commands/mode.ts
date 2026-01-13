import type { ModeConfig } from "../types/messages.js"
import type { Command, ArgumentProviderContext, CommandContext } from "./core/types.js"
import { getAllModes } from "../constants/modes/defaults.js"

async function modeAutocompleteProvider(context: ArgumentProviderContext) {
	const customModes = context.commandContext?.customModes || []
	const allModes = getAllModes(customModes)

	return allModes.map((mode) => ({
		value: mode.slug,
		title: mode.name,
		description: `${mode.description || "No description"}${formatSourceLabel(mode.source)}`,
		matchScore: 1.0,
		highlightedValue: mode.slug,
	}))
}

function formatSourceLabel(source: "global" | "project" | "organization" | undefined): string {
	switch (source) {
		case "project":
			return " (project)"
		case "organization":
			return " (organization)"
		case "global":
		case undefined:
			return " (global)"
	}
}

function showAvailableModes(allModes: ModeConfig[], addMessage: CommandContext["addMessage"]) {
	const modesList = allModes.map(
		(mode) =>
			`  - **${mode.name}** (${mode.slug})${formatSourceLabel(mode.source)}: ${mode.description || "No description"}`,
	)

	addMessage({
		id: Date.now().toString(),
		type: "system",
		content: ["**Available Modes:**", "", ...modesList, "", "Usage: /mode <mode-name>"].join("\n"),
		ts: Date.now(),
	})
}

function showInvalidModeError(
	requestedMode: string,
	availableSlugs: string[],
	addMessage: CommandContext["addMessage"],
) {
	addMessage({
		id: Date.now().toString(),
		type: "error",
		content: `Invalid mode "${requestedMode}". Available modes: ${availableSlugs.join(", ")}`,
		ts: Date.now(),
	})
}

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
			provider: modeAutocompleteProvider,
			placeholder: "Select a mode",
		},
	],
	handler: async (context) => {
		const { args, addMessage, setMode, customModes } = context
		const allModes = getAllModes(customModes)
		const availableSlugs = allModes.map((mode) => mode.slug)

		if (args.length === 0 || !args[0]) {
			showAvailableModes(allModes, addMessage)
			return
		}

		const requestedMode = args[0].toLowerCase()

		if (!availableSlugs.includes(requestedMode)) {
			showInvalidModeError(requestedMode, availableSlugs, addMessage)
			return
		}

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
