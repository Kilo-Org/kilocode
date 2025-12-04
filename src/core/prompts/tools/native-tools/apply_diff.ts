import type OpenAI from "openai"

export const apply_diff_single_file = {
	type: "function",
	function: {
		name: "apply_diff",
		description: `
Apply precise, targeted modifications to an existing file using one or more search/replace blocks. This tool is for surgical edits only; the 'SEARCH' block must exactly match the existing content, including whitespace and indentation. To make multiple targeted changes, provide multiple SEARCH/REPLACE blocks in the 'diff' parameter. Use the 'read_file' tool first if you are not confident in the exact content to search for.
`,
		parameters: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "The path of the file to modify, relative to the current workspace directory.",
				},
				diff: {
					type: "string",
					description: `
A string containing one or more search/replace blocks defining the changes. The ':start_line:' is required and indicates the starting line number of the original content.  You must not add a start line for the replacement content. Each block must follow this format:
<<<<<<< SEARCH
:start_line:[line_number]
-------
[exact content to find]
=======
[new content to replace with]
>>>>>>> REPLACE
`,
				},
			},
			required: ["path", "diff"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool

//@ts-ignore Preparing for when we enable multi-file diffs
export const apply_diff_multi_file = {
	type: "function",
	function: {
		name: "apply_diff",
		description:
			"Apply precise, targeted modifications to one or more files by searching for specific sections of content and replacing them. This tool is for surgical edits only and supports making changes across multiple files in a single request. The 'SEARCH' block must exactly match the existing content, including whitespace and indentation. You must use this tool to edit multiple files in a single operation whenever possible.",
		parameters: {
			type: "object",
			properties: {
				files: {
					type: "array",
					description: "A list of file modification operations to perform.",
					items: {
						type: "object",
						properties: {
							path: {
								type: "string",
								description:
									"The path of the file to modify, relative to the current workspace directory.",
							},
							diffs: {
								type: "array",
								description:
									"A list of diffs to apply to the file. Each diff is a distinct search/replace operation.",
								items: {
									type: "object",
									properties: {
										content: {
											type: "string",
											description: `
The search/replace block defining the changes. The SEARCH block must exactly match the content to be replaced. Format: 
'<<<<<<< SEARCH
[content_to_find]
=======
[content_to_replace_with]
>>>>>>> REPLACE
 `,
										},
										start_line: {
											type: "integer",
											description:
												"The line number in the original file where the SEARCH block begins.",
										},
									},
									required: ["content", "start_line"],
								},
							},
						},
						required: ["path", "diffs"],
					},
				},
			},
			required: ["files"],
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
