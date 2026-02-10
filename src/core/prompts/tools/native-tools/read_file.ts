import type OpenAI from "openai"

/**
 * Generates the file support note, optionally including image format support.
 *
 * @param supportsImages - Whether the model supports image processing
 * @returns Support note string
 */
function getReadFileSupportsNote(supportsImages: boolean): string {
	if (supportsImages) {
		return `Supports text extraction from PDF and DOCX files. Automatically processes and returns image files (PNG, JPG, JPEG, GIF, BMP, SVG, WEBP, ICO, AVIF) for visual analysis. May not handle other binary files properly.`
	}
	return `Supports text extraction from PDF and DOCX files, but may not handle other binary files properly.`
}

/**
 * Options for creating the read_file tool definition.
 */
export interface ReadFileToolOptions {
	/** Whether to include line_ranges parameter (default: true) */
	partialReadsEnabled?: boolean
	/** Maximum number of files that can be read in a single request (default: 5) */
	maxConcurrentFileReads?: number
	/** Whether the model supports image processing (default: false) */
	supportsImages?: boolean
}

/**
 * Creates the read_file tool definition, optionally including line_ranges support
 * based on whether partial reads are enabled.
 *
 * @param options - Configuration options for the tool
 * @returns Native tool definition for read_file
 */
export function createReadFileTool(options: ReadFileToolOptions = {}): OpenAI.Chat.ChatCompletionTool {
	const { partialReadsEnabled = true, maxConcurrentFileReads = 5, supportsImages = false } = options
	const isMultipleReadsEnabled = maxConcurrentFileReads > 1

	// Build description intro with concurrent reads limit message
	const descriptionIntro = isMultipleReadsEnabled
		? `Read one or more files and return their contents with line numbers for diffing or discussion. IMPORTANT: You can read a maximum of ${maxConcurrentFileReads} files in a single request. If you need to read more files, use multiple sequential read_file requests. `
		: "Read a file and return its contents with line numbers for diffing or discussion. IMPORTANT: Multiple file reads are currently disabled. You can only read one file at a time. "

	const baseDescription =
		descriptionIntro +
		"Structure: { files: [{ path: 'relative/path.ts'" +
		(partialReadsEnabled ? ", line_ranges: [[1, 50], [100, 150]]" : "") +
		" }] }. " +
		"The 'path' is required and relative to workspace. "

	const optionalRangesDescription = partialReadsEnabled
		? "The 'line_ranges' is optional for reading specific sections. Each range is a [start, end] tuple (1-based inclusive). "
		: ""

	const examples = partialReadsEnabled
		? "Example single file: { files: [{ path: 'src/app.ts' }] }. " +
			"Example with line ranges: { files: [{ path: 'src/app.ts', line_ranges: [[1, 50], [100, 150]] }] }. " +
			(isMultipleReadsEnabled
				? `Example multiple files (within ${maxConcurrentFileReads}-file limit): { files: [{ path: 'file1.ts', line_ranges: [[1, 50]] }, { path: 'file2.ts' }] }`
				: "")
		: "Example single file: { files: [{ path: 'src/app.ts' }] }. " +
			(isMultipleReadsEnabled
				? `Example multiple files (within ${maxConcurrentFileReads}-file limit): { files: [{ path: 'file1.ts' }, { path: 'file2.ts' }] }`
				: "")

	const description =
		baseDescription + optionalRangesDescription + getReadFileSupportsNote(supportsImages) + " " + examples

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

export const read_file = createReadFileTool({ partialReadsEnabled: false })
