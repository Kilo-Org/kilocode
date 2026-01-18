/**
 * /update command - Check for and install CLI updates
 */

import type { Command } from "./core/types.js"
import { checkForUpdates, performUpdate, restartCLI } from "../services/update.js"
import { generateMessage } from "../ui/utils/messages.js"

export const updateCommand: Command = {
	name: "update",
	aliases: [],
	description: "Check for and install CLI updates",
	usage: "/update",
	examples: ["/update"],
	category: "system",
	handler: async (context) => {
		const { addMessage, config } = context

		try {
			const updateResult = await checkForUpdates()

			if (!updateResult.updateAvailable) {
				displayNoUpdateAvailable(addMessage, updateResult.message)
				return
			}

			displayUpdateAvailable(addMessage, updateResult.message)

			const confirmed = await waitForUserConfirmation()

			if (!confirmed) {
				displayUpdateCancelled(addMessage)
				return
			}

			await performUpdateAndRestart(addMessage, config)
		} catch (error) {
			displayError(addMessage, error)
		}
	},
}

function displayNoUpdateAvailable(addMessage: (msg: any) => void, message: string): void {
	addMessage({
		...generateMessage(),
		type: "system",
		content: "Checking for updates...",
	})
	addMessage({
		...generateMessage(),
		type: "system",
		content: message,
	})
}

function displayUpdateAvailable(addMessage: (msg: any) => void, message: string): void {
	addMessage({
		...generateMessage(),
		type: "system",
		content: "Checking for updates...",
	})
	addMessage({
		...generateMessage(),
		type: "system",
		content: message,
	})
	addMessage({
		...generateMessage(),
		type: "system",
		content: "Would you like to update now? This will install the latest version and restart the CLI.",
	})
}

function displayUpdateCancelled(addMessage: (msg: any) => void): void {
	addMessage({
		...generateMessage(),
		type: "system",
		content: "Update cancelled.",
	})
}

async function performUpdateAndRestart(addMessage: (msg: any) => void, config: any): Promise<void> {
	addMessage({
		...generateMessage(),
		type: "system",
		content: "Installing update...",
	})

	const updateResult = await performUpdate()

	if (!updateResult.success) {
		addMessage({
			...generateMessage(),
			type: "error",
			content: updateResult.message,
		})
		return
	}

	addMessage({
		...generateMessage(),
		type: "system",
		content: updateResult.message,
	})

	config.lastUpdateCheck = new Date().toISOString()

	addMessage({
		...generateMessage(),
		type: "system",
		content: "Restarting CLI...",
	})

	restartCLI()
}

function displayError(addMessage: (msg: any) => void, error: unknown): void {
	addMessage({
		...generateMessage(),
		type: "error",
		content: `Update command failed: ${error instanceof Error ? error.message : String(error)}`,
	})
}

/**
 * Wait for user confirmation (y/n).
 * Returns true if user confirms, false otherwise.
 */
async function waitForUserConfirmation(): Promise<boolean> {
	return new Promise((resolve) => {
		const readline = require("readline").createInterface({
			input: process.stdin,
			output: process.stdout,
		})

		readline.question("Update now? (y/n): ", (answer: string) => {
			readline.close()
			const normalized = answer.trim().toLowerCase()
			resolve(normalized === "y" || normalized === "yes")
		})
	})
}
