/**
 * Source file with utility functions
 */

export function formatText(text: string): string {
	return toTitleCase(text)
}

function toTitleCase(text: string): string {
	return text
		.split(" ")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ")
}
