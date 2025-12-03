/**
 * /clearcontext command - Clear all conversation context and state
 */

import { generateMessage } from "../ui/utils/messages.js"
import type { Command } from "./core/types.js"

export const clearContextCommand: Command = {
	name: "clearcontext",
	aliases: ["cc", "clear"],
	description: "Clear all conversation context, messages, and state",
	usage: "/clearcontext",
	examples: ["/clearcontext"],
	category: "chat",
	priority: 7,
	arguments: [],
	handler: async (context) => {
		const { addMessage, clearMessages, clearTask, refreshTerminal } = context

		try {
			addMessage({
				...generateMessage(),
				type: "system",
				content: "🧹 Clearing all conversation context and state...",
				ts: Date.now(),
			})

			await refreshTerminal()

			// Clear chat messages
			clearMessages()

			// Clear task state
			await clearTask()

			addMessage({
				...generateMessage(),
				type: "system",
				content:
					"✅ All context cleared successfully!\n\n**What was cleared:**\n• All chat messages and conversation history\n• Current task and todo items\n• All accumulated context from memory\n\nYou can now start a fresh conversation with a clean slate.",
				ts: Date.now(),
			})
		} catch (error) {
			addMessage({
				...generateMessage(),
				type: "error",
				content: `Failed to clear context: ${error instanceof Error ? error.message : String(error)}`,
			})
		}
	},
}
