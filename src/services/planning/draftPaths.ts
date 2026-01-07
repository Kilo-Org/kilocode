// kilocode_change - new file
/**
 * Draft path utilities - single source of truth for all draft:// path handling.
 *
 * URI Format Background:
 * - Standard URI: scheme://authority/path
 * - For schemes without authority (like draft), the format is: scheme:///path or scheme:/path
 * - VSCode's Uri.parse() normalizes "draft:///file.md" to "draft:/file.md" (single slash + path)
 *
 * Our Standard Format:
 * - User-facing/canonical: "draft://filename.md" (looks familiar, clean)
 * - Internal (after Uri.parse): "draft:/filename.md" (VSCode normalized)
 *
 * This module handles all conversions transparently.
 */

/**
 * Draft scheme name for VSCode file system registration.
 * Use this when registering the FileSystemProvider.
 */
export const DRAFT_SCHEME_NAME = "draft"

/**
 * Draft protocol prefix for user-facing paths.
 * This is the canonical format: "draft://filename.md"
 */
export const DRAFT_PROTOCOL = "draft://"

/**
 * Check if a path is a draft path.
 * Handles all variants: draft://file.md, draft:///file.md, draft:/file.md
 *
 * @param path - The path to check
 * @returns true if the path is a draft path
 */
export function isDraftPath(path: string): boolean {
	return path.startsWith(`${DRAFT_SCHEME_NAME}:`)
}

/**
 * Normalize any draft path variant to the canonical format: "draft://filename.md"
 *
 * Handles:
 * - "draft://file.md" -> "draft://file.md" (already canonical)
 * - "draft:///file.md" -> "draft://file.md" (triple slash from AI)
 * - "draft:/file.md" -> "draft://file.md" (VSCode normalized)
 *
 * @param draftPath - Any draft path variant
 * @returns Canonical draft path: "draft://filename.md"
 * @throws Error if not a valid draft path
 */
export function normalizeDraftPath(draftPath: string): string {
	if (!isDraftPath(draftPath)) {
		throw new Error(`Invalid draft path: ${draftPath}`)
	}

	// Extract filename by removing scheme and all leading slashes
	const afterScheme = draftPath.slice(`${DRAFT_SCHEME_NAME}:`.length)
	const filename = afterScheme.replace(/^\/+/, "")

	// Return canonical format
	return `${DRAFT_PROTOCOL}${filename}`
}

/**
 * Extract filename from a draft path.
 * Handles all variants: draft://file.md, draft:///file.md, draft:/file.md
 *
 * @param draftPath - The draft path (any variant)
 * @returns The filename without protocol or leading slashes (e.g., "filename.md")
 * @throws Error if the path is not a valid draft path
 */
export function draftPathToFilename(draftPath: string): string {
	if (!isDraftPath(draftPath)) {
		throw new Error(`Invalid draft path: ${draftPath}`)
	}

	// Remove scheme prefix
	const afterScheme = draftPath.slice(`${DRAFT_SCHEME_NAME}:`.length)
	// Remove any leading slashes (handles //, ///, or /)
	const result = afterScheme.replace(/^\/+/, "")
	console.log(`📝 [draftPaths] draftPathToFilename: "${draftPath}" -> "${result}"`)
	return result
}

/**
 * Convert a filename to the canonical draft:// path.
 * Always returns clean "draft://filename.md" format.
 *
 * @param filename - The filename (e.g., "filename.md" or "/filename.md")
 * @returns The draft path in canonical format (e.g., "draft://filename.md")
 */
export function filenameToDraftPath(filename: string): string {
	// Remove any leading slashes from filename
	const cleanFilename = filename.replace(/^\/+/, "")
	// Return canonical format: draft://filename.md
	const result = `${DRAFT_PROTOCOL}${cleanFilename}`
	console.log(`📝 [draftPaths] filenameToDraftPath: "${filename}" -> "${result}"`)
	return result
}
