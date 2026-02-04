import * as path from "path"
import { parseSourceCodeDefinitionsForFile } from "../../services/tree-sitter"
import { RooIgnoreController } from "../ignore/RooIgnoreController"

/**
 * Checks if a definitions string is actually an error message from tree-sitter
 * rather than valid code definitions. These error strings should not be embedded
 * in the folded file context - instead, the file should be skipped.
 */
function isTreeSitterErrorString(definitions: string): boolean {
	// These are known error messages from parseSourceCodeDefinitionsForFile
	const errorPatterns = ["This file does not exist", "do not have permission", "Unsupported file type:"]
	return errorPatterns.some((pattern) => definitions.includes(pattern))
}

/**
 * Result of generating folded file context.
 */
export interface FoldedFileContextResult {
	/** The formatted string containing all folded file definitions (joined) */
	content: string
	/** Individual file sections, each in its own <system-reminder> block */
	sections: string[]
	/** Number of files successfully processed */
	filesProcessed: number
	/** Number of files that failed or were skipped */
	filesSkipped: number
	/** Total character count of the folded content */
	characterCount: number
}

/**
 * Options for generating folded file context.
 */
export interface FoldedFileContextOptions {
	/** Maximum total characters for the folded content (default: 50000) */
	maxCharacters?: number
	/** The current working directory for resolving relative paths */
	cwd: string
	/** Optional RooIgnoreController for file access validation */
	rooIgnoreController?: RooIgnoreController
}

/**
 * Generates folded (signatures-only) file context for a list of files using tree-sitter.
 *
 * This function takes file paths that were read during a conversation and produces
 * a condensed representation showing only function signatures, class declarations,
 * and other important structural definitions - hiding implementation bodies.
 *
 * Each file is wrapped in its own `<system-reminder>` block during context condensation,
 * allowing the model to retain awareness of file structure without consuming excessive tokens.
 *
 * @param filePaths - Array of file paths to process (relative to cwd)
 * @param options - Configuration options including cwd and max characters
 * @returns FoldedFileContextResult with the formatted content and statistics
 *
 * @example
 * ```typescript
 * const result = await generateFoldedFileContext(
 *   ['src/utils/helpers.ts', 'src/api/client.ts'],
 *   { cwd: '/project', maxCharacters: 30000 }
 * )
 * // result.content contains individual <system-reminder> blocks for each file:
 * // <system-reminder>
 * // ## File Context: src/utils/helpers.ts
 * // 1--15 | export function formatDate(...)
 * // 17--45 | export class DateHelper {...}
 * // </system-reminder>
 * // <system-reminder>
 * // ## File Context: src/api/client.ts
 * // ...
 * // </system-reminder>
 * ```
 */
export async function generateFoldedFileContext(
	filePaths: string[],
	options: FoldedFileContextOptions,
): Promise<FoldedFileContextResult> {
	const { maxCharacters = 50000, cwd, rooIgnoreController } = options

	const result: FoldedFileContextResult = {
		content: "",
		sections: [],
		filesProcessed: 0,
		filesSkipped: 0,
		characterCount: 0,
	}

	if (filePaths.length === 0) {
		return result
	}

	const foldedSections: string[] = []
	let currentCharCount = 0
	const failedFiles: string[] = []

	for (let i = 0; i < filePaths.length; i++) {
		const filePath = filePaths[i]
		// Resolve to absolute path for tree-sitter
		const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath)

		try {
			// Get the folded definitions using tree-sitter
			const definitions = await parseSourceCodeDefinitionsForFile(absolutePath, rooIgnoreController)

			if (!definitions || isTreeSitterErrorString(definitions)) {
				// File type not supported, no definitions found, or error accessing file
				result.filesSkipped++
				continue
			}

			// Wrap each file in its own <system-reminder> block
			const sectionContent = `<system-reminder>
## File Context: ${filePath}
${definitions}
</system-reminder>`

			// Check if adding this file would exceed the character limit
			if (currentCharCount + sectionContent.length > maxCharacters) {
				// Would exceed limit - check if we can fit at least a truncated version
				const remainingChars = maxCharacters - currentCharCount
				if (remainingChars < 200) {
					// Not enough room for meaningful content, stop processing all remaining files
					result.filesSkipped += filePaths.length - i
					break
				}

				// Truncate the definitions to fit within the system-reminder block
				const truncatedDefinitions = definitions.substring(0, remainingChars - 100) + "\n... (truncated)"
				const truncatedContent = `<system-reminder>
## File Context: ${filePath}
${truncatedDefinitions}
</system-reminder>`
				foldedSections.push(truncatedContent)
				currentCharCount += truncatedContent.length
				result.filesProcessed++

				// Stop processing more files since we've hit the limit
				result.filesSkipped += filePaths.length - result.filesProcessed - result.filesSkipped
				break
			}

			foldedSections.push(sectionContent)
			currentCharCount += sectionContent.length
			result.filesProcessed++
		} catch (error) {
			// Collect failed files for batch logging to reduce noise
			failedFiles.push(filePath)
			result.filesSkipped++
		}
	}

	// Log failed files as a single batch summary instead of per-file errors
	if (failedFiles.length > 0) {
		console.warn(
			`Folded context generation: skipped ${failedFiles.length} file(s) due to errors: ${failedFiles.slice(0, 5).join(", ")}${failedFiles.length > 5 ? ` and ${failedFiles.length - 5} more` : ""}`,
		)
	}

	if (foldedSections.length > 0) {
		result.sections = foldedSections
		result.content = foldedSections.join("\n")
		result.characterCount = result.content.length
	}

	return result
}
