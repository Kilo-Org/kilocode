/**
 * /colorblind command - Toggle colorblind mode
 */
import type { Command } from "./core/types.js"
import { generateMessage } from "../ui/utils/messages.js"

export const colorblindCommand: Command = {
	name: "colorblind",
	aliases: ["cb"],
	description: "Toggle colorblind-friendly theme",
	usage: "/colorblind [on|off]",
	examples: ["/colorblind on", "/colorblind off", "/colorblind"],
	category: "settings",
	priority: 7,
	arguments: [
		{
			name: "state",
			description: "Enable or disable colorblind mode (optional for toggle)",
			required: false,
			placeholder: "on/off/toggle",
			provider: async () => [
				{
					value: "on",
					title: "Enable",
					description: "Enable colorblind-friendly theme",
					matchScore: 1.0,
					highlightedValue: "on",
				},
				{
					value: "off",
					title: "Disable",
					description: "Disable colorblind-friendly theme",
					matchScore: 1.0,
					highlightedValue: "off",
				},
				{
					value: "toggle",
					title: "Toggle",
					description: "Toggle colorblind mode",
					matchScore: 1.0,
					highlightedValue: "toggle",
				},
			],
			validate: async (value, _context) => {
				const validValues = ["on", "off", "toggle"]
				const isValid = validValues.includes(value.toLowerCase())

				return {
					valid: isValid,
					...(isValid ? {} : { error: `Invalid state. Use: ${validValues.join(", ")}` }),
				}
			},
		},
	],
	handler: async (context) => {
		const { args, addMessage, setTheme, config, refreshTerminal } = context
		const currentTheme = config.theme || "dark"

		try {
			let newState: "on" | "off"
			let action: string

			if (args.length === 0 || !args[0]) {
				// Toggle mode
				newState = currentTheme === "colorblind" ? "off" : "on"
				action = "Toggled"
			} else {
				const stateArg = args[0].toLowerCase()
				if (stateArg === "toggle") {
					newState = currentTheme === "colorblind" ? "off" : "on"
					action = "Toggled"
				} else if (stateArg === "on") {
					newState = "on"
					action = "Enabled"
				} else if (stateArg === "off") {
					newState = "off"
					action = "Disabled"
				} else {
					addMessage({
						...generateMessage(),
						type: "error",
						content: `Invalid state "${stateArg}". Use: on, off, or toggle`,
					})
					return
				}
			}

			if (newState === "on") {
				// Enable colorblind mode
				await setTheme("colorblind")
				addMessage({
					...generateMessage(),
					type: "system",
					content: `${action} colorblind-friendly theme.`,
				})
			} else {
				// Disable colorblind mode - restore previous theme or use default
				const previousTheme = currentTheme === "colorblind" ? "dark" : currentTheme
				await setTheme(previousTheme)
				addMessage({
					...generateMessage(),
					type: "system",
					content: `${action} colorblind-friendly theme.`,
				})
			}

			await refreshTerminal()
		} catch (error) {
			addMessage({
				...generateMessage(),
				type: "error",
				content: `Failed to ${args[0] || "toggle"} colorblind mode: ${error instanceof Error ? error.message : String(error)}`,
			})
		}
	},
}
