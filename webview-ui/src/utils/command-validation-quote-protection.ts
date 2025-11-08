// kilocode_change new file

/**
 * Placeholders used to protect newlines within quoted strings during command parsing.
 * These constants are used by the protectNewlinesInQuotes function to temporarily replace
 * newlines that appear inside quotes, preventing them from being treated as command separators.
 * We use separate placeholders for \n and \r to preserve the original line ending type.
 */
export const NEWLINE_PLACEHOLDER = "___NEWLINE___"
export const CARRIAGE_RETURN_PLACEHOLDER = "___CARRIAGE_RETURN___"

/**
 * Protect newlines inside quoted strings by replacing them with placeholders.
 * This handles proper shell quoting rules where quotes can be concatenated.
 * Uses separate placeholders for \n and \r to preserve the original line ending type.
 *
 * Examples:
 * - "hello\nworld" -> newline is protected (inside double quotes)
 * - 'hello\nworld' -> newline is protected (inside single quotes)
 * - echo '"'A'"' -> A is NOT quoted (quote concatenation)
 * - "hello"world -> world is NOT quoted
 *
 * @param command - The command string to process
 * @param newlinePlaceholder - The placeholder string to use for \n characters
 * @param carriageReturnPlaceholder - The placeholder string to use for \r characters
 * @returns The command with newlines in quotes replaced by placeholders
 */
export function protectNewlinesInQuotes(
	command: string,
	newlinePlaceholder: string,
	carriageReturnPlaceholder: string,
): string {
	let result = ""
	let i = 0

	while (i < command.length) {
		const char = command[i]

		if (char === '"') {
			// Start of double-quoted string
			result += char
			i++

			// Process until we find the closing unescaped quote
			while (i < command.length) {
				const quoteChar = command[i]
				const prevChar = i > 0 ? command[i - 1] : ""

				if (quoteChar === '"' && prevChar !== "\\") {
					// Found closing quote
					result += quoteChar
					i++
					break
				} else if (quoteChar === "\n") {
					// Replace \n inside double quotes
					result += newlinePlaceholder
					i++
				} else if (quoteChar === "\r") {
					// Replace \r inside double quotes
					result += carriageReturnPlaceholder
					i++
				} else {
					result += quoteChar
					i++
				}
			}
		} else if (char === "'") {
			// Start of single-quoted string
			result += char
			i++

			// Process until we find the closing quote
			// Note: In single quotes, backslash does NOT escape (except for \' in some shells)
			while (i < command.length) {
				const quoteChar = command[i]

				if (quoteChar === "'") {
					// Found closing quote
					result += quoteChar
					i++
					break
				} else if (quoteChar === "\n") {
					// Replace \n inside single quotes
					result += newlinePlaceholder
					i++
				} else if (quoteChar === "\r") {
					// Replace \r inside single quotes
					result += carriageReturnPlaceholder
					i++
				} else {
					result += quoteChar
					i++
				}
			}
		} else {
			// Not in quotes, keep character as-is
			result += char
			i++
		}
	}

	return result
}
