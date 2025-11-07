import type OpenAI from "openai"

export default {
	type: "function",
	function: {
		name: "write_to_file",
		description:
			"Create a new file. Use only when creating a new file. the tool will create missing directories automatically.",
		strict: true,
		parameters: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "Path to the file to write, relative to the workspace",
				},
				content: {
					type: "string",
					description: "Full contents that the file should contain with no omissions or line numbers",
				},
				line_count: {
					type: "integer",
					description: "Total number of lines in the written file, counting blank lines",
				},
			},
			required: ["path", "content", "line_count"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
