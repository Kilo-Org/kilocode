/**
 * Moved from source file
 */
export function toTitleCase(text: string): string {
	return text
		.split(" ")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ")
}
