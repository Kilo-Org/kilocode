// pnpm --filter @roo-code/core test src/custom-tools/__tests__/serialize.spec.ts

import { parametersSchema as z, defineCustomTool } from "@roo-code/types"

import { serializeCustomTool, serializeCustomTools } from "../serialize.js"

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

describe("serializeCustomTool", () => {
	it("should serialize a tool without parameters", () => {
		const tool = defineCustomTool({
			name: "simple_tool",
			description: "A simple tool that does something",
			async execute() {
				return "done"
			},
		})

		const result = serializeCustomTool(tool)

		expect(result).toEqual({
			name: "simple_tool",
			description: "A simple tool that does something",
		})
	})

	it("should serialize a tool with required string parameter", () => {
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

		const result = serializeCustomTool(tool)

		expect(result.name).toBe("greeter")
		expect(result.description).toBe("Greets a person by name")
		expect(result.parameters?.properties?.name).toEqual({
			type: "string",
			description: "The name of the person to greet",
		})
		expect(result.parameters?.required).toEqual(["name"])
	})

	it("should serialize a tool with optional parameter", () => {
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

		const result = serializeCustomTool(tool)

		expect(result.parameters?.properties?.input).toEqual({
			type: "string",
			description: "The input to process",
		})

		expect(result.parameters?.properties?.format).toEqual({
			type: "string",
			description: "Output format",
		})

		// Only required params should be in the required array
		expect(result.parameters?.required).toEqual(["input"])
	})

	it("should serialize a tool with various types", () => {
		const tool = defineCustomTool({
			name: "typed_tool",
			description: "Tool with various types",
			parameters: z.object({
				str: z.string().describe("A string"),
				num: z.number().describe("A number"),
				bool: z.boolean().describe("A boolean"),
				obj: z.object({}).describe("An object"),
				arr: z.array(z.string()).describe("An array"),
			}),
			async execute() {
				return "done"
			},
		})

		const result = serializeCustomTool(tool)

		expect(result.parameters?.properties?.str).toEqual({
			description: "A string",
			type: "string",
		})
		expect(result.parameters?.properties?.num).toEqual({
			description: "A number",
			type: "number",
		})
		expect(result.parameters?.properties?.bool).toEqual({
			description: "A boolean",
			type: "boolean",
		})
		expect(result.parameters?.properties?.obj).toEqual({
			additionalProperties: false,
			description: "An object",
			properties: {},
			type: "object",
		})
		expect(result.parameters?.properties?.arr).toEqual({
			description: "An array",
			items: { type: "string" },
			type: "array",
		})
	})

	it("should handle nullable parameters as optional", () => {
		const tool = defineCustomTool({
			name: "nullable_tool",
			description: "Tool with nullable param",
			parameters: z.object({
				value: z.string().nullable().describe("A nullable value"),
			}),
			async execute() {
				return "done"
			},
		})

		const result = serializeCustomTool(tool)

		expect(result.parameters?.required).toEqual(["value"])
	})

	it("should handle default values as optional", () => {
		const tool = defineCustomTool({
			name: "default_tool",
			description: "Tool with default param",
			parameters: z.object({
				count: z.number().default(10).describe("A count with default"),
			}),
			async execute() {
				return "done"
			},
		})

		const result = serializeCustomTool(tool)

		expect(result.parameters?.required).toEqual(["count"])
	})
})

describe("serializeCustomTools", () => {
	it("should return empty array for empty tools array", () => {
		expect(serializeCustomTools([])).toEqual([])
	})

	it("should serialize multiple tools", () => {
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

		const result = serializeCustomTools(tools)

		expect(result).toHaveLength(2)
		expect(result[0]?.name).toBe("tool_a")
		expect(result[1]?.name).toBe("tool_b")
		expect(result[1]?.parameters?.properties?.value).toBeDefined()
	})
})

describe("Serialization snapshots", () => {
	it("should correctly serialize simple tool", () => {
		const result = serializeCustomTool(fixtureTools.simple)
		expect(result).toMatchSnapshot()
	})

	it("should correctly serialize cached tool", () => {
		const result = serializeCustomTool(fixtureTools.cached)
		expect(result).toMatchSnapshot()
	})

	it("should correctly serialize legacy tool (using args)", () => {
		const result = serializeCustomTool(fixtureTools.legacy)
		expect(result).toMatchSnapshot()
	})

	it("should correctly serialize all fixtures", () => {
		const result = Object.values(fixtureTools).map(serializeCustomTool)
		expect(result).toMatchSnapshot()
	})
})
