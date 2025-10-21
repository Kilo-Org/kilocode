import { TextDocument } from "vscode"

/**
 * Checks if a line is a comment based on language
 */
export function isCommentLine(line: string, languageId: string): boolean {
	const trimmed = line.trim()

	const patterns = [
		// Structural patterns
		/^\/\*$/, // C-style block start
		/^<!--$/, // HTML comment start
		/^"""$/, // Python docstring
		/^'''$/, // Python docstring alternative
		// Multi-line patterns
		/^\/\*/, // C-style
		/^\*/, // Inside C-style block
		/^<!--/, // HTML, XML
		/^"""/, // Python docstring
		/^'''/, // Python docstring alternative
		// Single-line patterns
		/^\/\//, // JavaScript, TypeScript, C++, Java, etc.
		/^#/, // Python, Ruby, Shell, etc.
		/^--/, // SQL, Haskell, Lua
		/^;/, // Assembly, Lisp
		/^%/, // MATLAB, LaTeX
		/^'/, // VB
	]

	for (const pattern of patterns) {
		const match = trimmed.match(pattern)
		if (match) {
			const withoutSyntax = trimmed.slice(match[0].length).trim()
			return withoutSyntax.length > 0
		}
	}

	return false
}

/**
 * Cleans comment text by removing comment syntax
 */
export function cleanComment(comment: string, languageId: string): string {
	const lines = comment.split("\n")
	const cleaned = lines.map((line) => {
		let cleaned = line.trim()

		// Remove common comment prefixes (order matters)
		cleaned = cleaned
			.replace(/^\/\/\s*/, "") // //
			.replace(/^\/\*\s*/, "") // /*
			.replace(/^\*\s+/, "") // * with required space after
			.replace(/^#\s*/, "") // #
			.replace(/^--\s*/, "") // --
			.replace(/^;\s*/, "") // ;
			.replace(/^%\s*/, "") // %
			.replace(/^'\s*/, "") // '
			.replace(/^<!--\s*/, "") // <!--

		// Remove trailing comment syntax and everything after the last occurrence
		const lastCommentEnd = cleaned.lastIndexOf("*/")
		if (lastCommentEnd !== -1) {
			cleaned = cleaned.substring(0, lastCommentEnd).trim()
		}

		const lastHtmlCommentEnd = cleaned.lastIndexOf("-->")
		if (lastHtmlCommentEnd !== -1) {
			cleaned = cleaned.substring(0, lastHtmlCommentEnd).trim()
		}

		return cleaned.trim()
	})

	return cleaned.filter((line) => line.length > 0).join("\n")
}
