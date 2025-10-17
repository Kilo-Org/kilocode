import type OpenAI from "openai"

export default {
	type: "function",
	function: {
		name: "read_file",
		description:
			"Read one or more files and return their contents with line numbers for diffing or discussion. Use line ranges when available to keep reads efficient and combine related files when possible.",
		strict: true,
		parameters: {
			type: "object",
			properties: {
				files: {
					type: "array",
					description: "List of files to read; request related files together when allowed",
					items: {
						type: "object",
						properties: {
							path: {
								type: "string",
								description: "Path to the file to read, relative to the workspace",
							},
							line_ranges: {
								type: ["array", "null"],
								description:
									"Optional 1-based inclusive ranges to read (format: start-end). Use multiple ranges for non-contiguous sections and keep ranges tight to the needed context.",
								items: {
									type: "string",
									pattern: "^\\d+-\\d+$",
								},
								minItems: 1,
							},
						},
						required: ["path", "line_ranges"],
						additionalProperties: false,
					},
					minItems: 1,
				},
			},
			required: ["files"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
