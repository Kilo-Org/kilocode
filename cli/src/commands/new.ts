/**
 * /new command - Start a new task with a clean slate
 */

import { createWelcomeMessage } from "../ui/utils/welcomeMessage.js"
import type { Command } from "./core/types.js"
import { SessionService } from "../services/session.js"

export const newCommand: Command = {
	name: "new",
	aliases: ["n", "start"],
	description: "Start a new task with a clean slate",
	usage: "/new",
	examples: ["/new", "/n", "/start"],
	category: "system",
	priority: 9,
	handler: async (context) => {
		const { clearTask, replaceMessages, refreshTerminal } = context

		// Clear the extension task state (this also clears extension messages)
		await clearTask()

		// Clear the session to start fresh
		try {
			const sessionService = SessionService.init()
			await sessionService.destroy()
		} catch (error) {
			// Log error but don't block the command - session might not exist yet
			console.error("Failed to clear session:", error)
		}

		// Replace CLI message history with fresh welcome message
		// This will increment the reset counter, forcing Static component to re-render
		replaceMessages([
			createWelcomeMessage({
				clearScreen: true,
				showInstructions: true,
				instructions: [
					"🎉 Fresh start! Ready for a new task.",
					"All previous messages and task state have been cleared.",
					"Type your message to begin, or use /help to explore available commands.",
				],
			}),
		])

		// Force terminal refresh to clear screen
		await refreshTerminal()
	},
}
