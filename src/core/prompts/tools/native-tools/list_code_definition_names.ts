import type OpenAI from "openai"

export default {
	type: "function",
	function: {
		name: "list_code_definition_names",
		description:
			"List definition names (classes, functions, methods, etc.) from source files to understand code structure. Works on a single file or across all top-level files in a directory.",
		strict: true,
		parameters: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "Path to the file or directory to analyze, relative to the workspace",
				},
			},
			required: ["path"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
