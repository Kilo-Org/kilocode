// kilocode_change - new file
/**
 * Plan path utilities - single source of truth for all plan:// path handling.
 *
 * URI Format Background:
 * - Standard URI: scheme://authority/path
 * - For schemes without authority (like plan), the format is: scheme:///path or scheme:/path
 * - VSCode's Uri.parse() normalizes "plan:///file.md" to "plan:/file.md" (single slash + path)
 *
 * Our Standard Format:
 * - User-facing/canonical: "plan://filename.md" (looks familiar, clean)
 * - Internal (after Uri.parse): "plan:/filename.md" (VSCode normalized)
 *
 * This module handles all conversions transparently.
 */

/**
 * Plan scheme name for VSCode file system registration.
 * Use this when registering the FileSystemProvider.
 */
export const PLAN_SCHEME_NAME = "plan"

/**
 * Plan protocol prefix for user-facing paths.
 * This is the canonical format: "plan://filename.md"
 */
export const PLAN_PROTOCOL = "plan://"

/**
 * Check if a path is a plan path.
 * Handles all variants: plan://file.md, plan:///file.md, plan:/file.md
 * Also detects absolute /plans/... paths that should be redirected to plan:// schema.
 * These absolute paths would fail anyway (EROFS) since root /plans is read-only,
 * so we redirect them to ephemeral plan documents. Relative paths like "plans/..."
 * are NOT matched to allow users with workspace plans/ directories to work normally.
 *
 * @param path - The path to check
 * @returns true if the path is a plan path or should be treated as one
 */
export function isPlanPath(path: string): boolean {
	// Check for plan:// URI scheme (canonical plan paths)
	if (path.startsWith(`${PLAN_SCHEME_NAME}:`)) {
		return true
	}
	// Check for absolute /plans/... paths that should be redirected
	// Only absolute paths (not relative "plans/...") to avoid interfering with
	// users who have a plans/ directory in their workspace
	return path.startsWith("/plans/")
}

/**
 * Normalize any plan path variant to the canonical format: "plan://filename.md"
 *
 * Handles:
 * - "plan://file.md" -> "plan://file.md" (already canonical)
 * - "plan:///file.md" -> "plan://file.md" (triple slash from AI)
 * - "plan:/file.md" -> "plan://file.md" (VSCode normalized)
 * - "/plans/file.md" -> "plan://file.md" (absolute /plans/ paths)
 *
 * @param planPath - Any plan path variant
 * @returns Canonical plan path: "plan://filename.md"
 * @throws Error if not a valid plan path
 */
export function normalizePlanPath(planPath: string): string {
	if (!isPlanPath(planPath)) {
		throw new Error(`Invalid plan path: ${planPath}`)
	}

	// Handle /plans/ paths by converting them first
	if (planPath.startsWith("/plans/")) {
		const filename = planPath.replace(/^\/plans\//, "").replace(/^\//, "")
		return `${PLAN_PROTOCOL}${filename}`
	}

	// Extract filename by removing scheme and all leading slashes
	const afterScheme = planPath.slice(`${PLAN_SCHEME_NAME}:`.length)
	const filename = afterScheme.replace(/^\/+/, "")

	// Return canonical format
	return `${PLAN_PROTOCOL}${filename}`
}

/**
 * Extract filename from a plan path.
 * Handles all variants: plan://file.md, plan:///file.md, plan:/file.md, /plans/file.md
 *
 * @param planPath - The plan path (any variant)
 * @returns The filename without protocol or leading slashes (e.g., "filename.md")
 * @throws Error if the path is not a valid plan path
 */
export function planPathToFilename(planPath: string): string {
	if (!isPlanPath(planPath)) {
		throw new Error(`Invalid plan path: ${planPath}`)
	}

	// Handle /plans/ paths
	if (planPath.startsWith("/plans/")) {
		const result = planPath.replace(/^\/plans\//, "").replace(/^\//, "")
		return result
	}

	// Remove scheme prefix
	const afterScheme = planPath.slice(`${PLAN_SCHEME_NAME}:`.length)
	// Remove any leading slashes (handles //, ///, or /)
	const result = afterScheme.replace(/^\/+/, "")
	return result
}

/**
 * Convert a filename to the canonical plan:// path.
 * Always returns clean "plan://filename.md" format.
 *
 * @param filename - The filename (e.g., "filename.md" or "/filename.md")
 * @returns The plan path in canonical format (e.g., "plan://filename.md")
 */
export function filenameToPlanPath(filename: string): string {
	// Remove any leading slashes from filename
	const cleanFilename = filename.replace(/^\/+/, "")
	// Return canonical format: plan://filename.md
	const result = `${PLAN_PROTOCOL}${cleanFilename}`
	return result
}
