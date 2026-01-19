// pnpm --filter @roo-code/core test src/custom-tools/__tests__/format-xml.spec.ts

import { type SerializedCustomToolDefinition, parametersSchema as z, defineCustomTool } from "@roo-code/types"

import { serializeCustomTool, serializeCustomTools } from "../serialize.js"
import { formatXml } from "../format-xml.js"

import simpleTool from "./fixtures/simple.js"
import cachedTool from "./fixtures/cached.js"
import legacyTool from "./fixtures/legacy.js"
import { toolA, toolB } from "./fixtures/multi.js"
import { validTool as mixedValidTool } from "./fixtures/mixed.js"

const fixtureTools = {
	simple: simpleTool,
	cached: cachedTool,
	legacy: legacyTool,
	multi_toolA: toolA,
	multi_toolB: toolB,
	mixed_validTool: mixedValidTool,
}

describe("formatXml", () => {
	it("should return empty string for empty tools array", () => {
		expect(formatXml([])).toBe("")
	})

	it("should throw for undefined tools", () => {
		expect(() => formatXml(undefined as unknown as SerializedCustomToolDefinition[])).toThrow()
	})

	it("should generate description for a single tool without args", () => {
		const tool = defineCustomTool({
			name: "my_tool",
			description: "A simple tool that does something",
			async execute() {
				return "done"
			},
		})

		const serialized = serializeCustomTool(tool)
		const result = formatXml([serialized])

		expect(result).toContain("# Custom Tools")
		expect(result).toContain("## my_tool")
		expect(result).toContain("Description: A simple tool that does something")
		expect(result).toContain("Parameters: None")
		expect(result).toContain("<my_tool>")
		expect(result).toContain("</my_tool>")
	})

	it("should generate description for a tool with required args", () => {
		const tool = defineCustomTool({
			name: "greeter",
			description: "Greets a person by name",
			parameters: z.object({
				name: z.string().describe("The name of the person to greet"),
			}),
			async execute({ name }) {
				return `Hello, ${name}!`
			},
		})

		const serialized = serializeCustomTool(tool)
		const result = formatXml([serialized])

		expect(result).toContain("## greeter")
		expect(result).toContain("Description: Greets a person by name")
		expect(result).toContain("Parameters:")
		expect(result).toContain("- name: (required) The name of the person to greet (type: string)")
		expect(result).toContain("<greeter>")
		expect(result).toContain("<name>name value here</name>")
		expect(result).toContain("</greeter>")
	})

	it("should generate description for a tool with optional args", () => {
		const tool = defineCustomTool({
			name: "configurable_tool",
			description: "A tool with optional configuration",
			parameters: z.object({
				input: z.string().describe("The input to process"),
				format: z.string().optional().describe("Output format"),
			}),
			async execute({ input, format }) {
				return format ? `${input} (${format})` : input
			},
		})

		const serialized = serializeCustomTool(tool)
		const result = formatXml([serialized])

		expect(result).toContain("- input: (required) The input to process (type: string)")
		expect(result).toContain("- format: (optional) Output format (type: string)")
		expect(result).toContain("<input>input value here</input>")
		expect(result).toContain("<format>optional format value</format>")
	})

	it("should generate descriptions for multiple tools", () => {
		const tools = [
			defineCustomTool({
				name: "tool_a",
				description: "First tool",
				async execute() {
					return "a"
				},
			}),
			defineCustomTool({
				name: "tool_b",
				description: "Second tool",
				parameters: z.object({
					value: z.number().describe("A numeric value"),
				}),
				async execute() {
					return "b"
				},
			}),
		]

		const serialized = serializeCustomTools(tools)
		const result = formatXml(serialized)

		expect(result).toContain("## tool_a")
		expect(result).toContain("Description: First tool")
		expect(result).toContain("## tool_b")
		expect(result).toContain("Description: Second tool")
		expect(result).toContain("- value: (required) A numeric value (type: number)")
	})

	it("should treat args in required array as required", () => {
		// Using a raw SerializedToolDefinition to test the required behavior.
		const tools: SerializedCustomToolDefinition[] = [
			{
				name: "test_tool",
				description: "Test tool",
				parameters: {
					type: "object",
					properties: {
						data: {
							type: "object",
							description: "Some data",
						},
					},
					required: ["data"],
				},
			},
		]

		const result = formatXml(tools)

		expect(result).toContain("- data: (required) Some data (type: object)")
		expect(result).toContain("<data>data value here</data>")
	})
})

describe("XML Protocol snapshots", () => {
	it("should generate correct XML description for simple tool", () => {
		const serialized = serializeCustomTool(fixtureTools.simple)
		const result = formatXml([serialized])
		expect(result).toMatchSnapshot()
	})

	it("should generate correct XML description for cached tool", () => {
		const serialized = serializeCustomTool(fixtureTools.cached)
		const result = formatXml([serialized])
		expect(result).toMatchSnapshot()
	})

	it("should generate correct XML description for legacy tool (using args)", () => {
		const serialized = serializeCustomTool(fixtureTools.legacy)
		const result = formatXml([serialized])
		expect(result).toMatchSnapshot()
	})

	it("should generate correct XML description for multi export tools", () => {
		const serializedA = serializeCustomTool(fixtureTools.multi_toolA)
		const serializedB = serializeCustomTool(fixtureTools.multi_toolB)
		const result = formatXml([serializedA, serializedB])
		expect(result).toMatchSnapshot()
	})

	it("should generate correct XML description for mixed export tool", () => {
		const serialized = serializeCustomTool(fixtureTools.mixed_validTool)
		const result = formatXml([serialized])
		expect(result).toMatchSnapshot()
	})

	it("should generate correct XML description for all fixtures combined", () => {
		const allSerialized = Object.values(fixtureTools).map(serializeCustomTool)
		const result = formatXml(allSerialized)
		expect(result).toMatchSnapshot()
	})
})
