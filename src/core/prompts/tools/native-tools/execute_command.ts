import type OpenAI from "openai"

export default {
	type: "function",
	function: {
		name: "execute_command",
		description:
			"Run a CLI command on the user's system. Tailor the command to the environment, explain what it does, and prefer relative paths or shell-appropriate chaining. Use the cwd parameter only when directed to run in a different directory.",
		strict: true,
		parameters: {
			type: "object",
			properties: {
				command: {
					type: "string",
					description: "Shell command to execute",
				},
				cwd: {
					type: ["string", "null"],
					description: "Optional working directory for the command, relative or absolute",
				},
			},
			required: ["command", "cwd"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
