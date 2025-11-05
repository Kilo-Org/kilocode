import type OpenAI from "openai"

export default {
	type: "function",
	function: {
		name: "list_files",
		description:
			"List files and directories within a given directory. Optionally recurse into subdirectories. Do not use this tool to confirm file creation; rely on user confirmation instead.",
		strict: true,
		parameters: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "Directory path to inspect, relative to the workspace",
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
} satisfies OpenAI.Chat.ChatCompletionTool
