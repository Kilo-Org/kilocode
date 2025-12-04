import type OpenAI from "openai"

export default {
	type: "function",
	function: {
		name: "new_task",
		description:
			"Create a new task instance in a specified mode, supplying the initial instructions and optionally a starting todo list when required by settings.",
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
