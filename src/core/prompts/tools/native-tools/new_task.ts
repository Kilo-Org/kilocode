import type OpenAI from "openai"

export default {
	type: "function",
	function: {
		name: "new_task",
		description: `This will let you create a new task instance in the chosen mode using your provided message.
Parameters:
- mode: (required) The slug of the mode to start the new task in (e.g., "code", "debug", "architect").
- message: (required) The initial user message or instructions for this new task.
- todos: (optional) The initial todo list in markdown checklist format for the new task.`,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				mode: {
					type: "string",
					description: "Slug of the mode to begin the new task in (e.g., code, debug, architect)",
				},
				message: {
					type: "string",
					description: "Initial user instructions or context for the new task",
				},
				todos: {
					type: ["string", "null"],
					description:
						"Optional initial todo list written as a markdown checklist; required when the workspace mandates todos",
				},
			},
			required: ["mode", "message", "todos"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
