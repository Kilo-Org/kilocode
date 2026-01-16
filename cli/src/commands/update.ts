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
			// Check for updates
			addMessage({
				...generateMessage(),
				type: "system",
				content: "Checking for updates...",
			})

			const updateResult = await checkForUpdates()

			if (!updateResult.updateAvailable) {
				// No update available
				addMessage({
					...generateMessage(),
					type: "system",
					content: updateResult.message,
				})
				return
			}

			// Update is available
			addMessage({
				...generateMessage(),
				type: "system",
				content: updateResult.message,
			})

			// Ask user to confirm
			addMessage({
				...generateMessage(),
				type: "system",
				content: "Would you like to update now? This will install the latest version and restart the CLI.",
			})

			// Note: In a real implementation, we would wait for user confirmation here
			// For now, we'll proceed with the update automatically
			// TODO: Add interactive confirmation when the CLI supports it

			// Perform the update
			addMessage({
				...generateMessage(),
				type: "system",
				content: "Installing update...",
			})

			const updateResult2 = await performUpdate()

			if (!updateResult2.success) {
				addMessage({
					...generateMessage(),
					type: "error",
					content: updateResult2.message,
				})
				return
			}

			// Update successful
			addMessage({
				...generateMessage(),
				type: "system",
				content: updateResult2.message,
			})

			// Update lastUpdateCheck in config
			config.lastUpdateCheck = new Date().toISOString()

			// Restart the CLI
			addMessage({
				...generateMessage(),
				type: "system",
				content: "Restarting CLI...",
			})

			restartCLI()
		} catch (error) {
			addMessage({
				...generateMessage(),
				type: "error",
				content: `Update command failed: ${error instanceof Error ? error.message : String(error)}`,
			})
		}
	},
}
