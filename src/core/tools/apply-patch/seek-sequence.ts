/**
 * Fuzzy sequence matching for the apply_patch tool.
 * Implements multi-pass sequence matching (exact, trim-end, trim, Unicode-normalized)
 * to locate old_lines and change_context within a file.
 */

/**
 * Normalize common Unicode punctuation to ASCII equivalents.
 * This allows patches written with plain ASCII to match source files
 * containing typographic characters.
 */
function normalizeUnicode(s: string): string {
	return s
		.trim()
		.split("")
		.map((c) => {
			// Various dash/hyphen code-points → ASCII '-'
			if ("\u2010\u2011\u2012\u2013\u2014\u2015\u2212".includes(c)) {
				return "-"
			}
			// Fancy single quotes → '\''
			if ("\u2018\u2019\u201A\u201B".includes(c)) {
				return "'"
			}
			// Fancy double quotes → '"'
			if ("\u201C\u201D\u201E\u201F".includes(c)) {
				return '"'
			}
			// Non-breaking space and other odd spaces → normal space
			if ("\u00A0\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u202F\u205F\u3000".includes(c)) {
				return " "
			}
			return c
		})
		.join("")
}

/**
 * Check if two arrays of lines match exactly.
 */
function exactMatch(lines: string[], pattern: string[], startIndex: number): boolean {
	for (let i = 0; i < pattern.length; i++) {
		if (lines[startIndex + i] !== pattern[i]) {
			return false
		}
	}
	return true
}

/**
 * Check if two arrays of lines match after trimming trailing whitespace.
 */
function trimEndMatch(lines: string[], pattern: string[], startIndex: number): boolean {
	for (let i = 0; i < pattern.length; i++) {
		if (lines[startIndex + i]?.trimEnd() !== pattern[i]?.trimEnd()) {
			return false
		}
	}
	return true
}

/**
 * Check if two arrays of lines match after trimming both sides.
 */
function trimMatch(lines: string[], pattern: string[], startIndex: number): boolean {
	for (let i = 0; i < pattern.length; i++) {
		if (lines[startIndex + i]?.trim() !== pattern[i]?.trim()) {
			return false
		}
	}
	return true
}

/**
 * Check if two arrays of lines match after Unicode normalization.
 */
function normalizedMatch(lines: string[], pattern: string[], startIndex: number): boolean {
	for (let i = 0; i < pattern.length; i++) {
		if (normalizeUnicode(lines[startIndex + i] ?? "") !== normalizeUnicode(pattern[i] ?? "")) {
			return false
		}
	}
	return true
}

/**
 * Attempt to find the sequence of pattern lines within lines beginning at or after start.
 * Returns the starting index of the match or null if not found.
 *
 * Matches are attempted with decreasing strictness:
 * 1. Exact match
 * 2. Ignoring trailing whitespace
 * 3. Ignoring leading and trailing whitespace
 * 4. Unicode-normalized (handles typographic characters)
 *
 * When eof is true, first try starting at the end-of-file (so that patterns
 * intended to match file endings are applied at the end), and fall back to
 * searching from start if needed.
 *
 * Special cases handled defensively:
 * - Empty pattern → returns start (no-op match)
 * - pattern.length > lines.length → returns null (cannot match)
 *
 * @param lines - The file lines to search in
 * @param pattern - The pattern lines to find
 * @param start - The starting index to search from
 * @param eof - Whether this chunk should match at end of file
 * @returns The starting index of the match, or null if not found
 */
export function seekSequence(lines: string[], pattern: string[], start: number, eof: boolean): number | null {
	if (pattern.length === 0) {
		return start
	}

	// When the pattern is longer than available input, there's no possible match
	if (pattern.length > lines.length) {
		return null
	}

	const searchStart = eof && lines.length >= pattern.length ? lines.length - pattern.length : start

	const maxStart = lines.length - pattern.length

	// Pass 1: Exact match
	for (let i = searchStart; i <= maxStart; i++) {
		if (exactMatch(lines, pattern, i)) {
			return i
		}
	}

	// Pass 2: Trim-end match
	for (let i = searchStart; i <= maxStart; i++) {
		if (trimEndMatch(lines, pattern, i)) {
			return i
		}
	}

	// Pass 3: Trim both sides match
	for (let i = searchStart; i <= maxStart; i++) {
		if (trimMatch(lines, pattern, i)) {
			return i
		}
	}

	// Pass 4: Unicode-normalized match
	for (let i = searchStart; i <= maxStart; i++) {
		if (normalizedMatch(lines, pattern, i)) {
			return i
		}
	}

	return null
}
