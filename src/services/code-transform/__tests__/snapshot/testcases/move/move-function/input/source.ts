/**
 * Utility functions for string operations
 */

export function formatString(value: string, maxLength: number = 100): string {
	if (value.length <= maxLength) {
		return value
	}
	return value.substring(0, maxLength - 3) + "..."
}

export function capitalizeFirstLetter(str: string): string {
	if (!str || str.length === 0) return str
	return str.charAt(0).toUpperCase() + str.slice(1)
}

export function slugify(text: string): string {
	return text
		.toString()
		.toLowerCase()
		.replace(/\s+/g, "-")
		.replace(/[^\w\-]+/g, "")
		.replace(/\-\-+/g, "-")
		.replace(/^-+/, "")
		.replace(/-+$/, "")
}
