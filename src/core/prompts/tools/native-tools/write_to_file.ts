import type OpenAI from "openai"

const WRITE_TO_FILE_DESCRIPTION = `Request to write content to a file. This tool is primarily used for creating new files or for scenarios where a complete rewrite of an existing file is intentionally required. If the file exists, it will be overwritten. If it doesn't exist, it will be created. This tool will automatically create any directories needed to write the file.

Parameters:
- path: (required) The path of the file to write to (relative to the current workspace directory)
- content: (required) The content to write to the file. When performing a full rewrite of an existing file or creating a new one, ALWAYS provide the COMPLETE intended content of the file, without any truncation or omissions. You MUST include ALL parts of the file, even if they haven't been modified. Do NOT include the line numbers in the content though, just the actual content of the file.
- line_count: (required) The number of lines in the file. Make sure to compute this based on the actual content of the file, not the number of lines in the content you're providing.

Example: Writing a configuration file
{ "path": "frontend-config.json", "content": "{\\n  \\"apiEndpoint\\": \\"https://api.example.com\\",\\n  \\"theme\\": {\\n    \\"primaryColor\\": \\"#007bff\\"\\n  }\\n}", "line_count": 5 }`

const PATH_PARAMETER_DESCRIPTION = `Path to the file to write, relative to the workspace`

const CONTENT_PARAMETER_DESCRIPTION = `Full contents that the file should contain with no omissions or line numbers`

const LINE_COUNT_PARAMETER_DESCRIPTION = `Total number of lines in the written file, counting blank lines`

export default {
	type: "function",
	function: {
		name: "write_to_file",
		description: WRITE_TO_FILE_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: PATH_PARAMETER_DESCRIPTION,
				},
				content: {
					type: "string",
					description: CONTENT_PARAMETER_DESCRIPTION,
				},
				line_count: {
					type: "integer",
					description: LINE_COUNT_PARAMETER_DESCRIPTION,
				},
			},
			required: ["path", "content", "line_count"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
