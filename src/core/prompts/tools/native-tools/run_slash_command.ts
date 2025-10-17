import type OpenAI from "openai"

export default {
	type: "function",
	function: {
		name: "run_slash_command",
		description:
			"Execute a predefined slash command to receive detailed instructions or content for a common task.",
		strict: true,
		parameters: {
			type: "object",
			properties: {
				command: {
					type: "string",
					description: "Name of the slash command to run (e.g., init, test, deploy)",
				},
				args: {
					type: ["string", "null"],
					description: "Optional additional context or arguments for the command",
				},
			},
			required: ["command", "args"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
