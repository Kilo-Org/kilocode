// kilocode_change - new file
import type OpenAI from "openai"

export default {
	type: "function",
	function: {
		name: "terminal_kill",
		description: "Kill a process running in a specific terminal by terminal ID",
		strict: true,
		parameters: {
			type: "object",
			properties: {
				terminal_id: {
					type: "integer",
					description: "The terminal ID containing the process to kill",
				},
			},
			required: ["terminal_id"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
