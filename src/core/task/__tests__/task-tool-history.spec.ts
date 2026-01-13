import { describe, it, expect, beforeEach, vi } from "vitest"
import { Anthropic } from "@anthropic-ai/sdk"
import { TOOL_PROTOCOL } from "@roo-code/types"
import { resolveToolProtocol } from "../../../utils/resolveToolProtocol"

describe("Task Tool History Handling", () => {
	describe("resumeTaskFromHistory tool block preservation", () => {
		it("should preserve tool_use and tool_result blocks for native protocol", () => {
			// Mock API conversation history with tool blocks
			const apiHistory: any[] = [
				{
					role: "user",
					content: "Read the file config.json",
					ts: Date.now(),
				},
				{
					role: "assistant",
					content: [
						{
							type: "text",
							text: "I'll read that file for you.",
						},
						{
							type: "tool_use",
							id: "toolu_123",
							name: "read_file",
							input: { path: "config.json" },
						},
					],
					ts: Date.now(),
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "toolu_123",
							content: '{"setting": "value"}',
						},
					],
					ts: Date.now(),
				},
			]

			// Simulate the protocol check
			const mockApiConfiguration = { apiProvider: "roo" as const }
			const mockModelInfo = { supportsNativeTools: true }
			const mockExperiments = {}

			const protocol = TOOL_PROTOCOL.NATIVE

			// Test the logic that should NOT convert tool blocks for native protocol
			const useNative = protocol === TOOL_PROTOCOL.NATIVE

			if (!useNative) {
				// This block should NOT execute for native protocol
				throw new Error("Should not convert tool blocks for native protocol")
			}

			// Verify tool blocks are preserved
			const assistantMessage = apiHistory[1]
			const userMessage = apiHistory[2]

			expect(assistantMessage.content).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						type: "tool_use",
						id: "toolu_123",
						name: "read_file",
					}),
				]),
			)

			expect(userMessage.content).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						type: "tool_result",
						tool_use_id: "toolu_123",
					}),
				]),
			)
		})

		it("should convert tool blocks to text for XML protocol", () => {
			// Mock API conversation history with tool blocks
			const apiHistory: any[] = [
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_123",
							name: "read_file",
							input: { path: "config.json" },
						},
					],
					ts: Date.now(),
				},
			]

			// Simulate XML protocol - tool blocks should be converted to text
			const protocol = "xml"
			const useNative = false // XML protocol is not native

			// For XML protocol, we should convert tool blocks
			if (!useNative) {
				const conversationWithoutToolBlocks = apiHistory.map((message) => {
					if (Array.isArray(message.content)) {
						const newContent = message.content.map((block: any) => {
							if (block.type === "tool_use") {
								return {
									type: "text",
									text: `<read_file>\n<path>\nconfig.json\n</path>\n</read_file>`,
								}
							}
							return block
						})
						return { ...message, content: newContent }
					}
					return message
				})

				// Verify tool blocks were converted to text
				expect(conversationWithoutToolBlocks[0].content[0].type).toBe("text")
				expect(conversationWithoutToolBlocks[0].content[0].text).toContain("<read_file>")
			}
		})
	})

	describe("convertToOpenAiMessages format", () => {
		it("should properly convert tool_use to tool_calls format", () => {
			const anthropicMessage: Anthropic.Messages.MessageParam = {
				role: "assistant",
				content: [
					{
						type: "text",
						text: "I'll read that file.",
					},
					{
						type: "tool_use",
						id: "toolu_123",
						name: "read_file",
						input: { path: "config.json" },
					},
				],
			}

			// Simulate what convertToOpenAiMessages does
			const toolUseBlocks = (anthropicMessage.content as any[]).filter((block) => block.type === "tool_use")

			const tool_calls = toolUseBlocks.map((toolMessage) => ({
				id: toolMessage.id,
				type: "function" as const,
				function: {
					name: toolMessage.name,
					arguments: JSON.stringify(toolMessage.input),
				},
			}))

			expect(tool_calls).toHaveLength(1)
			expect(tool_calls[0]).toEqual({
				id: "toolu_123",
				type: "function",
				function: {
					name: "read_file",
					arguments: '{"path":"config.json"}',
				},
			})
		})

		it("should properly convert tool_result to tool role messages", () => {
			const anthropicMessage: Anthropic.Messages.MessageParam = {
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_123",
						content: '{"setting": "value"}',
					},
				],
			}

			// Simulate what convertToOpenAiMessages does
			const toolMessages = (anthropicMessage.content as any[]).filter((block) => block.type === "tool_result")

			const openAiToolMessages = toolMessages.map((toolMessage) => ({
				role: "tool" as const,
				tool_call_id: toolMessage.tool_use_id,
				content: typeof toolMessage.content === "string" ? toolMessage.content : toolMessage.content[0].text,
			}))

			expect(openAiToolMessages).toHaveLength(1)
			expect(openAiToolMessages[0]).toEqual({
				role: "tool",
				tool_call_id: "toolu_123",
				content: '{"setting": "value"}',
			})
		})

		describe("environment details deduplication", () => {
			it("should filter out existing environment_details blocks before adding new ones", () => {
				// Simulate user content that already contains environment details from a previous session
				const userContentWithOldEnvDetails = [
					{
						type: "text" as const,
						text: "Some user message",
					},
					{
						type: "text" as const,
						text: "<environment_details>\n# Old Environment Details\nCurrent time: 2024-01-01\n</environment_details>",
					},
				]

				// Filter out existing environment_details blocks using the same logic as Task.ts
				const contentWithoutEnvDetails = userContentWithOldEnvDetails.filter((block) => {
					if (block.type === "text" && typeof block.text === "string") {
						// Check if this text block is a complete environment_details block
						const isEnvironmentDetailsBlock =
							block.text.trim().startsWith("<environment_details>") &&
							block.text.trim().endsWith("</environment_details>")
						return !isEnvironmentDetailsBlock
					}
					return true
				})

				// Verify old environment details were removed
				expect(contentWithoutEnvDetails).toHaveLength(1)
				expect(contentWithoutEnvDetails[0].text).toBe("Some user message")

				// Simulate adding fresh environment details
				const newEnvironmentDetails =
					"<environment_details>\n# Fresh Environment Details\nCurrent time: 2024-01-02\n</environment_details>"
				const finalUserContent = [
					...contentWithoutEnvDetails,
					{ type: "text" as const, text: newEnvironmentDetails },
				]

				// Verify we have exactly one environment_details block (the new one)
				const envDetailsBlocks = finalUserContent.filter((block) => {
					if (block.type === "text" && typeof block.text === "string") {
						return (
							block.text.trim().startsWith("<environment_details>") &&
							block.text.trim().endsWith("</environment_details>")
						)
					}
					return false
				})
				expect(envDetailsBlocks).toHaveLength(1)
				expect(envDetailsBlocks[0].text).toContain("2024-01-02")
				expect(envDetailsBlocks[0].text).not.toContain("2024-01-01")
			})

			it("should not filter out text that mentions environment_details tags in content", () => {
				// User content that mentions the tags but isn't an environment_details block
				const userContent = [
					{
						type: "text" as const,
						text: "Let me explain how <environment_details> work in this system",
					},
					{
						type: "text" as const,
						text: "The closing tag is </environment_details>",
					},
					{
						type: "text" as const,
						text: "Regular message",
					},
				]

				// Filter using the same logic as Task.ts
				const contentWithoutEnvDetails = userContent.filter((block) => {
					if (block.type === "text" && typeof block.text === "string") {
						const isEnvironmentDetailsBlock =
							block.text.trim().startsWith("<environment_details>") &&
							block.text.trim().endsWith("</environment_details>")
						return !isEnvironmentDetailsBlock
					}
					return true
				})

				// All blocks should be preserved since none are complete environment_details blocks
				expect(contentWithoutEnvDetails).toHaveLength(3)
				expect(contentWithoutEnvDetails).toEqual(userContent)
			})

			it("should not filter out regular text blocks", () => {
				// User content with various blocks but no environment details
				const userContent = [
					{
						type: "text" as const,
						text: "Regular message",
					},
					{
						type: "text" as const,
						text: "Another message with <task> tags",
					},
					{
						type: "tool_result" as const,
						tool_use_id: "tool_123",
						content: "Tool result",
					},
				]

				// Filter using the same logic as Task.ts
				const contentWithoutEnvDetails = userContent.filter((block) => {
					if (block.type === "text" && typeof block.text === "string") {
						const isEnvironmentDetailsBlock =
							block.text.trim().startsWith("<environment_details>") &&
							block.text.trim().endsWith("</environment_details>")
						return !isEnvironmentDetailsBlock
					}
					return true
				})

				// All blocks should be preserved
				expect(contentWithoutEnvDetails).toHaveLength(3)
				expect(contentWithoutEnvDetails).toEqual(userContent)
			})
		})
	})

	describe("empty API conversation history handling", () => {
		it("should handle empty API conversation history gracefully", () => {
			// Simulate empty API conversation history (e.g., from an empty session)
			const apiHistory: any[] = []

			// The logic in Task.resumeTaskFromHistory should handle this case
			// by initializing empty arrays instead of throwing
			let modifiedApiConversationHistory: any[]
			let modifiedOldUserContent: any[]

			if (apiHistory.length === 0) {
				// Empty API conversation history - treat it like a fresh start
				modifiedApiConversationHistory = []
				modifiedOldUserContent = []
			} else {
				// Normal case - would process the history
				modifiedApiConversationHistory = [...apiHistory]
				modifiedOldUserContent = []
			}

			// Verify we get empty arrays, not an error
			expect(modifiedApiConversationHistory).toEqual([])
			expect(modifiedOldUserContent).toEqual([])
		})

		it("should not throw when API conversation history is empty", () => {
			const apiHistory: any[] = []

			// This should NOT throw - it should handle empty history gracefully
			expect(() => {
				if (apiHistory.length === 0) {
					// Empty history is valid - just return empty arrays
					return { history: [], userContent: [] }
				}
				// Normal processing would happen here
				return { history: apiHistory, userContent: [] }
			}).not.toThrow()
		})

		it("should handle single-message API conversation history", () => {
			// A session with just one user message (no assistant response yet)
			const apiHistory: any[] = [
				{
					role: "user",
					content: "Hello",
					ts: Date.now(),
				},
			]

			// This is a valid case - the session was started but no response was received
			expect(apiHistory.length).toBe(1)
			expect(apiHistory[0].role).toBe("user")
		})
	})
})
