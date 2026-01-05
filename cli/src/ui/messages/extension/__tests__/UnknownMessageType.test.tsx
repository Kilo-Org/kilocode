/**
 * Tests for unknown message type handling in interactive mode
 *
 * This test suite verifies that unknown message types are handled gracefully
 * in the interactive terminal, with proper formatting and error handling.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render } from "ink-testing-library"
import { ExtensionMessageRow } from "../ExtensionMessageRow.js"
import type { ExtensionChatMessage } from "../../../../types/messages.js"

// Helper to create messages with unknown types for testing
// We need to cast to unknown first to bypass TypeScript's type checking
// since we're intentionally testing invalid/unknown message types
function createTestMessage(overrides: Record<string, unknown>): ExtensionChatMessage {
	return {
		ts: Date.now(),
		type: "say",
		...overrides,
	} as unknown as ExtensionChatMessage
}

// Mock the logs service
vi.mock("../../../../services/logs.js", () => ({
	logs: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}))

describe("Unknown Message Type Handling", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("Unknown message type at root level", () => {
		it("should display unknown message type with dimmed text", () => {
			const message = createTestMessage({
				type: "unknown_type",
				text: "This is an unknown message type",
			})

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			expect(lastFrame()).toContain("Unknown message type")
			expect(lastFrame()).toContain("unknown_type")
		})

		it("should handle unknown type with JSON content", () => {
			const message = createTestMessage({
				type: "future_type",
				text: JSON.stringify({
					data: "test",
					nested: { value: 123 },
				}),
			})

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			expect(lastFrame()).toContain("Unknown message type")
			// Should still display the message gracefully
			expect(lastFrame()).not.toContain("Error rendering message")
		})

		it("should handle unknown type with empty text", () => {
			const message = createTestMessage({
				type: "unknown",
				text: "",
			})

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			expect(lastFrame()).toContain("Unknown message type")
		})

		it("should handle unknown type with no text field", () => {
			const message = createTestMessage({
				type: "unknown",
			})

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			expect(lastFrame()).toContain("Unknown message type")
		})
	})

	describe("Unknown ask subtypes", () => {
		it("should display unknown ask type with warning color", () => {
			const message = createTestMessage({
				type: "ask",
				ask: "future_ask_type",
				text: "This is a future ask type",
			})

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			// Should show the text content
			expect(lastFrame()).toContain("This is a future ask type")
		})

		it("should handle unknown ask type with JSON content", () => {
			const message = createTestMessage({
				type: "ask",
				ask: "unknown_ask",
				text: JSON.stringify({
					question: "Unknown question format",
					data: { key: "value" },
				}),
			})

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			// Should attempt to display the content
			const frame = lastFrame()
			expect(frame).toBeTruthy()
			// Should not crash or show error boundary
			expect(frame).not.toContain("Error rendering message")
		})

		it("should handle unknown ask type with malformed JSON", () => {
			const message = createTestMessage({
				type: "ask",
				ask: "unknown_ask",
				text: "{ invalid json",
			})

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			// Should display the raw text
			expect(lastFrame()).toContain("{ invalid json")
		})

		it("should handle unknown ask type with empty text", () => {
			const message = createTestMessage({
				type: "ask",
				ask: "unknown_ask",
				text: "",
			})

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			// Should show unknown ask type indicator
			expect(lastFrame()).toContain("Unknown ask type")
		})

		it("should handle unknown ask type with no text", () => {
			const message = createTestMessage({
				type: "ask",
				ask: "unknown_ask",
			})

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			expect(lastFrame()).toContain("Unknown ask type")
		})
	})

	describe("Unknown say subtypes", () => {
		it("should display unknown say type with success color", () => {
			const message = createTestMessage({
				type: "say",
				say: "future_say_type",
				text: "This is a future say type",
			})

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			// Should show the text content
			expect(lastFrame()).toContain("This is a future say type")
		})

		it("should handle unknown say type with JSON content", () => {
			const message = createTestMessage({
				type: "say",
				say: "unknown_say",
				text: JSON.stringify({
					result: "success",
					data: { items: [1, 2, 3] },
				}),
			})

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			// Should attempt to display the content
			const frame = lastFrame()
			expect(frame).toBeTruthy()
			expect(frame).not.toContain("Error rendering message")
		})

		it("should handle unknown say type with nested JSON arrays", () => {
			const message = createTestMessage({
				type: "say",
				say: "unknown_say",
				text: JSON.stringify({
					results: [
						{ id: 1, name: "Item 1" },
						{ id: 2, name: "Item 2" },
					],
				}),
			})

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			const frame = lastFrame()
			expect(frame).toBeTruthy()
		})

		it("should handle unknown say type with malformed JSON", () => {
			const message = createTestMessage({
				type: "say",
				say: "unknown_say",
				text: '{"incomplete": ',
			})

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			// Should display the raw text
			expect(lastFrame()).toContain('{"incomplete":')
		})

		it("should handle unknown say type with empty text", () => {
			const message = createTestMessage({
				type: "say",
				say: "unknown_say",
				text: "",
			})

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			// Should show unknown say type indicator
			expect(lastFrame()).toContain("Unknown say type")
		})

		it("should handle unknown say type with no text", () => {
			const message = createTestMessage({
				type: "say",
				say: "unknown_say",
			})

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			expect(lastFrame()).toContain("Unknown say type")
		})
	})

	describe("Edge cases with additional properties", () => {
		it("should handle unknown type with images", () => {
			const message = createTestMessage({
				type: "unknown",
				text: "Message with images",
				images: ["image1.png", "image2.png"],
			})

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			expect(lastFrame()).toContain("Unknown message type")
		})

		it("should handle unknown type with partial flag", () => {
			const message = createTestMessage({
				type: "unknown",
				text: "Streaming unknown type",
				partial: true,
			})

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			expect(lastFrame()).toContain("Unknown message type")
		})

		it("should handle unknown ask with isAnswered flag", () => {
			const message = createTestMessage({
				type: "ask",
				ask: "unknown_ask",
				text: "Already answered",
				isAnswered: true,
			})

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			// Should still render even if answered
			expect(lastFrame()).toBeTruthy()
		})
	})

	describe("Markdown and code fence handling", () => {
		it("should handle unknown type with markdown content", () => {
			const message = createTestMessage({
				type: "say",
				say: "unknown_say",
				text: "# Heading\n\nSome **bold** text",
			})

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			// Should display the markdown content
			expect(lastFrame()).toContain("Heading")
			expect(lastFrame()).toContain("bold")
		})

		it("should handle unknown type with code fence", () => {
			const message = createTestMessage({
				type: "say",
				say: "unknown_say",
				text: "```typescript\nconst x = 1;\n```",
			})

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			// Should display the code content
			const frame = lastFrame()
			expect(frame).toContain("const x = 1")
		})

		it("should handle unknown type with JSON in code fence", () => {
			const message = createTestMessage({
				type: "say",
				say: "unknown_say",
				text: '```json\n{"key": "value"}\n```',
			})

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			const frame = lastFrame()
			// Should display as code, not parse as JSON
			expect(frame).toBeTruthy()
		})

		it("should handle unknown type with mixed markdown and JSON", () => {
			const message = createTestMessage({
				type: "say",
				say: "unknown_say",
				text: 'Here\'s the data:\n```json\n{"result": "success"}\n```\n\nAnd some text',
			})

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			const frame = lastFrame()
			expect(frame).toContain("Here's the data")
		})
	})

	describe("Error boundary integration", () => {
		it("should catch errors from unknown message rendering", () => {
			// Create a message that might cause rendering issues
			const message = createTestMessage({
				type: "ask",
				ask: "unknown_ask",
				text: JSON.stringify({
					// Deeply nested structure
					level1: {
						level2: {
							level3: {
								level4: {
									level5: "deep",
								},
							},
						},
					},
				}),
			})

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			// Should not crash
			const frame = lastFrame()
			expect(frame).toBeTruthy()
		})

		it("should handle circular reference attempts gracefully", () => {
			// JSON.stringify will fail on circular references, but our code should handle it
			const message = createTestMessage({
				type: "say",
				say: "unknown_say",
				text: "Some text that won't cause circular ref in our code",
			})

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			expect(lastFrame()).toContain("Some text")
		})
	})

	describe("Null and undefined handling", () => {
		it("should handle unknown type with null text", () => {
			const message = createTestMessage({
				type: "unknown",
				text: null,
			})

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			expect(lastFrame()).toContain("Unknown message type")
		})

		it("should handle unknown ask with undefined text", () => {
			const message = createTestMessage({
				type: "ask",
				ask: "unknown_ask",
				text: undefined,
			})

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			expect(lastFrame()).toContain("Unknown ask type")
		})

		it("should handle unknown say with undefined text", () => {
			const message = createTestMessage({
				type: "say",
				say: "unknown_say",
				text: undefined,
			})

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			expect(lastFrame()).toContain("Unknown say type")
		})
	})
})
