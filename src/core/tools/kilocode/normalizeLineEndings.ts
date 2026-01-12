/**
 * Normalizes line endings in a string to match the specified style.
 *
 * @param input - The input string to normalize
 * @param useCrLf - If true, converts to CRLF (\r\n); if false, converts to LF (\n)
 * @returns The string with normalized line endings
 */
export function normalizeLineEndings_kilocode(input: string, useCrLf: boolean): string {
	return input.replaceAll(/\r?\n/g, useCrLf ? "\r\n" : "\n")
}
