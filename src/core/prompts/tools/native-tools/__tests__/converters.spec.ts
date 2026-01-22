import { describe, it, expect } from "vitest"
import type OpenAI from "openai"
import type Anthropic from "@anthropic-ai/sdk"
import {
	convertOpenAIToolToAnthropic,
	convertOpenAIToolsToAnthropic,
	convertOpenAIToolChoiceToAnthropic,
} from "../converters"

describe("converters", () => {
	describe("convertOpenAIToolToAnthropic", () => {
		it("should convert a simple OpenAI tool to Anthropic format", () => {
			const openAITool: OpenAI.Chat.ChatCompletionTool = {
				type: "function",
				function: {
					name: "get_weather",
					description: "Get the current weather in a location",
					parameters: {
						type: "object",
						properties: {
							location: {
								type: "string",
								description: "The city and state",
							},
						},
						required: ["location"],
					},
				},
			}

			const result = convertOpenAIToolToAnthropic(openAITool)

			expect(result).toEqual({
				name: "get_weather",
				description: "Get the current weather in a location",
				input_schema: {
					type: "object",
					properties: {
						location: {
							type: "string",
							description: "The city and state",
						},
					},
					required: ["location"],
				},
			})
		})

		it("should handle tools with empty description", () => {
			const openAITool: OpenAI.Chat.ChatCompletionTool = {
				type: "function",
				function: {
					name: "test_tool",
					parameters: {
						type: "object",
						properties: {},
					},
				},
			}

			const result = convertOpenAIToolToAnthropic(openAITool)

			expect(result.name).toBe("test_tool")
			expect(result.description).toBe("")
			expect(result.input_schema).toEqual({
				type: "object",
				properties: {},
			})
		})

		it("should throw error for non-function tool types", () => {
			const customTool = {
				type: "custom" as const,
			} as OpenAI.Chat.ChatCompletionTool

			expect(() => convertOpenAIToolToAnthropic(customTool)).toThrow("Unsupported tool type: custom")
		})

		it("should preserve complex parameter schemas", () => {
			const openAITool: OpenAI.Chat.ChatCompletionTool = {
				type: "function",
				function: {
					name: "read_file",
					description: "Read files",
					parameters: {
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
											items: { type: "string", pattern: "^[0-9]+-[0-9]+$" },
										},
									},
									required: ["path", "line_ranges"],
								},
							},
						},
						required: ["files"],
						additionalProperties: false,
					},
				},
			}

			const result = convertOpenAIToolToAnthropic(openAITool)

			expect(result.input_schema).toEqual(openAITool.function.parameters)
		})
	})

	describe("convertOpenAIToolsToAnthropic", () => {
		it("should convert multiple tools", () => {
			const openAITools: OpenAI.Chat.ChatCompletionTool[] = [
				{
					type: "function",
					function: {
						name: "tool1",
						description: "First tool",
						parameters: { type: "object", properties: {} },
					},
				},
				{
					type: "function",
					function: {
						name: "tool2",
						description: "Second tool",
						parameters: { type: "object", properties: {} },
					},
				},
			]

			const results = convertOpenAIToolsToAnthropic(openAITools)

			expect(results).toHaveLength(2)
			expect(results[0].name).toBe("tool1")
			expect(results[1].name).toBe("tool2")
		})

		it("should handle empty array", () => {
			const results = convertOpenAIToolsToAnthropic([])
			expect(results).toEqual([])
		})
	})

	describe("convertOpenAIToolChoiceToAnthropic", () => {
		it("should return auto with disabled parallel tool use when toolChoice is undefined", () => {
			const result = convertOpenAIToolChoiceToAnthropic(undefined)
			expect(result).toEqual({ type: "auto", disable_parallel_tool_use: true })
		})

		it("should return auto with enabled parallel tool use when parallelToolCalls is true", () => {
			const result = convertOpenAIToolChoiceToAnthropic(undefined, true)
			expect(result).toEqual({ type: "auto", disable_parallel_tool_use: false })
		})

		it("should return undefined for 'none' tool choice", () => {
			const result = convertOpenAIToolChoiceToAnthropic("none")
			expect(result).toBeUndefined()
		})

		it("should return auto for 'auto' tool choice", () => {
			const result = convertOpenAIToolChoiceToAnthropic("auto")
			expect(result).toEqual({ type: "auto", disable_parallel_tool_use: true })
		})

		it("should return any for 'required' tool choice", () => {
			const result = convertOpenAIToolChoiceToAnthropic("required")
			expect(result).toEqual({ type: "any", disable_parallel_tool_use: true })
		})

		it("should return auto for unknown string tool choice", () => {
			const result = convertOpenAIToolChoiceToAnthropic("unknown" as any)
			expect(result).toEqual({ type: "auto", disable_parallel_tool_use: true })
		})

		it("should convert function object form to tool type", () => {
			const result = convertOpenAIToolChoiceToAnthropic({
				type: "function",
				function: { name: "get_weather" },
			})
			expect(result).toEqual({
				type: "tool",
				name: "get_weather",
				disable_parallel_tool_use: true,
			})
		})

		it("should handle function object form with parallel tool calls enabled", () => {
			const result = convertOpenAIToolChoiceToAnthropic(
				{
					type: "function",
					function: { name: "read_file" },
				},
				true,
			)
			expect(result).toEqual({
				type: "tool",
				name: "read_file",
				disable_parallel_tool_use: false,
			})
		})

		it("should return auto for object without function property", () => {
			const result = convertOpenAIToolChoiceToAnthropic({ type: "something" } as any)
			expect(result).toEqual({ type: "auto", disable_parallel_tool_use: true })
		})
	})
})
