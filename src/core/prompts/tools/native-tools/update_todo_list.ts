import type OpenAI from "openai"

export default {
	type: "function",
	function: {
		name: "update_todo_list",
		description:
			"Replace the entire todo list with an updated single-level markdown checklist that reflects the current plan and status. Always confirm completed work, keep unfinished items, add new actionable tasks, and follow the [ ], [x], [-] status rules.",
		strict: true,
		parameters: {
			type: "object",
			properties: {
				todos: {
					type: "string",
					description:
						"Full markdown checklist in execution order, using [ ] for pending, [x] for completed, and [-] for in progress",
				},
			},
			required: ["todos"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
