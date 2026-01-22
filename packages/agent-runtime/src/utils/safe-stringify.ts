/**
 * Safe JSON stringification utility that handles circular references,
 * Error objects, and other special types.
 */

/**
 * Serialize an error object to a plain object with all relevant properties
 */
function serializeError(error: Error): Record<string, unknown> {
	return {
		message: error.message,
		name: error.name,
		stack: error.stack,
		// Include any additional enumerable properties
		...Object.getOwnPropertyNames(error)
			.filter((key) => key !== "message" && key !== "name" && key !== "stack")
			.reduce(
				(acc, key) => {
					acc[key] = (error as unknown as Record<string, unknown>)[key]
					return acc
				},
				{} as Record<string, unknown>,
			),
	}
}

/**
 * Safe stringify that handles circular references, Error objects, Dates, RegExp, etc.
 * Returns a serializable version of the object.
 */
export function safeStringify(obj: unknown, seen = new WeakSet()): unknown {
	// Handle primitives
	if (obj === null || typeof obj !== "object") {
		return obj
	}

	// Handle circular references
	if (seen.has(obj as object)) {
		return "[Circular]"
	}

	// Handle Error objects
	if (obj instanceof Error) {
		return serializeError(obj)
	}

	// Handle arrays
	if (Array.isArray(obj)) {
		seen.add(obj)
		const result = obj.map((item) => safeStringify(item, seen))
		seen.delete(obj)
		return result
	}

	// Handle Date objects
	if (obj instanceof Date) {
		return obj.toISOString()
	}

	// Handle RegExp objects
	if (obj instanceof RegExp) {
		return obj.toString()
	}

	// Handle plain objects
	seen.add(obj)
	const result: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(obj)) {
		try {
			result[key] = safeStringify(value, seen)
		} catch (_error) {
			// If serialization fails for a property, mark it
			result[key] = "[Serialization Error]"
		}
	}
	seen.delete(obj)
	return result
}

/**
 * Convert an argument to a string representation, handling circular references
 * and special types. This is specifically designed for console logging.
 */
export function argToString(arg: unknown): string {
	if (typeof arg === "string") {
		return arg
	}

	try {
		const safe = safeStringify(arg)
		return JSON.stringify(safe)
	} catch (_error) {
		// Fallback if even safe stringify fails
		return "[Unable to stringify]"
	}
}

/**
 * Convert multiple arguments to a single string message, handling circular references
 */
export function argsToMessage(args: unknown[]): string {
	return args.map(argToString).join(" ")
}
