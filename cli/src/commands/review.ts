/**
 * /review command - Review uncommitted changes or branch diff
 *
 * This command triggers a code review of local git changes.
 * It sends the /review message to the extension, which handles
 * collecting git diff context and building the review prompt.
 */

import type { Command } from "./core/types.js"

export const reviewCommand: Command = {
	name: "review",
	aliases: ["r", "cr"],
	description: "Review uncommitted changes or branch diff",
	usage: "/review [instructions]",
	examples: ["/review", "/review focus on security", "/review check error handling"],
	category: "chat",
	priority: 8,
	handler: async (context) => {
		const { sendWebviewMessage, args } = context

		// Build the review message with optional user instructions
		const userInstructions = args.join(" ")
		const reviewMessage = userInstructions ? `/review ${userInstructions}` : "/review"

		// Send to extension - the extension's slash command handler
		// will process /review and collect git diff context
		await sendWebviewMessage({
			type: "newTask",
			text: reviewMessage,
		})
	},
}
