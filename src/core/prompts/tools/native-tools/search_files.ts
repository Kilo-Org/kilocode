import type OpenAI from "openai"

export default {
	type: "function",
	function: {
		name: "search_files",
		description: "Run a regex search across files under a directory, returning matches with surrounding context.",
		strict: true,
		parameters: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "Directory to search recursively, relative to the workspace",
				},
				regex: {
					type: "string",
					description: "Rust-compatible regular expression pattern to match",
				},
				file_pattern: {
					type: ["string", "null"],
					description: "Optional glob to limit which files are searched (e.g., *.ts)",
				},
			},
			required: ["path", "regex", "file_pattern"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
