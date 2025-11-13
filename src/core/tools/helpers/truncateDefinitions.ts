/**
 * Truncate code definitions to only include those within the line limit
 * @param definitions - The full definitions string from parseSourceCodeDefinitionsForFile
 * @param maxReadFileLine - Maximum line number to include (-1 for no limit, 0 for definitions only)
 * @returns Truncated definitions string
 */
export function truncateDefinitionsToLineLimit(definitions: string, maxReadFileLine: number): string {
	// If no limit or definitions-only mode (0), return as-is
	if (maxReadFileLine <= 0) {
		return definitions
	}

	const lines = definitions.split("\n")
	const result: string[] = []
	let startIndex = 0

	// Keep the header line (e.g., "# filename.ts")
	if (lines.length > 0 && lines[0].startsWith("#")) {
		result.push(lines[0])
		startIndex = 1
	}

	// Process definition lines
	for (let i = startIndex; i < lines.length; i++) {
		const line = lines[i]

		// Match definition format: "startLine--endLine | content" or "lineNumber | content"
		// Allow optional leading whitespace to handle indented output or CRLF artifacts
		const rangeMatch = line.match(/^\s*(\d+)(?:--(\d+))?\s*\|/)

		if (rangeMatch) {
			const startLine = parseInt(rangeMatch[1], 10)

			// Only include definitions that start within the truncated range
			if (startLine <= maxReadFileLine) {
				result.push(line)
			}
		}
		// Note: We don't preserve empty lines or other non-definition content
		// as they're not part of the actual code definitions
	}

	return result.join("\n")
}
