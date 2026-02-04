// npx vitest run src/api/transform/__tests__/gemini-format.spec.ts

import { Anthropic } from "@anthropic-ai/sdk"

import { convertAnthropicMessageToGemini } from "../gemini-format"

describe("convertAnthropicMessageToGemini", () => {
	it("should convert a simple text message", () => {
		const anthropicMessage: Anthropic.Messages.MessageParam = {
			role: "user",
			content: "Hello, world!",
		}

		const result = convertAnthropicMessageToGemini(anthropicMessage)

		expect(result).toEqual([
			{
				role: "user",
				parts: [{ text: "Hello, world!" }],
			},
		])
	})

	it("should convert assistant role to model role", () => {
		const anthropicMessage: Anthropic.Messages.MessageParam = {
			role: "assistant",
			content: "I'm an assistant",
		}

		const result = convertAnthropicMessageToGemini(anthropicMessage)

		expect(result).toEqual([
			{
				role: "model",
				parts: [{ text: "I'm an assistant" }],
			},
		])
	})

	it("should convert a message with text blocks", () => {
		const anthropicMessage: Anthropic.Messages.MessageParam = {
			role: "user",
			content: [
				{ type: "text", text: "First paragraph" },
				{ type: "text", text: "Second paragraph" },
			],
		}

		const result = convertAnthropicMessageToGemini(anthropicMessage)

		expect(result).toEqual([
			{
				role: "user",
				parts: [{ text: "First paragraph" }, { text: "Second paragraph" }],
			},
		])
	})

	it("should convert a message with an image", () => {
		const anthropicMessage: Anthropic.Messages.MessageParam = {
			role: "user",
			content: [
				{ type: "text", text: "Check out this image:" },
				{
					type: "image",
					source: {
						type: "base64",
						media_type: "image/jpeg",
						data: "base64encodeddata",
					},
				},
			],
		}

		const result = convertAnthropicMessageToGemini(anthropicMessage)

		expect(result).toEqual([
			{
				role: "user",
				parts: [
					{ text: "Check out this image:" },
					{
						inlineData: {
							data: "base64encodeddata",
							mimeType: "image/jpeg",
						},
					},
				],
			},
		])
	})

	it("should throw an error for unsupported image source type", () => {
		const anthropicMessage: Anthropic.Messages.MessageParam = {
			role: "user",
			content: [
				{
					type: "image",
					source: {
						type: "url", // Not supported
						url: "https://example.com/image.jpg",
					} as any,
				},
			],
		}

		expect(() => convertAnthropicMessageToGemini(anthropicMessage)).toThrow("Unsupported image source type")
	})

	it("should convert a message with tool use", () => {
		const anthropicMessage: Anthropic.Messages.MessageParam = {
			role: "assistant",
			content: [
				{ type: "text", text: "Let me calculate that for you." },
				{
					type: "tool_use",
					id: "calc-123",
					name: "calculator",
					input: { operation: "add", numbers: [2, 3] },
				},
			],
		}

		const result = convertAnthropicMessageToGemini(anthropicMessage)

		expect(result).toEqual([
			{
				role: "model",
				parts: [
					{ text: "Let me calculate that for you." },
					{
						functionCall: {
							name: "calculator",
							args: { operation: "add", numbers: [2, 3] },
						},
						thoughtSignature: "skip_thought_signature_validator",
					},
				],
			},
		])
	})

	it("should only attach thoughtSignature to the first functionCall in the message", () => {
		const anthropicMessage: Anthropic.Messages.MessageParam = {
			role: "assistant",
			content: [
				{ type: "thoughtSignature", thoughtSignature: "sig-123" } as any,
				{ type: "tool_use", id: "call-1", name: "toolA", input: { a: 1 } },
				{ type: "tool_use", id: "call-2", name: "toolB", input: { b: 2 } },
			],
		}

		const result = convertAnthropicMessageToGemini(anthropicMessage)
		expect(result).toHaveLength(1)

		const parts = result[0]!.parts as any[]
		const functionCallParts = parts.filter((p) => p.functionCall)
		expect(functionCallParts).toHaveLength(2)

		expect(functionCallParts[0].thoughtSignature).toBe("sig-123")
		expect(functionCallParts[1].thoughtSignature).toBeUndefined()
	})

	it("should convert a message with tool result as string", () => {
		const toolIdToName = new Map<string, string>()
		toolIdToName.set("calculator-123", "calculator")

		const anthropicMessage: Anthropic.Messages.MessageParam = {
			role: "user",
			content: [
				{ type: "text", text: "Here's the result:" },
				{
					type: "tool_result",
					tool_use_id: "calculator-123",
					content: "The result is 5",
				},
			],
		}

		const result = convertAnthropicMessageToGemini(anthropicMessage, { toolIdToName })

		expect(result).toEqual([
			{
				role: "user",
				parts: [
					{ text: "Here's the result:" },
					{
						functionResponse: {
							name: "calculator",
							response: {
								name: "calculator",
								content: "The result is 5",
							},
						},
					},
				],
			},
		])
	})

	it("should handle empty tool result content", () => {
		const anthropicMessage: Anthropic.Messages.MessageParam = {
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: "calculator-123",
					content: null as any, // Empty content
				},
			],
		}

		const result = convertAnthropicMessageToGemini(anthropicMessage)

		// Should skip the empty tool result
		expect(result).toEqual([])
	})

	it("should convert a message with tool result as array with text only", () => {
		const toolIdToName = new Map<string, string>()
		toolIdToName.set("search-123", "search")

		const anthropicMessage: Anthropic.Messages.MessageParam = {
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: "search-123",
					content: [
						{ type: "text", text: "First result" },
						{ type: "text", text: "Second result" },
					],
				},
			],
		}

		const result = convertAnthropicMessageToGemini(anthropicMessage, { toolIdToName })

		expect(result).toEqual([
			{
				role: "user",
				parts: [
					{
						functionResponse: {
							name: "search",
							response: {
								name: "search",
								content: "First result\n\nSecond result",
							},
						},
					},
				],
			},
		])
	})

	it("should convert a message with tool result as array with text and images", () => {
		const toolIdToName = new Map<string, string>()
		toolIdToName.set("search-123", "search")

		const anthropicMessage: Anthropic.Messages.MessageParam = {
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: "search-123",
					content: [
						{ type: "text", text: "Search results:" },
						{
							type: "image",
							source: {
								type: "base64",
								media_type: "image/png",
								data: "image1data",
							},
						},
						{
							type: "image",
							source: {
								type: "base64",
								media_type: "image/jpeg",
								data: "image2data",
							},
						},
					],
				},
			],
		}

		const result = convertAnthropicMessageToGemini(anthropicMessage, { toolIdToName })

		expect(result).toEqual([
			{
				role: "user",
				parts: [
					{
						functionResponse: {
							name: "search",
							response: {
								name: "search",
								content: "Search results:\n\n(See next part for image)",
							},
						},
					},
					{
						inlineData: {
							data: "image1data",
							mimeType: "image/png",
						},
					},
					{
						inlineData: {
							data: "image2data",
							mimeType: "image/jpeg",
						},
					},
				],
			},
		])
	})

	it("should convert a message with tool result containing only images", () => {
		const toolIdToName = new Map<string, string>()
		toolIdToName.set("imagesearch-123", "imagesearch")

		const anthropicMessage: Anthropic.Messages.MessageParam = {
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: "imagesearch-123",
					content: [
						{
							type: "image",
							source: {
								type: "base64",
								media_type: "image/png",
								data: "onlyimagedata",
							},
						},
					],
				},
			],
		}

		const result = convertAnthropicMessageToGemini(anthropicMessage, { toolIdToName })

		expect(result).toEqual([
			{
				role: "user",
				parts: [
					{
						functionResponse: {
							name: "imagesearch",
							response: {
								name: "imagesearch",
								content: "\n\n(See next part for image)",
							},
						},
					},
					{
						inlineData: {
							data: "onlyimagedata",
							mimeType: "image/png",
						},
					},
				],
			},
		])
	})

	it("should handle tool names with hyphens using toolIdToName map", () => {
		const toolIdToName = new Map<string, string>()
		toolIdToName.set("search-files-123", "search-files")

		const anthropicMessage: Anthropic.Messages.MessageParam = {
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: "search-files-123",
					content: "found files",
				},
			],
		}

		const result = convertAnthropicMessageToGemini(anthropicMessage, { toolIdToName })

		expect(result).toEqual([
			{
				role: "user",
				parts: [
					{
						functionResponse: {
							name: "search-files",
							response: {
								name: "search-files",
								content: "found files",
							},
						},
					},
				],
			},
		])
	})

	it("should throw error when toolIdToName map is not provided", () => {
		const anthropicMessage: Anthropic.Messages.MessageParam = {
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: "calculator-123",
					content: "result is 5",
				},
			],
		}

		expect(() => convertAnthropicMessageToGemini(anthropicMessage)).toThrow(
			'Unable to find tool name for tool_use_id "calculator-123"',
		)
	})

	it("should throw error when tool_use_id is not in the map", () => {
		const toolIdToName = new Map<string, string>()
		toolIdToName.set("other-tool-456", "other-tool")

		const anthropicMessage: Anthropic.Messages.MessageParam = {
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: "calculator-123",
					content: "result is 5",
				},
			],
		}

		expect(() => convertAnthropicMessageToGemini(anthropicMessage, { toolIdToName })).toThrow(
			'Unable to find tool name for tool_use_id "calculator-123"',
		)
	})

	it("should skip unsupported content block types", () => {
		const anthropicMessage: Anthropic.Messages.MessageParam = {
			role: "user",
			content: [
				{
					type: "unknown_type", // Unsupported type
					data: "some data",
				} as any,
				{ type: "text", text: "Valid content" },
			],
		}

		const result = convertAnthropicMessageToGemini(anthropicMessage)

		expect(result).toEqual([
			{
				role: "user",
				parts: [{ text: "Valid content" }],
			},
		])
	})

	it("should skip reasoning content blocks", () => {
		const anthropicMessage: Anthropic.Messages.MessageParam = {
			role: "assistant",
			content: [
				{
					type: "reasoning" as any,
					text: "Let me think about this...",
				},
				{ type: "text", text: "Here's my answer" },
			],
		}

		const result = convertAnthropicMessageToGemini(anthropicMessage)

		expect(result).toEqual([
			{
				role: "model",
				parts: [{ text: "Here's my answer" }],
			},
		])
	})
})
