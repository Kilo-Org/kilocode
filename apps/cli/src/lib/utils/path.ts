import * as path from "path"

/**
 * Normalize a path by removing trailing slashes and converting separators.
 * This handles cross-platform path comparison issues.
 */
export function normalizePath(p: string): string {
	// Remove trailing slashes
	let normalized = p.replace(/[/\\]+$/, "")
	// Convert to consistent separators using path.normalize
	normalized = path.normalize(normalized)
	return normalized
}

/**
 * Compare two paths for equality, handling:
 * - Trailing slashes
 * - Path separator differences
 * - Case sensitivity (case-insensitive on Windows/macOS)
 */
export function arePathsEqual(path1?: string, path2?: string): boolean {
	if (!path1 || !path2) {
		return false
	}

	const normalizedPath1 = normalizePath(path1)
	const normalizedPath2 = normalizePath(path2)

	// On Windows and macOS, file paths are case-insensitive
	if (process.platform === "win32" || process.platform === "darwin") {
		return normalizedPath1.toLowerCase() === normalizedPath2.toLowerCase()
	}

	return normalizedPath1 === normalizedPath2
}
