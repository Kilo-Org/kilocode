import type OpenAI from "openai"

export default function write_to_file(cwd: string): OpenAI.Chat.ChatCompletionTool {
	return {
		type: "function",
		function: {
			name: "write_to_file",
			description:
				"Request to write content to a file. This tool is primarily used for **creating new files** or for scenarios where a **complete rewrite of an existing file is intentionally required**. If the file exists, it will be overwritten. If it doesn't exist, it will be created. This tool will automatically create any directories needed to write the file.",
			strict: true,
			parameters: {
				type: "object",
				properties: {
					path: {
						type: "string",
						description: `The path of the file to write to (relative to the current workspace directory ${cwd})`,
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
	}
}
