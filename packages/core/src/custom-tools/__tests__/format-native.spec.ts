// pnpm --filter @roo-code/core test src/custom-tools/__tests__/format-native.spec.ts

import { type SerializedCustomToolDefinition, parametersSchema as z, defineCustomTool } from "@roo-code/types"

import { serializeCustomTool, serializeCustomTools } from "../serialize.js"
import { formatNative } from "../format-native.js"

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

describe("formatNative", () => {
	it("should convert a tool without args", () => {
		const tool = defineCustomTool({
			name: "simple_tool",
			description: "A simple tool",
			async execute() {
				return "done"
			},
		})

		const serialized = serializeCustomTool(tool)
		const result = formatNative(serialized)

		expect(result).toEqual({
			type: "function",
			function: {
				name: "simple_tool",
				description: "A simple tool",
				parameters: undefined,
				strict: true,
			},
		})
	})

	it("should convert a tool with required args", () => {
		const tool = defineCustomTool({
			name: "greeter",
			description: "Greets a person",
			parameters: z.object({
				name: z.string().describe("Person's name"),
			}),
			async execute({ name }) {
				return `Hello, ${name}!`
			},
		})

		const serialized = serializeCustomTool(tool)
		const result = formatNative(serialized)

		expect(result.type).toBe("function")
		expect(result.function.name).toBe("greeter")
		expect(result.function.description).toBe("Greets a person")
		expect(result.function.parameters?.properties).toEqual({
			name: {
				type: "string",
				description: "Person's name",
			},
		})
		expect(result.function.parameters?.required).toEqual(["name"])
		expect(result.function.parameters?.additionalProperties).toBe(false)
	})

	it("should convert a tool with optional args", () => {
		const tool = defineCustomTool({
			name: "optional_tool",
			description: "Tool with optional args",
			parameters: z.object({
				format: z.string().optional().describe("Output format"),
			}),
			async execute() {
				return "done"
			},
		})

		const serialized = serializeCustomTool(tool)
		const result = formatNative(serialized)

		expect(result.function.parameters?.required).toEqual([])
		expect(result.function.parameters?.properties).toEqual({
			format: {
				type: "string",
				description: "Output format",
			},
		})
	})

	it("should convert a tool with mixed required and optional args", () => {
		const tool = defineCustomTool({
			name: "mixed_tool",
			description: "Tool with mixed args",
			parameters: z.object({
				input: z.string().describe("Required input"),
				options: z.object({}).optional().describe("Optional config"),
				count: z.number().describe("Also required"),
			}),
			async execute() {
				return "done"
			},
		})

		const serialized = serializeCustomTool(tool)
		const result = formatNative(serialized)

		expect(result.function.parameters?.required).toEqual(["input", "count"])
		expect(result.function.parameters?.properties).toEqual({
			input: {
				type: "string",
				description: "Required input",
			},
			options: {
				additionalProperties: false,
				properties: {},
				type: "object",
				description: "Optional config",
			},
			count: {
				type: "number",
				description: "Also required",
			},
		})
	})

	it("should map type strings to JSON Schema types", () => {
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

		const serialized = serializeCustomTool(tool)
		const result = formatNative(serialized)
		const props = result.function.parameters?.properties as
			| Record<string, { type: string; description?: string }>
			| undefined

		expect(props?.str?.type).toBe("string")
		expect(props?.num?.type).toBe("number")
		expect(props?.bool?.type).toBe("boolean")
		expect(props?.obj?.type).toBe("object")
		expect(props?.arr?.type).toBe("array")
	})

	it("should pass through raw parameters as-is", () => {
		// formatNative is a simple wrapper that passes through parameters unchanged
		const serialized = {
			name: "test_tool",
			description: "Tool with specific type",
			parameters: {
				type: "object",
				properties: {
					data: { type: "integer", description: "Integer type" },
				},
			},
		} as SerializedCustomToolDefinition

		const result = formatNative(serialized)

		expect(result.type).toBe("function")
		expect(result.function.name).toBe("test_tool")
		const props = result.function.parameters?.properties as Record<string, { type: string }> | undefined
		expect(props?.data?.type).toBe("integer")
	})

	it("should convert multiple tools", () => {
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
				async execute() {
					return "b"
				},
			}),
		]

		const serialized = serializeCustomTools(tools)
		const result = serialized.map(formatNative)

		expect(result).toHaveLength(2)
		expect(result[0]?.function.name).toBe("tool_a")
		expect(result[1]?.function.name).toBe("tool_b")
		expect(result.every((t) => t.type === "function")).toBe(true)
	})
})

describe("Native Protocol snapshots", () => {
	it("should generate correct native definition for simple tool", () => {
		const serialized = serializeCustomTool(fixtureTools.simple)
		const result = formatNative(serialized)
		expect(result).toMatchSnapshot()
	})

	it("should generate correct native definition for cached tool", () => {
		const serialized = serializeCustomTool(fixtureTools.cached)
		const result = formatNative(serialized)
		expect(result).toMatchSnapshot()
	})

	it("should generate correct native definition for legacy tool (using args)", () => {
		const serialized = serializeCustomTool(fixtureTools.legacy)
		const result = formatNative(serialized)
		expect(result).toMatchSnapshot()
	})

	it("should generate correct native definitions for multi export tools", () => {
		const serializedA = serializeCustomTool(fixtureTools.multi_toolA)
		const serializedB = serializeCustomTool(fixtureTools.multi_toolB)
		const result = [serializedA, serializedB].map(formatNative)
		expect(result).toMatchSnapshot()
	})

	it("should generate correct native definition for mixed export tool", () => {
		const serialized = serializeCustomTool(fixtureTools.mixed_validTool)
		const result = formatNative(serialized)
		expect(result).toMatchSnapshot()
	})

	it("should generate correct native definitions for all fixtures combined", () => {
		const allSerialized = Object.values(fixtureTools).map(serializeCustomTool)
		const result = allSerialized.map(formatNative)
		expect(result).toMatchSnapshot()
	})
})
