/**
 * JSON utility functions for handling nested properties in i18n files
 */

/**
 * Get a nested property from an object using a dot-notation path
 */
export function getI18nNestedKey(obj: any, path: string): any {
	if (!path) {
		return obj
	}

	const parts = path.split(".")
	let current = obj

	for (const part of parts) {
		if (current === undefined || current === null || typeof current !== "object") {
			return undefined
		}
		current = current[part]
	}

	return current
}

/**
 * Set a nested property in an object using a dot-notation path
 * Creates intermediate objects if they don't exist
 */
export function setI18nNestedKey(obj: any, path: string, value: any): void {
	const parts = path.split(".")
	let current = obj

	// Navigate to the parent of the property we want to set
	for (let i = 0; i < parts.length - 1; i++) {
		const part = parts[i]
		if (!(part in current) || current[part] === null || typeof current[part] !== "object") {
			current[part] = {}
		}
		current = current[part]
	}

	// Set the property
	current[parts[parts.length - 1]] = value
}

/**
 * Delete a nested property from an object using a dot-notation path
 */
export function deleteI18nNestedKey(obj: any, path: string): boolean {
	const parts = path.split(".")
	let current = obj

	// Navigate to the parent of the property we want to delete
	for (let i = 0; i < parts.length - 1; i++) {
		const part = parts[i]
		if (!(part in current) || current[part] === null || typeof current[part] !== "object") {
			return false
		}
		current = current[part]
	}

	// Delete the property
	const lastPart = parts[parts.length - 1]
	if (lastPart in current) {
		delete current[lastPart]
		return true
	}

	return false
}

/**
 * Recursively clean up empty objects in a JSON structure
 * Returns true if the object is empty after cleanup
 */
export function cleanupEmptyI18nObjects(obj: any): boolean {
	if (typeof obj !== "object" || obj === null) {
		return false
	}

	// For arrays, filter out any empty objects
	if (Array.isArray(obj)) {
		for (let i = obj.length - 1; i >= 0; i--) {
			if (cleanupEmptyI18nObjects(obj[i])) {
				obj.splice(i, 1)
			}
		}
		return obj.length === 0
	}

	// For objects, recursively clean up each property
	let isEmpty = true
	for (const key in obj) {
		if (Object.prototype.hasOwnProperty.call(obj, key)) {
			const value = obj[key]

			if (typeof value === "object" && value !== null) {
				// If the property is an object, recursively clean it up
				const propertyIsEmpty = cleanupEmptyI18nObjects(value)

				// If the property is empty after cleanup, delete it
				if (propertyIsEmpty) {
					delete obj[key]
				} else {
					isEmpty = false
				}
			} else {
				// If the property is not an object, the parent object is not empty
				isEmpty = false
			}
		}
	}

	return isEmpty
}

/**
 * Detect indentation in a string
 */
export function detectIndentation(content: string): { char: string; size: number } {
	// Default to 2 spaces
	const defaultIndentation = { char: " ", size: 2 }

	const lines = content.split("\n")
	const indentations = []

	for (const line of lines) {
		const match = line.match(/^(\s+)/)
		if (match) {
			indentations.push(match[1])
		}
	}

	if (indentations.length === 0) {
		return defaultIndentation
	}

	// Find the most common indentation
	const counts: Record<string, number> = {}
	let maxCount = 0
	let mostCommon = ""

	for (const indent of indentations) {
		counts[indent] = (counts[indent] || 0) + 1
		if (counts[indent] > maxCount) {
			maxCount = counts[indent]
			mostCommon = indent
		}
	}

	// Determine the character and size
	const char = mostCommon.includes("\t") ? "\t" : " "
	const size = mostCommon.length

	return { char, size }
}
