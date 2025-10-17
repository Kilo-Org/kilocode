/**
 * Represents a native tool call from OpenAI-compatible APIs
 */
export interface NativeToolCall {
	index?: number // OpenAI uses index to track across streaming deltas
	id?: string // Only present in first delta
	type?: string
	function?: {
		name: string
		arguments: string // JSON string (may be partial during streaming)
	}
}

/**
 * Recursively parse any string values that appear to be JSON-encoded.
 * This handles cases where the model double-encodes parameters.
 *
 * @param obj - The object to process
 * @returns The object with any double-encoded strings parsed
 */
export function parseDoubleEncodedParams(obj: any): any {
	if (obj === null || obj === undefined) {
		return obj
	}

	// If it's a string that looks like JSON, try to parse it
	if (typeof obj === "string") {
		const trimmed = obj.trim()
		if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
			try {
				const parsed = JSON.parse(obj)
				// Recursively process the parsed value in case it has more double-encoding
				// console.debug("[AssistantMessageParser] Parsed double-encoded JSON:", JSON.stringify(parsed))
				return parseDoubleEncodedParams(parsed)
			} catch {
				// Not valid JSON, return as-is
				return obj
			}
		}
		return obj
	}

	// If it's an array, recursively process each element
	if (Array.isArray(obj)) {
		return obj.map((item) => parseDoubleEncodedParams(item))
	}

	// If it's an object, recursively process each property
	if (typeof obj === "object") {
		const result: Record<string, any> = {}
		for (const [key, value] of Object.entries(obj)) {
			result[key] = parseDoubleEncodedParams(value)
		}
		return result
	}

	// Primitive types (number, boolean, etc.) return as-is
	return obj
}
