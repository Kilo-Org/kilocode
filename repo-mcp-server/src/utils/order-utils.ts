/**
 * Utility functions for managing JSON order in i18n files
 * This helps maintain consistent ordering across multiple languages
 */

/**
 * Reorder a JSON object to match the structure and order of a source object
 * This is useful for keeping translation files ordered the same way across languages
 *
 * @param target The JSON object to reorder
 * @param source The source JSON object to use as a reference for ordering
 * @returns A new JSON object with the same properties as target but ordered like source
 */
export function reorderJsonToMatchSource(
	target: Record<string, any>,
	source: Record<string, any>,
): Record<string, any> {
	// Create a new object to store the ordered result
	const result: Record<string, any> = {}

	// First pass: Add all properties from source that exist in target
	for (const key of Object.keys(source)) {
		if (key in target) {
			// If both source and target have objects at this key, recurse
			if (
				typeof source[key] === "object" &&
				source[key] !== null &&
				!Array.isArray(source[key]) &&
				typeof target[key] === "object" &&
				target[key] !== null &&
				!Array.isArray(target[key])
			) {
				result[key] = reorderJsonToMatchSource(target[key], source[key])
			} else {
				// Otherwise just copy the value from target
				result[key] = target[key]
			}
		}
	}

	// Second pass: Add any properties from target that don't exist in source
	// These will be appended to the end, maintaining their original relative order
	for (const key of Object.keys(target)) {
		if (!(key in result)) {
			result[key] = target[key]
		}
	}

	return result
}

/**
 * Simple utility to check if a value is a plain object
 */
export function isPlainObject(value: any): boolean {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.getPrototypeOf(value) === Object.prototype
	)
}
