import { z } from "zod"
import {
	LLMToolContext,
	LLMPromptSection,
	LLMPromptTemplate,
	Tool,
	ToolConfig,
	ToolRegistry,
	ToolSystem,
	XMLParser,
} from "./functional-types.js"

// Helper functions for XML generation and parsing
function generateXMLFromSchema(
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
		const itemTag = getSingularTagName(rootTag)

		xml += `${indent}<${rootTag}>\n`
		xml += generateXMLFromSchema(itemTag, itemSchema, true, indentLevel + 1)
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
			const tagName = camelToSnakeCase(key)

			if (fieldSchema instanceof z.ZodObject || fieldSchema instanceof z.ZodArray) {
				// Nested object or array
				xml += generateXMLFromSchema(tagName, fieldSchema, false, indentLevel + 1)
				xml += "\n"
			} else {
				// Simple field
				const exampleValue = getExampleValueForSchema(fieldSchema as z.ZodTypeAny)

				if (fieldSchema instanceof z.ZodOptional) {
					xml += `${childIndent}<${tagName}>${exampleValue} (optional)</${tagName}>\n`
				} else if (fieldSchema instanceof z.ZodEnum) {
					const options = (fieldSchema as any)._def.values.join("|")
					xml += `${childIndent}<${tagName}>${options}</${tagName}>\n`
				} else {
					xml += `${childIndent}<${tagName}>${exampleValue}</${tagName}>\n`
				}
			}
		}

		xml += `${indent}</${rootTag}>`
		return xml
	}

	// Handle primitive types
	const exampleValue = getExampleValueForSchema(schema)
	xml += `${indent}<${rootTag}>${exampleValue}</${rootTag}>`
	return xml
}

function extractInstructionsFromSchema(
	schema: z.ZodTypeAny,
	xmlTag: string,
	customInstructions: string[] = [],
): string[] {
	const instructions: string[] = [...customInstructions]

	// Add generic instructions based on schema type
	if (schema instanceof z.ZodArray) {
		instructions.push(`Provide one or more ${getSingularTagName(xmlTag)} elements as needed`)

		// Extract instructions from the array item schema
		const itemSchema = schema._def.type
		if (itemSchema instanceof z.ZodObject) {
			extractObjectSchemaInstructions(itemSchema, instructions)
		}
	} else if (schema instanceof z.ZodObject) {
		extractObjectSchemaInstructions(schema, instructions)
	}

	return instructions
}

function extractObjectSchemaInstructions(schema: z.ZodObject<any>, instructions: string[]): void {
	const shape = schema._def.shape()

	// Look for required fields with descriptions
	for (const [key, fieldSchema] of Object.entries(shape)) {
		const description = getSchemaDescription(fieldSchema as z.ZodTypeAny)
		const isOptional = fieldSchema instanceof z.ZodOptional

		if (description && !isOptional) {
			instructions.push(`Include ${camelToSnakeCase(key)}: ${description}`)
		}
	}
}

function getSchemaDescription(schema: z.ZodTypeAny): string | undefined {
	if (schema instanceof z.ZodOptional) {
		return getSchemaDescription(schema._def.innerType)
	}

	// @ts-ignore - Accessing internal _def.description
	return schema._def.description
}

function getExampleValueForSchema(schema: z.ZodTypeAny): string {
	if (schema instanceof z.ZodString) {
		return "text"
	} else if (schema instanceof z.ZodNumber) {
		return "number"
	} else if (schema instanceof z.ZodBoolean) {
		return "true|false"
	} else if (schema instanceof z.ZodEnum) {
		return (schema as any)._def.values.join("|")
	} else if (schema instanceof z.ZodOptional) {
		return getExampleValueForSchema(schema._def.innerType)
	} else {
		return "value"
	}
}

function camelToSnakeCase(str: string): string {
	return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`).replace(/^_/, "")
}

function getSingularTagName(pluralTag: string): string {
	// Simple pluralization rules
	if (pluralTag.endsWith("s")) {
		return pluralTag.slice(0, -1)
	}
	return pluralTag + "_item"
}

// Simple XML parsing for demonstration
function findCompleteTags(xml: string): Array<{ tag: string; content: string }> {
	// This is a simplified implementation - in a real library, use a proper XML parser
	const result: Array<{ tag: string; content: string }> = []

	// Look for root-level tags that match our expected tool tags
	// This regex looks for complete XML tags at the root level
	const rootTagRegex = /<(code-snippet|data-analysis)>([\s\S]*?)<\/\1>/g
	let match

	console.log("Finding complete tags in XML of length:", xml.length)
	console.log("XML preview:", xml.substring(0, 100) + "...")

	while ((match = rootTagRegex.exec(xml)) !== null) {
		console.log(`Found root tag: ${match[1]}, content length: ${match[2].length}`)
		result.push({
			tag: match[1],
			content: match[2],
		})
	}

	if (result.length === 0) {
		console.log("No root tags found, falling back to generic tag search")
		// Fallback to the original approach if no root tags are found
		const tagRegex = /<(\w+)>([\s\S]*?)<\/\1>/g
		while ((match = tagRegex.exec(xml)) !== null) {
			// Only consider top-level tags (those that don't appear to be nested)
			if (["code-snippet", "data-analysis"].includes(match[1])) {
				console.log(`Found fallback tag: ${match[1]}`)
				result.push({
					tag: match[1],
					content: match[2],
				})
			}
		}
	}

	console.log(`Found ${result.length} complete tags:`, result.map((r) => r.tag).join(", "))
	return result
}

function removeProcessedTags(xml: string, processedTags: Array<{ tag: string; content: string }>): string {
	// This is a simplified implementation - in a real library, use a proper XML parser
	let result = xml
	for (const { tag, content } of processedTags) {
		const fullTag = `<${tag}>${content}</${tag}>`
		result = result.replace(fullTag, "")
	}
	return result
}

function validateXML(content: string, schema: z.ZodTypeAny): any {
	// This is a simplified implementation - in a real library, use a proper XML parser
	// and validation system
	try {
		// Extract all tags and their content
		const tagRegex = /<(\w+)>([\s\S]*?)<\/\1>/g
		const matches = [...content.matchAll(tagRegex)]

		console.log("XML content:", content.substring(0, 100) + "...")
		console.log("Found matches:", matches.length)

		// Create an object from the matches
		const obj: Record<string, any> = {}

		for (const match of matches) {
			const [_, tagName, tagContent] = match
			console.log(`Processing tag: ${tagName}, content length: ${tagContent.length}`)

			// Handle nested tags
			if (tagContent.includes("<") && tagContent.includes("</")) {
				// Process the nested content
				const result = processNestedContent(tagName, tagContent, schema)
				obj[tagName] = result
				console.log(`Processed nested content for ${tagName}, result:`, result)
			} else {
				// Simple tag with text content
				obj[tagName] = convertToAppropriateType(tagContent)
				console.log(`Processed simple tag ${tagName}: ${obj[tagName]}`)
			}
		}

		// Special handling for array schemas
		if (schema instanceof z.ZodArray) {
			// Find the array property in the object
			const arrayProp = Object.keys(obj).find((key) => Array.isArray(obj[key]))
			if (arrayProp) {
				console.log(`Found array property: ${arrayProp}`)
				return schema.parse(obj[arrayProp])
			} else {
				// If we have a single item, wrap it in an array
				const singleItem = obj
				console.log("No array property found, wrapping in array:", singleItem)
				return schema.parse([singleItem])
			}
		}

		console.log("Final object before schema validation:", obj)
		console.log("Schema type:", schema.constructor.name)

		// Validate with schema
		return schema.parse(obj)
	} catch (error) {
		console.error("XML validation error:", error)
		throw new Error(`Validation failed: ${error instanceof Error ? error.message : String(error)}`)
	}
}

function processNestedContent(tagName: string, content: string, parentSchema: z.ZodTypeAny): any {
	console.log(`Processing nested content for tag: ${tagName}, content length: ${content.length}`)
	console.log(`Content preview: ${content.substring(0, 50)}...`)

	// Check if this is a container for array items
	const nestedTagRegex = /<(\w+)>([\s\S]*?)<\/\1>/g
	const nestedMatches = [...content.matchAll(nestedTagRegex)]

	console.log(`Found ${nestedMatches.length} nested matches`)

	// If there are no nested matches, return the content as is
	if (nestedMatches.length === 0) {
		console.log(`No nested matches for ${tagName}, returning content as is`)
		return content.trim()
	}

	// Check if all nested tags have the same name (indicating an array)
	const tagNames = nestedMatches.map((match) => match[1])
	const uniqueTagNames = new Set(tagNames)

	console.log(`Tag names: ${tagNames.join(", ")}`)
	console.log(`Unique tag names: ${[...uniqueTagNames].join(", ")}`)

	// If we have a single tag name repeated, it's likely an array
	if (uniqueTagNames.size === 1 && tagNames.length > 1) {
		const itemTagName = tagNames[0]
		console.log(`Detected array of ${itemTagName} items (${tagNames.length} items)`)

		// Extract schema for array items if possible
		let itemSchema: z.ZodTypeAny | undefined

		if (parentSchema instanceof z.ZodObject) {
			const shape = parentSchema._def.shape()
			const fieldSchema = shape[tagName]

			if (fieldSchema instanceof z.ZodArray) {
				itemSchema = fieldSchema._def.type
				console.log(`Found array schema for ${tagName}`)
			} else {
				console.log(`No array schema found for ${tagName} in parent schema`)
			}
		} else {
			console.log(`Parent schema is not an object: ${parentSchema.constructor.name}`)
		}

		// Process each item
		console.log(`Processing ${nestedMatches.length} array items`)
		const result = nestedMatches.map(([_, __, itemContent], index) => {
			console.log(`Processing array item ${index + 1}/${nestedMatches.length}`)

			// If the item content has nested tags, process them recursively
			if (itemContent.includes("<") && itemContent.includes("</")) {
				console.log(`Item ${index + 1} has nested tags`)
				const itemObj: Record<string, any> = {}
				const itemTagRegex = /<(\w+)>([\s\S]*?)<\/\1>/g
				const itemTags = [...itemContent.matchAll(itemTagRegex)]

				console.log(`Found ${itemTags.length} tags in item ${index + 1}`)

				for (const [___, itemTagName, itemTagContent] of itemTags) {
					console.log(`Processing item tag: ${itemTagName}`)
					// Recursively process nested content
					if (itemTagContent.includes("<") && itemTagContent.includes("</")) {
						console.log(`Tag ${itemTagName} has nested content, recursing...`)
						itemObj[itemTagName] = processNestedContent(
							itemTagName,
							itemTagContent,
							itemSchema || parentSchema,
						)
					} else {
						const convertedValue = convertToAppropriateType(itemTagContent)
						itemObj[itemTagName] = convertedValue
						console.log(`Set ${itemTagName} = ${JSON.stringify(convertedValue)}`)
					}
				}

				console.log(`Completed item ${index + 1} object:`, itemObj)
				return itemObj
			} else {
				const result = convertToAppropriateType(itemContent)
				console.log(`Simple item ${index + 1} content: ${JSON.stringify(result)}`)
				return result
			}
		})

		console.log(`Processed array with ${result.length} items`)
		return result
	} else {
		// This is a nested object, not an array
		console.log(`Processing as nested object with ${nestedMatches.length} properties`)
		const nestedObj: Record<string, any> = {}

		for (const [_, nestedTagName, nestedTagContent] of nestedMatches) {
			console.log(`Processing nested object property: ${nestedTagName}`)
			// Recursively process nested content
			if (nestedTagContent.includes("<") && nestedTagContent.includes("</")) {
				console.log(`Property ${nestedTagName} has nested content, recursing...`)
				nestedObj[nestedTagName] = processNestedContent(nestedTagName, nestedTagContent, parentSchema)
			} else {
				const convertedValue = convertToAppropriateType(nestedTagContent)
				nestedObj[nestedTagName] = convertedValue
				console.log(`Set ${nestedTagName} = ${JSON.stringify(convertedValue)}`)
			}
		}

		console.log(`Completed nested object:`, nestedObj)
		return nestedObj
	}
}

// Helper function to convert string values to appropriate types
function convertToAppropriateType(value: string): any {
	console.log(`Converting value: "${value.substring(0, 30)}${value.length > 30 ? "..." : ""}"`)

	// Trim whitespace
	const trimmed = value.trim()
	console.log(`After trimming: "${trimmed.substring(0, 30)}${trimmed.length > 30 ? "..." : ""}"`)

	// Try to convert to number
	if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
		const num = Number(trimmed)
		console.log(`Converted to number: ${num}`)
		return num
	}

	// Try to convert to boolean
	if (trimmed.toLowerCase() === "true") {
		console.log(`Converted to boolean: true`)
		return true
	}
	if (trimmed.toLowerCase() === "false") {
		console.log(`Converted to boolean: false`)
		return false
	}

	// Default to string
	console.log(`Keeping as string, length: ${trimmed.length}`)
	return trimmed
}

// Main factory functions
export function createTool<TSchema extends z.ZodTypeAny = z.ZodTypeAny, TData = z.infer<TSchema>>(
	config: ToolConfig<TSchema, TData>,
): Tool<TSchema, TData> {
	// Validate config
	if (!config.id || typeof config.id !== "string") {
		throw new Error("Tool config must have a valid string id")
	}
	if (!config.name || typeof config.name !== "string") {
		throw new Error("Tool config must have a valid string name")
	}
	if (!config.description || typeof config.description !== "string") {
		throw new Error("Tool config must have a valid string description")
	}
	if (!config.schema) {
		throw new Error("Tool config must have a valid Zod schema")
	}
	if (!config.xmlTag || typeof config.xmlTag !== "string") {
		throw new Error("Tool config must have a valid string xmlTag")
	}

	// Return the tool object
	return {
		id: config.id,
		name: config.name,
		description: config.description,
		schema: config.schema,
		xmlTag: config.xmlTag,
		enabled: config.enabled ?? true,
		metadata: config.metadata,
		version: config.version ?? "1.0.0",
		category: config.category ?? "general",

		generateXML() {
			return generateXMLFromSchema(this.xmlTag, this.schema)
		},

		generatePrompt(instructions = []) {
			const xmlStructure = this.generateXML()
			const allInstructions = extractInstructionsFromSchema(this.schema, this.xmlTag, instructions)

			return {
				id: this.id,
				title: this.name,
				content: `
${this.name}:
${xmlStructure.trim()}

${allInstructions.map((instruction) => `- ${instruction}`).join("\n")}
`.trim(),
				order: 0,
			}
		},

		async handleResponse(data, context) {
			return config.handler ? config.handler(data, context) : data
		},
	}
}

export function createToolSystem<T extends ToolRegistry = {}>(initialTools: Tool<any, any>[] = []): ToolSystem<T> {
	// Private state
	type ToolId = keyof T & string
	const toolsById: Record<string, Tool<any, any>> = {}
	const results = new Map<string, any>()
	const callbacks: Record<string, ((data: any) => void)[]> = {}
	let globalCallbacks: ((toolId: string, data: any) => void)[] = []
	let streamController: AbortController | null = null

	// Add initial tools
	initialTools.forEach((tool) => {
		toolsById[tool.id] = tool
	})

	// Create XML parser
	function createParser(): XMLParser {
		let buffer = ""
		const toolsByTag: Record<string, Tool<any, any>> = {}

		// Map tools by XML tag
		Object.values(toolsById).forEach((tool) => {
			toolsByTag[tool.xmlTag] = tool
		})

		return {
			processChunk(chunk: string) {
				// Add to buffer
				buffer += chunk

				// Find complete tags
				const completeTags = findCompleteTags(buffer)

				// Update buffer
				buffer = removeProcessedTags(buffer, completeTags)

				// Process complete tags
				console.log(
					`Processing ${completeTags.length} complete tags:`,
					completeTags.map((t) => t.tag).join(", "),
				)

				const results = completeTags
					.map(({ tag, content }) => {
						console.log(`Processing tag: ${tag}, content length: ${content.length}`)
						const tool = toolsByTag[tag]
						if (!tool) {
							console.error(`No tool found for tag: ${tag}`)
							console.log(`Available tags:`, Object.keys(toolsByTag).join(", "))
							return null
						}

						console.log(`Found tool: ${tool.id} for tag: ${tag}`)
						try {
							console.log(`Validating XML for ${tag} with schema: ${tool.schema.constructor.name}`)
							const data = validateXML(content, tool.schema)
							console.log(`Validation successful for ${tag}, data:`, data)
							return { toolId: tool.id, data }
						} catch (error) {
							console.error(`Error validating ${tag}:`, error)
							return null
						}
					})
					.filter((result): result is { toolId: string; data: any } => result !== null)

				console.log(`Processed ${results.length} valid results`)
				return results
			},
		}
	}

	// The system object with type-safe implementation
	const system = {
		addTool<S extends z.ZodTypeAny, R = z.infer<S>>(tool: Tool<S, R>) {
			toolsById[tool.id] = tool
			// Cast to maintain type information about the new tool
			return system as unknown as ToolSystem<
				T & { [K in typeof tool.id]: { tool: Tool<S, R>; schema: S; dataType: R } }
			>
		},

		onToolResponse(
			toolIdOrCallback: ((toolId: string, data: any) => void) | string,
			callback?: (data: any) => void,
		) {
			if (typeof toolIdOrCallback === "function") {
				// Global callback
				globalCallbacks.push(toolIdOrCallback)
			} else {
				// Tool-specific callback
				if (!callbacks[toolIdOrCallback]) {
					callbacks[toolIdOrCallback] = []
				}
				if (callback) {
					callbacks[toolIdOrCallback].push(callback)
				}
			}
			return system
		},

		generatePrompt({ userMessage, systemMessage = "" }) {
			const toolSections = Object.values(toolsById)
				.filter((tool) => tool.enabled)
				.map((tool) => tool.generatePrompt())
				.sort((a, b) => a.order - b.order)

			return `${systemMessage}\n\n${toolSections.map((s) => s.content).join("\n\n")}\n\n${userMessage}`
		},

		async processStream(stream, options = {}) {
			const { onChunk, onComplete, onError } = options
			const parser = createParser()

			streamController = new AbortController()
			const { signal } = streamController

			try {
				for await (const chunk of stream) {
					if (signal.aborted) break

					if (onChunk) onChunk(chunk)

					const parsedTools = parser.processChunk(chunk)

					for (const { toolId, data } of parsedTools) {
						// Store result
						results.set(toolId, data)

						// Call tool handler
						const tool = toolsById[toolId]
						const result = await tool.handleResponse(data, { system })

						// Check for termination request
						if (result && typeof result === "object" && result.control?.terminateStream) {
							system.terminateStream(result.control.reason)
							break
						}

						// Fire callbacks
						globalCallbacks.forEach((cb) => cb(toolId, data))
						if (callbacks[toolId]) {
							callbacks[toolId].forEach((cb) => cb(data))
						}
					}
				}

				if (onComplete) onComplete()
			} catch (error) {
				if (onError) onError(error instanceof Error ? error : new Error(String(error)))
			}

			return system
		},

		terminateStream(reason = "Manually terminated") {
			if (streamController) {
				streamController.abort(reason)
			}
			return system
		},

		getResults() {
			// Cast the results to the expected type
			return Object.fromEntries(results) as { [K in keyof T]?: T[K]["dataType"] }
		},

		getResult(toolId: string) {
			// Cast the result to the expected type
			return results.get(toolId) as any
		},
	} as ToolSystem<T>

	return system
}

export function createXMLParser(tools: Tool<any, any>[]): XMLParser {
	// Private state
	let buffer = ""
	const toolsByTag: Record<string, Tool<any, any>> = {}

	// Map tools by XML tag
	tools.forEach((tool) => {
		toolsByTag[tool.xmlTag] = tool
	})

	return {
		processChunk(chunk: string) {
			// Add to buffer
			buffer += chunk

			// Find complete tags
			const completeTags = findCompleteTags(buffer)

			// Update buffer
			buffer = removeProcessedTags(buffer, completeTags)

			// Process complete tags
			return completeTags
				.map(({ tag, content }) => {
					const tool = toolsByTag[tag]
					if (!tool) return null

					try {
						const data = validateXML(content, tool.schema)
						return { toolId: tool.id, data }
					} catch (error) {
						console.error(`Error validating ${tag}:`, error)
						return null
					}
				})
				.filter((result): result is { toolId: string; data: any } => result !== null)
		},
	}
}

// Helper function to create a basic prompt template
export function createBasicPromptTemplate(): LLMPromptTemplate {
	return {
		systemPrefix: "You are an AI assistant. Provide responses in the specified XML formats:\n\n",
		systemSuffix: "\nUse the XML formats above for all responses.",
		sectionSeparator: "\n\n",
		includeToolList: true,
	}
}
