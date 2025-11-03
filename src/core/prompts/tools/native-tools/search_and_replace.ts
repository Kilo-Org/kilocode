import type OpenAI from "openai"

export default {
	type: "function",
	function: {
		name: "search_and_replace",
		description:
			"Find and replace text within a file using literal strings or regular expressions. Supports optional line ranges, regex mode, and case-insensitive matching, and shows a diff preview before applying changes.",
		strict: true,
		parameters: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "File path to modify, relative to the workspace",
				},
				search: {
					type: "string",
					description: "Text or pattern to search for",
				},
				replace: {
					type: "string",
					description: "Replacement text to insert for each match",
				},
				start_line: {
					type: ["integer", "null"],
					description: "Optional starting line (1-based) to limit replacements",
				},
				end_line: {
					type: ["integer", "null"],
					description: "Optional ending line (1-based) to limit replacements",
				},
				use_regex: {
					type: ["boolean", "null"],
					description: "Set true to treat the search parameter as a regular expression",
				},
				ignore_case: {
					type: ["boolean", "null"],
					description: "Set true to ignore case when matching",
				},
			},
			required: ["path", "search", "replace", "start_line", "end_line", "use_regex", "ignore_case"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
