import type OpenAI from "openai"

export default {
	type: "function",
	function: {
		name: "file_edit",
		description:
			"Replace existing text within a single file without constructing manual diff blocks. Provide the current text (`old_string`) and the desired text (`new_string`). By default only a single uniquely matched occurrence is replaced; set `replace_all` to true to update every matching occurrence.",
		strict: true,
		parameters: {
			type: "object",
			properties: {
				target_file: {
					type: "string",
					description: "Path to the file to modify, relative to the workspace root.",
				},
				old_string: {
					type: "string",
					description:
						"Exact text to replace. Provide enough context for a unique match. Use an empty string to replace the entire file.",
				},
				new_string: {
					type: "string",
					description:
						"Replacement text. This will be inserted in place of the matched section. Can be an empty string to delete the match.",
				},
				replace_all: {
					type: "boolean",
					description:
						"Set to true to replace every occurrence of the matched text. Defaults to false (replace a single uniquely identified occurrence).",
				},
			},
			required: ["target_file", "old_string", "new_string"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
