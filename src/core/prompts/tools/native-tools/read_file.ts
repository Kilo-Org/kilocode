import type OpenAI from "openai"

export function read_file_multi(cwd: string): OpenAI.Chat.ChatCompletionTool {
	return {
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
									description: `(required) File path (relative to workspace directory ${cwd})`,
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
	}
}

export function read_file_single(cwd: string): OpenAI.Chat.ChatCompletionTool {
	return {
		type: "function",
		function: {
			name: "read_file",
			description:
				'Request to read the contents of a file. The tool outputs line-numbered content (e.g. "1 | const x = 1") for easy reference when discussing code.',
			strict: true,
			parameters: {
				type: "object",
				properties: {
					path: {
						type: "string",
						description: `(required) File path (relative to workspace directory ${cwd})`,
					},
				},
				required: ["path"],
				additionalProperties: false,
			},
		},
	}
}
