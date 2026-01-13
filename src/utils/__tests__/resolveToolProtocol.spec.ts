import { describe, it, expect } from "vitest"
import { resolveToolProtocol, detectToolProtocolFromHistory } from "../resolveToolProtocol"
import { TOOL_PROTOCOL, openAiModelInfoSaneDefaults } from "@roo-code/types"
import type { ProviderSettings, ModelInfo } from "@roo-code/types"
import type { Anthropic } from "@anthropic-ai/sdk"

describe("resolveToolProtocol", () => {
	/**
	 * XML Protocol Deprecation:
	 *
	 * XML tool protocol has been fully deprecated. All models now use Native
	 * tool calling. User preferences and model defaults are ignored.
	 *
	 * Precedence:
	 * 1. Locked Protocol (for resumed tasks that used XML)
	 * 2. Native (always, for all new tasks)
	 */

	describe("Locked Protocol (Precedence Level 0 - Highest Priority)", () => {
		it("should return lockedProtocol when provided", () => {
			const settings: ProviderSettings = {
				toolProtocol: "xml", // Ignored
				apiProvider: "openai-native",
			}
			// lockedProtocol overrides everything
			const result = resolveToolProtocol(settings, undefined, "native")
			expect(result).toBe(TOOL_PROTOCOL.NATIVE)
		})

		it("should return XML lockedProtocol for resumed tasks that used XML", () => {
			const settings: ProviderSettings = {
				toolProtocol: "native", // Ignored
				apiProvider: "anthropic",
			}
			// lockedProtocol forces XML for backward compatibility
			const result = resolveToolProtocol(settings, undefined, "xml")
			expect(result).toBe(TOOL_PROTOCOL.XML)
		})

		it("should fall through to Native when lockedProtocol is undefined", () => {
			const settings: ProviderSettings = {
				toolProtocol: "xml", // Ignored
				apiProvider: "anthropic",
			}
			// undefined lockedProtocol should return native
			const result = resolveToolProtocol(settings, undefined, undefined)
			expect(result).toBe(TOOL_PROTOCOL.NATIVE)
		})
	})

	describe("Native Protocol Always Used For New Tasks", () => {
		it("should always use native for new tasks", () => {
			const settings: ProviderSettings = {
				apiProvider: "anthropic",
			}
			const result = resolveToolProtocol(settings)
			expect(result).toBe(TOOL_PROTOCOL.NATIVE)
		})

		it("should use native even when user preference is XML (user prefs ignored)", () => {
			const settings: ProviderSettings = {
				toolProtocol: "xml", // User wants XML - ignored
				apiProvider: "openai-native",
			}
			const result = resolveToolProtocol(settings)
			expect(result).toBe(TOOL_PROTOCOL.NATIVE)
		})

		it("should use native for OpenAI compatible provider", () => {
			const settings: ProviderSettings = {
				apiProvider: "openai",
			}
			const result = resolveToolProtocol(settings, openAiModelInfoSaneDefaults)
			expect(result).toBe(TOOL_PROTOCOL.NATIVE)
		})
	})

	describe("Edge Cases", () => {
		it("should handle missing provider name gracefully", () => {
			const settings: ProviderSettings = {}
			const result = resolveToolProtocol(settings)
			expect(result).toBe(TOOL_PROTOCOL.NATIVE) // Always native now
		})

		it("should handle undefined model info gracefully", () => {
			const settings: ProviderSettings = {
				apiProvider: "openai-native",
			}
			const result = resolveToolProtocol(settings, undefined)
			expect(result).toBe(TOOL_PROTOCOL.NATIVE) // Always native now
		})

		it("should handle empty settings", () => {
			const settings: ProviderSettings = {}
			const result = resolveToolProtocol(settings)
			expect(result).toBe(TOOL_PROTOCOL.NATIVE) // Always native now
		})
	})

	describe("Real-world Scenarios", () => {
		it("should use Native for OpenAI models", () => {
			const settings: ProviderSettings = {
				apiProvider: "openai-native",
			}
			const modelInfo: ModelInfo = {
				maxTokens: 4096,
				contextWindow: 128000,
				supportsPromptCache: false,
				supportsNativeTools: true,
			}
			const result = resolveToolProtocol(settings, modelInfo)
			expect(result).toBe(TOOL_PROTOCOL.NATIVE)
		})

		it("should use Native for Claude models", () => {
			const settings: ProviderSettings = {
				apiProvider: "anthropic",
			}
			const modelInfo: ModelInfo = {
				maxTokens: 8192,
				contextWindow: 200000,
				supportsPromptCache: true,
				supportsNativeTools: true,
			}
			const result = resolveToolProtocol(settings, modelInfo)
			expect(result).toBe(TOOL_PROTOCOL.NATIVE)
		})

		it("should honor locked protocol for resumed tasks that used XML", () => {
			const settings: ProviderSettings = {
				apiProvider: "anthropic",
			}
			// Task was started when XML was used, so it's locked to XML
			const result = resolveToolProtocol(settings, undefined, "xml")
			expect(result).toBe(TOOL_PROTOCOL.XML)
		})
	})

	describe("Backward Compatibility - User Preferences Ignored", () => {
		it("should ignore user preference for XML", () => {
			const settings: ProviderSettings = {
				toolProtocol: "xml", // User explicitly wants XML - ignored
				apiProvider: "openai-native",
			}
			const result = resolveToolProtocol(settings)
			expect(result).toBe(TOOL_PROTOCOL.NATIVE) // Native is always used
		})

		it("should return native regardless of user preference", () => {
			const settings: ProviderSettings = {
				toolProtocol: "native", // User preference - ignored but happens to match
				apiProvider: "anthropic",
			}
			const result = resolveToolProtocol(settings)
			expect(result).toBe(TOOL_PROTOCOL.NATIVE)
		})
	})
})

describe("detectToolProtocolFromHistory", () => {
	// Helper type for API messages in tests
	type ApiMessageForTest = Anthropic.MessageParam & { ts?: number }

	describe("Native Protocol Detection", () => {
		it("should detect native protocol when tool_use block has an id", () => {
			const messages: ApiMessageForTest[] = [
				{ role: "user", content: "Hello" },
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_01abc123", // Native protocol always has an ID
							name: "read_file",
							input: { path: "test.ts" },
						},
					],
				},
			]
			const result = detectToolProtocolFromHistory(messages)
			expect(result).toBe(TOOL_PROTOCOL.NATIVE)
		})

		it("should detect native protocol from the first tool_use block found", () => {
			const messages: ApiMessageForTest[] = [
				{ role: "user", content: "First message" },
				{ role: "assistant", content: "Let me help you" },
				{ role: "user", content: "Second message" },
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_first",
							name: "read_file",
							input: { path: "first.ts" },
						},
					],
				},
				{ role: "user", content: "Third message" },
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_second",
							name: "write_to_file",
							input: { path: "second.ts", content: "test" },
						},
					],
				},
			]
			const result = detectToolProtocolFromHistory(messages)
			expect(result).toBe(TOOL_PROTOCOL.NATIVE)
		})
	})

	describe("XML Protocol Detection", () => {
		it("should detect XML protocol when tool_use block has no id", () => {
			const messages: ApiMessageForTest[] = [
				{ role: "user", content: "Hello" },
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							// No id field - XML protocol tool calls never have an ID
							name: "read_file",
							input: { path: "test.ts" },
						} as Anthropic.ToolUseBlock, // Cast to bypass type check for missing id
					],
				},
			]
			const result = detectToolProtocolFromHistory(messages)
			expect(result).toBe(TOOL_PROTOCOL.XML)
		})

		it("should detect XML protocol when id is empty string", () => {
			const messages: ApiMessageForTest[] = [
				{ role: "user", content: "Hello" },
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "", // Empty string should be treated as no id
							name: "read_file",
							input: { path: "test.ts" },
						},
					],
				},
			]
			const result = detectToolProtocolFromHistory(messages)
			expect(result).toBe(TOOL_PROTOCOL.XML)
		})
	})

	describe("No Tool Calls", () => {
		it("should return undefined when no messages", () => {
			const messages: ApiMessageForTest[] = []
			const result = detectToolProtocolFromHistory(messages)
			expect(result).toBeUndefined()
		})

		it("should return undefined when only user messages", () => {
			const messages: ApiMessageForTest[] = [
				{ role: "user", content: "Hello" },
				{ role: "user", content: "How are you?" },
			]
			const result = detectToolProtocolFromHistory(messages)
			expect(result).toBeUndefined()
		})

		it("should return undefined when assistant messages have no tool_use", () => {
			const messages: ApiMessageForTest[] = [
				{ role: "user", content: "Hello" },
				{ role: "assistant", content: "Hi! How can I help?" },
				{ role: "user", content: "What's the weather?" },
				{
					role: "assistant",
					content: [{ type: "text", text: "I don't have access to weather data." }],
				},
			]
			const result = detectToolProtocolFromHistory(messages)
			expect(result).toBeUndefined()
		})

		it("should return undefined when content is string", () => {
			const messages: ApiMessageForTest[] = [
				{ role: "user", content: "Hello" },
				{ role: "assistant", content: "Hi there!" },
			]
			const result = detectToolProtocolFromHistory(messages)
			expect(result).toBeUndefined()
		})
	})

	describe("Mixed Content", () => {
		it("should detect protocol from tool_use even with mixed content", () => {
			const messages: ApiMessageForTest[] = [
				{ role: "user", content: "Read this file" },
				{
					role: "assistant",
					content: [
						{ type: "text", text: "I'll read that file for you." },
						{
							type: "tool_use",
							id: "toolu_mixed",
							name: "read_file",
							input: { path: "test.ts" },
						},
					],
				},
			]
			const result = detectToolProtocolFromHistory(messages)
			expect(result).toBe(TOOL_PROTOCOL.NATIVE)
		})

		it("should skip user messages and only check assistant messages", () => {
			const messages: ApiMessageForTest[] = [
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "toolu_user",
							content: "result",
						},
					],
				},
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_assistant",
							name: "write_to_file",
							input: { path: "out.ts", content: "test" },
						},
					],
				},
			]
			const result = detectToolProtocolFromHistory(messages)
			expect(result).toBe(TOOL_PROTOCOL.NATIVE)
		})
	})

	describe("Edge Cases", () => {
		it("should handle messages with empty content array", () => {
			const messages: ApiMessageForTest[] = [
				{ role: "user", content: "Hello" },
				{ role: "assistant", content: [] },
			]
			const result = detectToolProtocolFromHistory(messages)
			expect(result).toBeUndefined()
		})

		it("should handle messages with ts field (ApiMessage format)", () => {
			const messages: ApiMessageForTest[] = [
				{ role: "user", content: "Hello", ts: Date.now() },
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_with_ts",
							name: "read_file",
							input: { path: "test.ts" },
						},
					],
					ts: Date.now(),
				},
			]
			const result = detectToolProtocolFromHistory(messages)
			expect(result).toBe(TOOL_PROTOCOL.NATIVE)
		})
	})
})
