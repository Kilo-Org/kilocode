/**
 * Utility functions for string operations
 */

import { formatString } from "./target"

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
