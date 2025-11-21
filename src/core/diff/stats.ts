import { parsePatch, createTwoFilesPatch } from "diff"

/**
 * Diff utilities for backend (extension) use.
 * Source of truth for diff normalization and stats.
 */

export interface DiffStats {
	added: number
	removed: number
}

/**
 * Remove non-semantic diff noise like "No newline at end of file"
 */
export function sanitizeUnifiedDiff(diff: string): string {
	if (!diff) return diff
	return diff.replace(/\r\n/g, "\n").replace(/(^|\n)[ \t]*(?:\\ )?No newline at end of file[ \t]*(?=\n|$)/gi, "$1")
}

/**
 * Compute +/− counts from a unified diff (ignores headers/hunk lines)
 */
export function computeUnifiedDiffStats(diff?: string): DiffStats | null {
	if (!diff) return null

	try {
		const patches = parsePatch(diff)
		if (!patches || patches.length === 0) return null

		let added = 0
		let removed = 0

		for (const p of patches) {
			for (const h of (p as any).hunks ?? []) {
				for (const l of h.lines ?? []) {
					const ch = (l as string)[0]
					if (ch === "+") added++
					else if (ch === "-") removed++
				}
			}
		}

		if (added > 0 || removed > 0) return { added, removed }
		return { added: 0, removed: 0 }
	} catch {
		// If parsing fails for any reason, signal no stats
		return null
	}
}

/**
 * Compute diff stats from any supported diff format (unified or search-replace)
 * Tries unified diff format first, then falls back to search-replace format
 */
export function computeDiffStats(diff?: string): DiffStats | null {
	if (!diff) return null
	return computeUnifiedDiffStats(diff)
}

/**
 * Build a unified diff for a brand new file (all content lines are additions).
 * Trailing newline is ignored for line counting and emission.
 */
export function convertNewFileToUnifiedDiff(content: string, filePath?: string): string {
	const newFileName = filePath || "file"
	// Normalize EOLs; rely on library for unified patch formatting
	const normalized = (content || "").replace(/\r\n/g, "\n")
	// Old file is empty (/dev/null), new file has content; zero context to show all lines as additions
	return createTwoFilesPatch("/dev/null", newFileName, "", normalized, undefined, undefined, { context: 0 })
}
