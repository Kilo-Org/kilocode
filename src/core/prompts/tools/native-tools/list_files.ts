import type OpenAI from "openai"

export default function list_files(cwd: string): OpenAI.Chat.ChatCompletionTool {
	return {
		type: "function",
		function: {
			name: "list_files",
			description: `List files and directories within a given directory. Optionally recurse into subdirectories. Do not use this tool to confirm file creation; rely on user confirmation instead.`,
			strict: true,
			parameters: {
				type: "object",
				properties: {
					path: {
						type: "string",
						description: `(required) The path of the file or directory (relative to the current working directory ${cwd}) to analyze. When given a directory, it lists definitions from all top-level source files.`,
					},
					recursive: {
						type: ["boolean"],
						description: "Set true to list contents recursively; false to show only the top level",
					},
				},
				required: ["path", "recursive"],
				additionalProperties: false,
			},
		},
	}
}
