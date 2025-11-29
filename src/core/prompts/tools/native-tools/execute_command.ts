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
				// kilocode_change start - run_in_background
				run_in_background: {
					type: ["boolean", "null"],
					description: "Set to true to run the command in the background without waiting for completion",
				},
			},
			required: ["command", "cwd", "run_in_background"],
			// kilocode_change end - run_in_background
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
