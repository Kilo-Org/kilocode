// kilocode_change - new file
type JsonSchema = any

const isObjectLike = (value: unknown): value is Record<string, any> =>
	!!value && typeof value === "object" && !Array.isArray(value)

const isSchemaObjectNode = (schema: JsonSchema): boolean => {
	if (!isObjectLike(schema)) return false
	return schema.type === "object" || isObjectLike(schema.properties)
}

/**
 * Recursively ensures `additionalProperties` is present (default false) for object schemas that declare `properties`.
 *
 * OpenAI strict tool schemas require `additionalProperties` to be explicitly provided and `false`
 * for objects using `properties`.
 */
export const normalizeObjectAdditionalPropertiesFalse = (schema: JsonSchema): JsonSchema => {
	if (!schema || typeof schema !== "object") return schema

	if (Array.isArray(schema)) {
		return schema.map((item) => normalizeObjectAdditionalPropertiesFalse(item))
	}

	const result: Record<string, any> = { ...(schema as any) }

	// Normalize this node
	if (isSchemaObjectNode(result) && isObjectLike(result.properties)) {
		// Only add when missing/undefined; do not override dictionary semantics.
		if (result.additionalProperties === undefined) {
			result.additionalProperties = false
		}
	}

	// Recurse into common schema composition keywords
	for (const key of ["anyOf", "oneOf", "allOf"] as const) {
		if (Array.isArray(result[key])) {
			result[key] = result[key].map((s: any) => normalizeObjectAdditionalPropertiesFalse(s))
		}
	}

	// Recurse into items
	if (result.items) {
		result.items = normalizeObjectAdditionalPropertiesFalse(result.items)
	}

	// Recurse into properties
	if (isObjectLike(result.properties)) {
		const nextProps: Record<string, any> = { ...result.properties }
		for (const [propKey, propSchema] of Object.entries(nextProps)) {
			nextProps[propKey] = normalizeObjectAdditionalPropertiesFalse(propSchema)
		}
		result.properties = nextProps
	}

	// Recurse into additionalProperties *schema* if present (doesn't change semantics)
	if (isObjectLike(result.additionalProperties)) {
		result.additionalProperties = normalizeObjectAdditionalPropertiesFalse(result.additionalProperties)
	}

	// Recurse into definitions containers when present
	for (const defsKey of ["$defs", "definitions"] as const) {
		if (isObjectLike(result[defsKey])) {
			const nextDefs: Record<string, any> = { ...result[defsKey] }
			for (const [defKey, defSchema] of Object.entries(nextDefs)) {
				nextDefs[defKey] = normalizeObjectAdditionalPropertiesFalse(defSchema)
			}
			result[defsKey] = nextDefs
		}
	}

	return result
}
