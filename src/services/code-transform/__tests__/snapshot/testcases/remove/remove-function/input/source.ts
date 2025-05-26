/**
 * Utility functions for string manipulation
 */

/**
 * Capitalizes the first letter of a string
 * @param str The string to capitalize
 * @returns The capitalized string
 */
export function capitalize(str: string): string {
	if (!str) return str
	return str.charAt(0).toUpperCase() + str.slice(1)
}

/**
 * Formats a string by replacing placeholders with values
 * @param template The template string with {placeholder} syntax
 * @param values The values to replace placeholders with
 * @returns The formatted string
 */
export function formatString(template: string, values: Record<string, string>): string {
	return template.replace(/{(\w+)}/g, (_, key) => values[key] || "")
}

/**
 * Deprecated function that will be removed
 * @deprecated Use capitalize instead
 */
export function uppercaseFirst(str: string): string {
	return capitalize(str)
}

/**
 * Checks if a string is empty or only contains whitespace
 * @param str The string to check
 * @returns True if the string is empty or only contains whitespace
 */
export function isEmpty(str: string): boolean {
	return str === null || str === undefined || str.trim() === ""
}

// Helper function used internally
function padLeft(str: string, length: number, char: string = " "): string {
	return char.repeat(Math.max(0, length - str.length)) + str
}

// Export default object with all functions
export default {
	capitalize,
	formatString,
	uppercaseFirst,
	isEmpty,
}
