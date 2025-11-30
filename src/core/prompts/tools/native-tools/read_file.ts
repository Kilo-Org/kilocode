import type OpenAI from "openai"

export const read_file = {
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
									pattern: "^[0-9]+-[0-9]+$",
								},
							},
						},
						required: [
							"path",
							"line_ranges", // kilocode_change
						],
						additionalProperties: false,
					},
					minItems: 1,
				},
			},
			// kilocode_change start: fix for Haiku 4.5
			example: [
				{
					files: [
						{
							path: "src/app.ts",
							line_ranges: ["1-50"],
						},
						{
							path: "src/utils.ts",
							line_ranges: ["1-50", "100-150"],
						},
					],
				},
			],
			// kilocode_change end
			required: ["files"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
