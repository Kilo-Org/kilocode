import { describe, it, expect } from "vitest"
import { normalizeToolSchema } from "../json-schema"

describe("normalizeToolSchema", () => {
	it("should convert type array to anyOf for nullable string", () => {
		const input = {
			type: ["string", "null"],
			description: "Optional field",
		}

		const result = normalizeToolSchema(input)

		// additionalProperties should NOT be added to non-object types (string, null)
		expect(result).toEqual({
			anyOf: [{ type: "string" }, { type: "null" }],
			description: "Optional field",
		})
	})

	it("should convert type array to anyOf for nullable array", () => {
		const input = {
			type: ["array", "null"],
			items: { type: "string" },
			description: "Optional array",
		}

		const result = normalizeToolSchema(input)

		// Array-specific properties (items) should be moved inside the array variant
		// This is required by strict schema validators like GPT-5-mini
		expect(result).toEqual({
			anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }],
			description: "Optional array",
		})
	})

	it("should preserve single type values", () => {
		const input = {
			type: "string",
			description: "Required field",
		}

		const result = normalizeToolSchema(input)

		// additionalProperties should NOT be added to string type
		expect(result).toEqual({
			type: "string",
			description: "Required field",
		})
	})

	it("should recursively transform nested properties", () => {
		const input = {
			type: "object",
			properties: {
				name: { type: "string" },
				optional: {
					type: ["string", "null"],
					description: "Optional nested field",
				},
			},
			required: ["name"],
		}

		const result = normalizeToolSchema(input)

		// additionalProperties: false should ONLY be on the object type, not on primitives
		expect(result).toEqual({
			type: "object",
			properties: {
				name: { type: "string" },
				optional: {
					anyOf: [{ type: "string" }, { type: "null" }],
					description: "Optional nested field",
				},
			},
			required: ["name"],
			additionalProperties: false,
		})
	})

	it("should recursively transform items in arrays", () => {
		const input = {
			type: "array",
			items: {
				type: "object",
				properties: {
					path: { type: "string" },
					line_ranges: {
						type: ["array", "null"],
						items: { type: "integer" },
					},
				},
			},
		}

		const result = normalizeToolSchema(input)

		// additionalProperties: false should ONLY be on object types
		// Array-specific properties (items) should be moved inside the array variant
		expect(result).toEqual({
			type: "array",
			items: {
				type: "object",
				properties: {
					path: { type: "string" },
					line_ranges: {
						anyOf: [{ type: "array", items: { type: "integer" } }, { type: "null" }],
					},
				},
				additionalProperties: false,
			},
		})
	})

	it("should handle deeply nested structures", () => {
		const input = {
			type: "object",
			properties: {
				files: {
					type: "array",
					items: {
						type: "object",
						properties: {
							path: { type: "string" },
							line_ranges: {
								type: ["array", "null"],
								items: {
									type: "array",
									items: { type: "integer" },
								},
							},
						},
						required: ["path", "line_ranges"],
					},
				},
			},
		}

		const result = normalizeToolSchema(input)

		expect(result.properties).toBeDefined()
		const properties = result.properties as Record<string, Record<string, unknown>>
		const filesItems = properties.files.items as Record<string, unknown>
		const filesItemsProps = filesItems.properties as Record<string, Record<string, unknown>>
		// Array-specific properties (items) should be moved inside the array variant
		expect(filesItemsProps.line_ranges.anyOf).toEqual([
			{ type: "array", items: { type: "array", items: { type: "integer" } } },
			{ type: "null" },
		])
	})

	it("should flatten top-level anyOf and recursively transform nested schemas", () => {
		// Top-level anyOf is flattened for provider compatibility (OpenRouter/Claude)
		// but nested anyOf inside properties is preserved
		const input = {
			anyOf: [
				{
					type: "object",
					properties: {
						optional: { type: ["string", "null"] },
					},
				},
				{ type: "null" },
			],
		}

		const result = normalizeToolSchema(input)

		// Top-level anyOf should be flattened to the object variant
		// Nested type array should be converted to anyOf
		expect(result).toEqual({
			type: "object",
			properties: {
				optional: { anyOf: [{ type: "string" }, { type: "null" }] },
			},
			additionalProperties: false,
		})
	})

	it("should handle null or non-object input", () => {
		expect(normalizeToolSchema(null as any)).toBeNull()
		expect(normalizeToolSchema("string" as any)).toBe("string")
		expect(normalizeToolSchema(123 as any)).toBe(123)
	})

	it("should force additionalProperties to false for object types even when set to a schema", () => {
		// For strict mode compatibility, we MUST force additionalProperties: false
		// even when the original schema allowed arbitrary properties
		const input = {
			type: "object",
			additionalProperties: {
				type: ["string", "null"],
			},
		}

		const result = normalizeToolSchema(input)

		// The original additionalProperties schema is replaced with false for strict mode
		expect(result).toEqual({
			type: "object",
			properties: {},
			additionalProperties: false,
		})
	})

	it("should preserve additionalProperties when it is a boolean", () => {
		const input = {
			type: "object",
			additionalProperties: false,
		}

		const result = normalizeToolSchema(input)

		expect(result).toEqual({
			type: "object",
			properties: {},
			additionalProperties: false,
		})
	})

	it("should handle the read_file tool schema structure", () => {
		// This is the actual structure used in read_file tool
		const input = {
			type: "object",
			properties: {
				files: {
					type: "array",
					description: "List of files to read",
					items: {
						type: "object",
						properties: {
							path: {
								type: "string",
								description: "Path to the file",
							},
							line_ranges: {
								type: ["array", "null"],
								description: "Optional line ranges",
								items: {
									type: "array",
									items: { type: "integer" },
									minItems: 2,
									maxItems: 2,
								},
							},
						},
						required: ["path", "line_ranges"],
						additionalProperties: false,
					},
					minItems: 1,
				},
			},
			required: ["files"],
			additionalProperties: false,
		}

		const result = normalizeToolSchema(input)

		// Verify the line_ranges was transformed with items inside the array variant
		const files = (result.properties as Record<string, unknown>).files as Record<string, unknown>
		const items = files.items as Record<string, unknown>
		const props = items.properties as Record<string, Record<string, unknown>>
		// Array-specific properties (items, minItems, maxItems) should be moved inside the array variant
		expect(props.line_ranges.anyOf).toEqual([
			{
				type: "array",
				items: {
					type: "array",
					items: { type: "integer" },
					minItems: 2,
					maxItems: 2,
				},
			},
			{ type: "null" },
		])
		// items should NOT be at root level anymore
		expect(props.line_ranges.items).toBeUndefined()
		// Other properties are preserved at root level
		expect(props.line_ranges.description).toBe("Optional line ranges")
	})

	describe("format field handling", () => {
		it("should preserve supported format values (date-time)", () => {
			const input = {
				type: "string",
				format: "date-time",
				description: "Timestamp",
			}

			const result = normalizeToolSchema(input)

			// additionalProperties should NOT be added to string types
			expect(result).toEqual({
				type: "string",
				format: "date-time",
				description: "Timestamp",
			})
		})

		it("should preserve supported format values (email)", () => {
			const input = {
				type: "string",
				format: "email",
			}

			const result = normalizeToolSchema(input)

			expect(result.format).toBe("email")
		})

		it("should preserve supported format values (uuid)", () => {
			const input = {
				type: "string",
				format: "uuid",
			}

			const result = normalizeToolSchema(input)

			expect(result.format).toBe("uuid")
		})

		it("should preserve all supported format values", () => {
			const supportedFormats = [
				"date-time",
				"time",
				"date",
				"duration",
				"email",
				"hostname",
				"ipv4",
				"ipv6",
				"uuid",
			]

			for (const format of supportedFormats) {
				const input = { type: "string", format }
				const result = normalizeToolSchema(input)
				expect(result.format).toBe(format)
			}
		})

		it("should strip unsupported format value (uri)", () => {
			const input = {
				type: "string",
				format: "uri",
				description: "URL field",
			}

			const result = normalizeToolSchema(input)

			// additionalProperties should NOT be added to string types
			expect(result).toEqual({
				type: "string",
				description: "URL field",
			})
			expect(result.format).toBeUndefined()
		})

		it("should strip unsupported format value (uri-reference)", () => {
			const input = {
				type: "string",
				format: "uri-reference",
			}

			const result = normalizeToolSchema(input)

			expect(result.format).toBeUndefined()
		})

		it("should strip unsupported format values (various)", () => {
			const unsupportedFormats = ["uri", "uri-reference", "iri", "iri-reference", "regex", "json-pointer"]

			for (const format of unsupportedFormats) {
				const input = { type: "string", format }
				const result = normalizeToolSchema(input)
				expect(result.format).toBeUndefined()
			}
		})

		it("should strip unsupported format in nested properties", () => {
			const input = {
				type: "object",
				properties: {
					url: {
						type: "string",
						format: "uri",
						description: "A URL",
					},
					email: {
						type: "string",
						format: "email",
						description: "An email",
					},
				},
			}

			const result = normalizeToolSchema(input)

			const props = result.properties as Record<string, Record<string, unknown>>
			expect(props.url.format).toBeUndefined()
			expect(props.url.description).toBe("A URL")
			expect(props.email.format).toBe("email")
			expect(props.email.description).toBe("An email")
		})

		it("should strip unsupported format in deeply nested structures", () => {
			const input = {
				type: "object",
				properties: {
					items: {
						type: "array",
						items: {
							type: "object",
							properties: {
								link: {
									type: "string",
									format: "uri",
								},
								timestamp: {
									type: "string",
									format: "date-time",
								},
							},
						},
					},
				},
			}

			const result = normalizeToolSchema(input)

			const props = result.properties as Record<string, Record<string, unknown>>
			const itemsItems = props.items.items as Record<string, unknown>
			const nestedProps = itemsItems.properties as Record<string, Record<string, unknown>>
			expect(nestedProps.link.format).toBeUndefined()
			expect(nestedProps.timestamp.format).toBe("date-time")
		})

		it("should handle MCP fetch server schema with uri format", () => {
			// This is similar to the actual fetch MCP server schema that caused the error
			const input = {
				type: "object",
				properties: {
					url: {
						type: "string",
						format: "uri",
						description: "URL to fetch",
					},
				},
				required: ["url"],
			}

			const result = normalizeToolSchema(input)

			const props = result.properties as Record<string, Record<string, unknown>>
			expect(props.url.format).toBeUndefined()
			expect(props.url.type).toBe("string")
			expect(props.url.description).toBe("URL to fetch")
		})

		describe("top-level anyOf/oneOf/allOf flattening", () => {
			it("should flatten top-level anyOf to object schema", () => {
				// This is the type of schema that caused the OpenRouter error:
				// "input_schema does not support oneOf, allOf, or anyOf at the top level"
				const input = {
					anyOf: [
						{
							type: "object",
							properties: {
								name: { type: "string" },
							},
							required: ["name"],
						},
						{ type: "null" },
					],
				}

				const result = normalizeToolSchema(input)

				// Should flatten to the object variant
				expect(result.anyOf).toBeUndefined()
				expect(result.type).toBe("object")
				expect(result.properties).toBeDefined()
				expect((result.properties as Record<string, unknown>).name).toEqual({ type: "string" })
				expect(result.additionalProperties).toBe(false)
			})

			it("should flatten top-level oneOf to object schema", () => {
				const input = {
					oneOf: [
						{
							type: "object",
							properties: {
								url: { type: "string" },
							},
						},
						{
							type: "object",
							properties: {
								path: { type: "string" },
							},
						},
					],
				}

				const result = normalizeToolSchema(input)

				// Should use the first object variant
				expect(result.oneOf).toBeUndefined()
				expect(result.type).toBe("object")
				expect((result.properties as Record<string, unknown>).url).toBeDefined()
			})

			it("should flatten top-level allOf to object schema", () => {
				const input = {
					allOf: [
						{
							type: "object",
							properties: {
								base: { type: "string" },
							},
						},
						{
							properties: {
								extra: { type: "number" },
							},
						},
					],
				}

				const result = normalizeToolSchema(input)

				// Should use the first object variant
				expect(result.allOf).toBeUndefined()
				expect(result.type).toBe("object")
			})

			it("should preserve description when flattening top-level anyOf", () => {
				const input = {
					description: "Input for the tool",
					anyOf: [
						{
							type: "object",
							properties: {
								data: { type: "string" },
							},
						},
						{ type: "null" },
					],
				}

				const result = normalizeToolSchema(input)

				expect(result.description).toBe("Input for the tool")
				expect(result.anyOf).toBeUndefined()
				expect(result.type).toBe("object")
			})

			it("should create generic object schema if no object variant found", () => {
				const input = {
					anyOf: [{ type: "string" }, { type: "number" }],
				}

				const result = normalizeToolSchema(input)

				// Should create a fallback object schema
				expect(result.anyOf).toBeUndefined()
				expect(result.type).toBe("object")
				expect(result.additionalProperties).toBe(false)
			})

			it("should NOT flatten nested anyOf (only top-level)", () => {
				const input = {
					type: "object",
					properties: {
						field: {
							anyOf: [{ type: "string" }, { type: "null" }],
						},
					},
				}

				const result = normalizeToolSchema(input)

				// Nested anyOf should be preserved
				const props = result.properties as Record<string, Record<string, unknown>>
				expect(props.field.anyOf).toBeDefined()
			})

			it("should handle MCP server schema with top-level anyOf", () => {
				// Real-world example: some MCP servers define optional nullable root schemas
				const input = {
					$schema: "http://json-schema.org/draft-07/schema#",
					anyOf: [
						{
							type: "object",
							additionalProperties: false,
							properties: {
								issueId: { type: "string", description: "The issue ID" },
								body: { type: "string", description: "The content" },
							},
							required: ["issueId", "body"],
						},
					],
				}

				const result = normalizeToolSchema(input)

				expect(result.anyOf).toBeUndefined()
				expect(result.type).toBe("object")
				expect(result.properties).toBeDefined()
				expect(result.required).toContain("issueId")
				expect(result.required).toContain("body")
			})
		})
	})
})
