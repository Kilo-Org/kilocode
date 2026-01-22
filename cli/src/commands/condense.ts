/**
 * /condense command - Manually trigger context condensation
 */

import type { Command } from "./core/types.js"

export const condenseCommand: Command = {
	name: "condense",
	aliases: [],
	description: "Condense the conversation context to reduce token usage",
	usage: "/condense",
	examples: ["/condense"],
	category: "chat",
	priority: 6,
	handler: async (context) => {
		const { condenseAndWait, addMessage, currentTask } = context

		const now = Date.now()

		if (!currentTask) {
			addMessage({
				id: `condense-error-${now}`,
				type: "error",
				content: "No active task to condense. Start a conversation first.",
				ts: now,
			})
			return
		}

		addMessage({
			id: `condense-start-${now}`,
			type: "system",
			content: "Condensing conversation context...",
			ts: now,
		})

		try {
			// Send request to extension and wait for completion
			await condenseAndWait(currentTask.id)

			addMessage({
				id: `condense-complete-${Date.now()}`,
				type: "system",
				content: "Context condensation complete.",
				ts: Date.now(),
			})
		} catch (error) {
			addMessage({
				id: `condense-error-${Date.now()}`,
				type: "error",
				content: `Context condensation failed: ${error instanceof Error ? error.message : String(error)}`,
				ts: Date.now(),
			})
		}
	},
}
