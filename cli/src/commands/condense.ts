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
		const { sendWebviewMessage, addMessage, currentTask } = context

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

		// Send request to extension with the task ID
		await sendWebviewMessage({
			type: "condenseTaskContextRequest",
			text: currentTask.id,
		})
	},
}
