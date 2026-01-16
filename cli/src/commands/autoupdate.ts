/**
 * /autoupdate command - Enable or disable automatic updates
 */

import type { Command } from "./core/types.js"
import { generateMessage } from "../ui/utils/messages.js"
import { saveConfig } from "../config/persistence.js"

export const autoupdateCommand: Command = {
	name: "autoupdate",
	aliases: [],
	description: "Enable or disable automatic CLI updates",
	usage: "/autoupdate [on|off]",
	examples: ["/autoupdate on", "/autoupdate off", "/autoupdate"],
	category: "settings",
	arguments: [
		{
			name: "action",
			description: "Action to perform: 'on' to enable, 'off' to disable, or omit to check status",
			required: false,
			values: [
				{ value: "on", description: "Enable automatic updates" },
				{ value: "off", description: "Disable automatic updates" },
			],
		},
	],
	handler: async (context) => {
		const { args, addMessage, config } = context

		try {
			if (args.length === 0 || !args[0]) {
				displayStatus(addMessage, config.autoUpdate)
				return
			}

			const action = args[0].toLowerCase()

			if (action === "on") {
				await enableAutoUpdate(addMessage, config)
			} else if (action === "off") {
				await disableAutoUpdate(addMessage, config)
			} else {
				displayInvalidAction(addMessage, action)
			}
		} catch (error) {
			displayError(addMessage, error)
		}
	},
}

function displayStatus(addMessage: (msg: any) => void, enabled: boolean | undefined): void {
	const status = enabled ? "enabled" : "disabled"
	addMessage({
		...generateMessage(),
		type: "system",
		content: `Auto-update is currently ${status}.`,
	})
}

async function enableAutoUpdate(addMessage: (msg: any) => void, config: any): Promise<void> {
	config.autoUpdate = true
	await saveConfig(config)

	addMessage({
		...generateMessage(),
		type: "system",
		content:
			"Auto-update is now enabled. The CLI will automatically check for updates and update when a new version is available.",
	})
}

async function disableAutoUpdate(addMessage: (msg: any) => void, config: any): Promise<void> {
	config.autoUpdate = false
	await saveConfig(config)

	addMessage({
		...generateMessage(),
		type: "system",
		content: "Auto-update is now disabled.",
	})
}

function displayInvalidAction(addMessage: (msg: any) => void, action: string): void {
	addMessage({
		...generateMessage(),
		type: "error",
		content: `Invalid action "${action}". Use "on" to enable or "off" to disable auto-update.`,
	})
}

function displayError(addMessage: (msg: any) => void, error: unknown): void {
	addMessage({
		...generateMessage(),
		type: "error",
		content: `Auto-update command failed: ${error instanceof Error ? error.message : String(error)}`,
	})
}
