import type OpenAI from "openai"

export default {
	type: "function",
	function: {
		name: "insert_content",
		description:
			"Insert new lines into a file without modifying existing content. Choose a line number to insert before, or use 0 to append to the end.",
		strict: true,
		parameters: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "File path to modify, expressed relative to the workspace",
				},
				line: {
					type: "integer",
					description: "1-based line number to insert before, or 0 to append at the end of the file",
					minimum: 0,
				},
				content: {
					type: "string",
					description: "Exact text to insert at the chosen location",
				},
			},
			required: ["path", "line", "content"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
