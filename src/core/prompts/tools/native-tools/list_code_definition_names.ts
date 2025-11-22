import type OpenAI from "openai"

export default function list_code_definition_names(cwd: string): OpenAI.Chat.ChatCompletionTool {
	return {
		type: "function",
		function: {
			name: "list_code_definition_names",
			description: `Description: Request to list definition names (classes, functions, methods, etc.) from source code. This tool can analyze either a single file or all files at the top level of a specified directory. It provides insights into the codebase structure and important constructs, encapsulating high-level concepts and relationships that are crucial for understanding the overall architecture.
Parameters:
- path: (required) The path of the file or directory (relative to the current working directory ${cwd}) to analyze. When given a directory, it lists definitions from all top-level source files.`,
			strict: true,
			parameters: {
				type: "object",
				properties: {
					path: {
						type: "string",
						description: `(required) The path of the file or directory (relative to the current working directory ${cwd}) to analyze. When given a directory, it lists definitions from all top-level source files.`,
					},
				},
				required: ["path"],
				additionalProperties: false,
			},
		},
	}
}
