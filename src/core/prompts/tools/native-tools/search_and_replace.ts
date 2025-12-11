import type OpenAI from "openai"

const SEARCH_AND_REPLACE_DESCRIPTION = `Apply precise, targeted modifications to an existing file using search and replace operations. This tool is for surgical edits only; provide an array of operations where each operation specifies the exact text to search for and what to replace it with. The search text must exactly match the existing content, including whitespace and indentation.`

const search_and_replace = {
	type: "function",
	function: {
		name: "search_and_replace",
		description: SEARCH_AND_REPLACE_DESCRIPTION,
		parameters: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "The path of the file to modify, relative to the current workspace directory.",
				},
				operations: {
					type: "array",
					description: "Array of search and replace operations to perform on the file.",
					items: {
						type: "object",
						properties: {
							search: {
								type: "string",
								description:
									"The exact text to find in the file. Must match exactly, including whitespace.",
							},
							replace: {
								type: "string",
								description: "The text to replace the search text with.",
							},
						},
						required: ["search", "replace"],
					},
					minItems: 1,
				},
			},
			required: ["path", "operations"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool

export default search_and_replace
