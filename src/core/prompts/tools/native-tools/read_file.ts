import type OpenAI from "openai"

const READ_FILE_BASE_DESCRIPTION = `Read one or more files and return their contents with line numbers for diffing or discussion.`

const READ_FILE_SUPPORTS_NOTE = `Supports text extraction from PDF and DOCX files, but may not handle other binary files properly.`

/**
 * Creates the read_file tool definition, optionally including line_ranges support
 * based on whether partial reads are enabled.
 *
 * @param partialReadsEnabled - Whether to include line_ranges parameter
 * @returns Native tool definition for read_file
 */
export function createReadFileTool(partialReadsEnabled: boolean = true): OpenAI.Chat.ChatCompletionTool {
	const baseDescription =
		READ_FILE_BASE_DESCRIPTION +
		" Structure: { files: [{ path: 'relative/path.ts'" +
		(partialReadsEnabled ? ", line_ranges: [[1, 50], [100, 150]]" : "") +
		" }] }. " +
		"The 'path' is required and relative to workspace. "

	const optionalRangesDescription = partialReadsEnabled
		? "The 'line_ranges' is optional for reading specific sections. Each range is a [start, end] tuple (1-based inclusive). "
		: ""

	const examples = partialReadsEnabled
		? "Example single file: { files: [{ path: 'src/app.ts' }] }. " +
			"Example with line ranges: { files: [{ path: 'src/app.ts', line_ranges: [[1, 50], [100, 150]] }] }. " +
			"Example multiple files: { files: [{ path: 'file1.ts', line_ranges: [[1, 50]] }, { path: 'file2.ts' }] }"
		: "Example single file: { files: [{ path: 'src/app.ts' }] }. " +
			"Example multiple files: { files: [{ path: 'file1.ts' }, { path: 'file2.ts' }] }"

	const description = baseDescription + optionalRangesDescription + READ_FILE_SUPPORTS_NOTE + " " + examples

	// Build the properties object conditionally
	const fileProperties: Record<string, any> = {
		path: {
			type: "string",
			description: "Path to the file to read, relative to the workspace",
		},
	}

	// Only include line_ranges if partial reads are enabled
	if (partialReadsEnabled) {
		fileProperties.line_ranges = {
			type: ["array", "null"],
			description:
				"Optional line ranges to read. Each range is a [start, end] tuple with 1-based inclusive line numbers. Use multiple ranges for non-contiguous sections.",
			items: {
				type: "array",
				items: { type: "integer" },
				minItems: 2,
				maxItems: 2,
			},
		}
	}

	// When using strict mode, ALL properties must be in the required array
	// Optional properties are handled by having type: ["...", "null"]
	const fileRequiredProperties = partialReadsEnabled ? ["path", "line_ranges"] : ["path"]

	return {
		type: "function",
		function: {
			name: "read_file",
			description,
			strict: true,
			parameters: {
				type: "object",
				properties: {
					files: {
						type: "array",
						description: "List of files to read; request related files together when allowed",
						items: {
							type: "object",
							properties: fileProperties,
							required: fileRequiredProperties,
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
}

export const read_file = createReadFileTool(false)
