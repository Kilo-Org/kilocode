import { z } from "zod"

/**
 * Utility functions for working with Zod schemas and XML generation
 */
export class SchemaUtils {
	/**
	 * Generate XML structure from a Zod schema.
	 * This method automatically creates an XML example based on the schema definition.
	 *
	 * @param rootTag The root XML tag name
	 * @param schema The Zod schema to generate XML from
	 * @param isArrayItem Whether this is an item in an array (for proper indentation)
	 * @param indentLevel The current indentation level
	 * @returns A string containing the XML structure
	 */
	static generateXMLFromSchema(
		rootTag: string,
		schema: z.ZodTypeAny,
		isArrayItem: boolean = false,
		indentLevel: number = 0,
	): string {
		const indent = "  ".repeat(indentLevel)
		const childIndent = "  ".repeat(indentLevel + 1)
		let xml = ""

		// Handle array schemas
		if (schema instanceof z.ZodArray) {
			const itemSchema = schema._def.type
			const itemTag = SchemaUtils.getSingularTagName(rootTag)

			xml += `${indent}<${rootTag}>\n`
			xml += SchemaUtils.generateXMLFromSchema(itemTag, itemSchema, true, indentLevel + 1)
			xml += `${childIndent}<!-- Additional ${itemTag} elements as needed -->\n`
			xml += `${indent}</${rootTag}>`
			return xml
		}

		// Handle object schemas
		if (schema instanceof z.ZodObject) {
			const shape = schema._def.shape()

			if (!isArrayItem) {
				xml += `${indent}<${rootTag}>\n`
			} else {
				xml += `${indent}<${rootTag}>\n`
			}

			// Process each property in the object
			for (const [key, fieldSchema] of Object.entries(shape)) {
				const tagName = SchemaUtils.camelToSnakeCase(key)

				if (fieldSchema instanceof z.ZodObject || fieldSchema instanceof z.ZodArray) {
					// Nested object or array
					xml += SchemaUtils.generateXMLFromSchema(
						tagName,
						fieldSchema as z.ZodTypeAny,
						false,
						indentLevel + 1,
					)
					xml += "\n"
				} else {
					// Simple field
					const description = SchemaUtils.getSchemaDescription(fieldSchema as z.ZodTypeAny)
					const exampleValue = SchemaUtils.getExampleValueForSchema(fieldSchema as z.ZodTypeAny)

					if (fieldSchema instanceof z.ZodOptional) {
						xml += `${childIndent}<${tagName}>${exampleValue} (optional)</${tagName}>\n`
					} else if (fieldSchema instanceof z.ZodEnum) {
						const options = fieldSchema._def.values.join("|")
						xml += `${childIndent}<${tagName}>${options}</${tagName}>\n`
					} else {
						xml += `${childIndent}<${tagName}>${exampleValue}</${tagName}>\n`
					}
				}
			}

			if (!isArrayItem) {
				xml += `${indent}</${rootTag}>`
			} else {
				xml += `${indent}</${rootTag}>`
			}

			return xml
		}

		// Handle primitive types
		const exampleValue = SchemaUtils.getExampleValueForSchema(schema)
		xml += `${indent}<${rootTag}>${exampleValue}</${rootTag}>`
		return xml
	}

	/**
	 * Extract instructions from a Zod schema based on descriptions.
	 * This method generates usage instructions by analyzing the schema's structure and descriptions.
	 *
	 * @param schema The Zod schema to extract instructions from
	 * @param xmlTag The XML tag name for array items
	 * @param customInstructions Additional custom instructions to include
	 * @returns An array of instruction strings
	 */
	static extractInstructionsFromSchema(
		schema: z.ZodTypeAny,
		xmlTag: string,
		customInstructions: string[] = [],
	): string[] {
		const instructions: string[] = [...customInstructions]

		// Add generic instructions based on schema type
		if (schema instanceof z.ZodArray) {
			instructions.push(`Provide one or more ${SchemaUtils.getSingularTagName(xmlTag)} elements as needed`)

			// Extract instructions from the array item schema
			const itemSchema = schema._def.type
			if (itemSchema instanceof z.ZodObject) {
				SchemaUtils.extractObjectSchemaInstructions(itemSchema, instructions)
			}
		} else if (schema instanceof z.ZodObject) {
			SchemaUtils.extractObjectSchemaInstructions(schema, instructions)
		}

		return instructions
	}

	/**
	 * Helper method to extract instructions from object schema properties
	 */
	private static extractObjectSchemaInstructions(schema: z.ZodObject<any>, instructions: string[]): void {
		const shape = schema._def.shape()

		// Look for required fields with descriptions
		for (const [key, fieldSchema] of Object.entries(shape)) {
			const description = SchemaUtils.getSchemaDescription(fieldSchema as z.ZodTypeAny)
			const isOptional = fieldSchema instanceof z.ZodOptional

			if (description && !isOptional) {
				instructions.push(`Include ${SchemaUtils.camelToSnakeCase(key)}: ${description}`)
			}
		}
	}

	/**
	 * Get a description from a Zod schema if available
	 */
	private static getSchemaDescription(schema: z.ZodTypeAny): string | undefined {
		if (schema instanceof z.ZodOptional) {
			return SchemaUtils.getSchemaDescription(schema._def.innerType)
		}

		// @ts-ignore - Accessing internal _def.description
		return schema._def.description
	}

	/**
	 * Get an example value for a schema type
	 */
	private static getExampleValueForSchema(schema: z.ZodTypeAny): string {
		if (schema instanceof z.ZodString) {
			return "text"
		} else if (schema instanceof z.ZodNumber) {
			return "number"
		} else if (schema instanceof z.ZodBoolean) {
			return "true|false"
		} else if (schema instanceof z.ZodEnum) {
			return schema._def.values.join("|")
		} else if (schema instanceof z.ZodOptional) {
			return SchemaUtils.getExampleValueForSchema(schema._def.innerType)
		} else {
			return "value"
		}
	}

	/**
	 * Convert camelCase to snake_case for XML tags
	 */
	private static camelToSnakeCase(str: string): string {
		return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`).replace(/^_/, "")
	}

	/**
	 * Get singular form of a tag name for array items
	 */
	private static getSingularTagName(pluralTag: string): string {
		// Simple pluralization rules
		if (pluralTag.endsWith("s")) {
			return pluralTag.slice(0, -1)
		}
		return pluralTag + "_item"
	}
}
