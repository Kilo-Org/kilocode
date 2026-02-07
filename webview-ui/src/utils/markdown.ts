/**
 * Counts the number of markdown headings in the given text.
 * Matches headings from level 1 to 6 (e.g. #, ##, ###, etc.).
 * Code fences are stripped before matching to avoid false positives.
 */
export function countMarkdownHeadings(text: string | undefined): number {
	if (!text) return 0

	// Remove fenced code blocks to avoid counting headings inside code
	const withoutCodeBlocks = text.replace(/```[\s\S]*?```/g, "")

	// Up to 3 leading spaces are allowed before the hashes per the markdown spec
	const headingRegex = /^\s{0,3}#{1,6}\s+.+$/gm
	const matches = withoutCodeBlocks.match(headingRegex)
	return matches ? matches.length : 0
}

/**
 * Returns true if the markdown contains at least two headings.
 */
export function hasComplexMarkdown(text: string | undefined): boolean {
	return countMarkdownHeadings(text) >= 2
}
