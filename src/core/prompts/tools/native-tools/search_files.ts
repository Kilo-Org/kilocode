import type OpenAI from "openai"

export default function search_files(cwd: string): OpenAI.Chat.ChatCompletionTool {
	return {
		type: "function",
		function: {
			name: "search_files",
			description: `Description: Request to perform a regex search across files in a specified directory, providing context-rich results. This tool searches for patterns or specific content across multiple files, displaying each match with encapsulating context.
Parameters:
- path: (required) The path of the directory to search in (relative to the current workspace directory ${cwd}). This directory will be recursively searched.
- regex: (required) The regular expression pattern to search for. Uses Rust regex syntax.
- file_pattern: (optional) Glob pattern to filter files (e.g., '*.ts' for TypeScript files). If not provided, it will search all files (*).`,
			strict: true,
			parameters: {
				type: "object",
				properties: {
					path: {
						type: "string",
						description: `(required) The path of the directory to search in (relative to the current workspace directory ${cwd}). This directory will be recursively searched.`,
					},
					regex: {
						type: "string",
						description: "(required) The regular expression pattern to search for. Uses Rust regex syntax",
					},
					file_pattern: {
						type: ["string", "null"],
						description:
							"(optional) Glob pattern to filter files (e.g., '*.ts' for TypeScript files). If not provided, it will search all files (*).",
					},
				},
				required: ["path", "regex", "file_pattern"],
				additionalProperties: false,
			},
		},
	}
}
