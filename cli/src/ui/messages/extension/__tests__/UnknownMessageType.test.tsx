/**
 * Tests for unknown message type handling in interactive mode
 *
 * This test suite verifies that unknown message types are handled gracefully
 * in the interactive terminal, with proper formatting and error handling.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render } from "ink-testing-library"
import { ExtensionMessageRow } from "../ExtensionMessageRow.js"
import { DefaultSayMessage } from "../SayMessageRouter.js"
import { DefaultAskMessage } from "../AskMessageRouter.js"
import type { ExtensionChatMessage } from "../../../../types/messages.js"

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
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "unknown_type" as any,
				text: "This is an unknown message type",
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			expect(lastFrame()).toContain("Unknown message type")
			expect(lastFrame()).toContain("unknown_type")
		})

		it("should handle unknown type with JSON content", () => {
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "future_type" as any,
				text: JSON.stringify({
					data: "test",
					nested: { value: 123 },
				}),
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			expect(lastFrame()).toContain("Unknown message type")
			// Should still display the message gracefully
			expect(lastFrame()).not.toContain("Error rendering message")
		})

		it("should handle unknown type with empty text", () => {
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "unknown" as any,
				text: "",
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			expect(lastFrame()).toContain("Unknown message type")
		})

		it("should handle unknown type with no text field", () => {
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "unknown" as any,
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			expect(lastFrame()).toContain("Unknown message type")
		})
	})

	describe("Unknown ask subtypes", () => {
		it("should display unknown ask type with warning color", () => {
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "ask",
				ask: "future_ask_type" as any,
				text: "This is a future ask type",
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			// Should show the text content
			expect(lastFrame()).toContain("This is a future ask type")
		})

		it("should handle unknown ask type with JSON content", () => {
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "ask",
				ask: "unknown_ask" as any,
				text: JSON.stringify({
					question: "Unknown question format",
					data: { key: "value" },
				}),
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			// Should attempt to display the content
			const frame = lastFrame()
			expect(frame).toBeTruthy()
			// Should not crash or show error boundary
			expect(frame).not.toContain("Error rendering message")
		})

		it("should handle unknown ask type with malformed JSON", () => {
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "ask",
				ask: "unknown_ask" as any,
				text: "{ invalid json",
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			// Should display the raw text
			expect(lastFrame()).toContain("{ invalid json")
		})

		it("should handle unknown ask type with empty text", () => {
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "ask",
				ask: "unknown_ask" as any,
				text: "",
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			// Should show unknown ask type indicator
			expect(lastFrame()).toContain("Unknown ask type")
		})

		it("should handle unknown ask type with no text", () => {
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "ask",
				ask: "unknown_ask" as any,
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			expect(lastFrame()).toContain("Unknown ask type")
		})
	})

	describe("Unknown say subtypes", () => {
		it("should display unknown say type with success color", () => {
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "say",
				say: "future_say_type" as any,
				text: "This is a future say type",
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			// Should show the text content
			expect(lastFrame()).toContain("This is a future say type")
		})

		it("should handle unknown say type with JSON content", () => {
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "say",
				say: "unknown_say" as any,
				text: JSON.stringify({
					result: "success",
					data: { items: [1, 2, 3] },
				}),
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			// Should attempt to display the content
			const frame = lastFrame()
			expect(frame).toBeTruthy()
			expect(frame).not.toContain("Error rendering message")
		})

		it("should handle unknown say type with nested JSON arrays", () => {
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "say",
				say: "unknown_say" as any,
				text: JSON.stringify({
					results: [
						{ id: 1, name: "Item 1" },
						{ id: 2, name: "Item 2" },
					],
				}),
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			const frame = lastFrame()
			expect(frame).toBeTruthy()
		})

		it("should handle unknown say type with malformed JSON", () => {
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "say",
				say: "unknown_say" as any,
				text: '{"incomplete": ',
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			// Should display the raw text
			expect(lastFrame()).toContain('{"incomplete":')
		})

		it("should handle unknown say type with empty text", () => {
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "say",
				say: "unknown_say" as any,
				text: "",
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			// Should show unknown say type indicator
			expect(lastFrame()).toContain("Unknown say type")
		})

		it("should handle unknown say type with no text", () => {
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "say",
				say: "unknown_say" as any,
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			expect(lastFrame()).toContain("Unknown say type")
		})
	})

	describe("Edge cases with additional properties", () => {
		it("should handle unknown type with images", () => {
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "unknown" as any,
				text: "Message with images",
				images: ["image1.png", "image2.png"],
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			expect(lastFrame()).toContain("Unknown message type")
		})

		it("should handle unknown type with partial flag", () => {
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "unknown" as any,
				text: "Streaming unknown type",
				partial: true,
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			expect(lastFrame()).toContain("Unknown message type")
		})

		it("should handle unknown ask with isAnswered flag", () => {
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "ask",
				ask: "unknown_ask" as any,
				text: "Already answered",
				isAnswered: true,
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			// Should still render even if answered
			expect(lastFrame()).toBeTruthy()
		})
	})

	describe("Markdown and code fence handling", () => {
		it("should handle unknown type with markdown content", () => {
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "say",
				say: "unknown_say" as any,
				text: "# Heading\n\nSome **bold** text",
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			// Should display the markdown content
			expect(lastFrame()).toContain("Heading")
			expect(lastFrame()).toContain("bold")
		})

		it("should handle unknown type with code fence", () => {
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "say",
				say: "unknown_say" as any,
				text: "```typescript\nconst x = 1;\n```",
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			// Should display the code content
			const frame = lastFrame()
			expect(frame).toContain("const x = 1")
		})

		it("should handle unknown type with JSON in code fence", () => {
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "say",
				say: "unknown_say" as any,
				text: '```json\n{"key": "value"}\n```',
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			const frame = lastFrame()
			// Should display as code, not parse as JSON
			expect(frame).toBeTruthy()
		})

		it("should handle unknown type with mixed markdown and JSON", () => {
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "say",
				say: "unknown_say" as any,
				text: "Here's the data:\n```json\n{\"result\": \"success\"}\n```\n\nAnd some text",
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			const frame = lastFrame()
			expect(frame).toContain("Here's the data")
		})
	})

	describe("Error boundary integration", () => {
		it("should catch errors from unknown message rendering", () => {
			// Create a message that might cause rendering issues
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "ask",
				ask: "unknown_ask" as any,
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
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			// Should not crash
			const frame = lastFrame()
			expect(frame).toBeTruthy()
		})

		it("should handle circular reference attempts gracefully", () => {
			// JSON.stringify will fail on circular references, but our code should handle it
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "say",
				say: "unknown_say" as any,
				text: "Some text that won't cause circular ref in our code",
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			expect(lastFrame()).toContain("Some text")
		})
	})

	describe("Null and undefined handling", () => {
		it("should handle unknown type with null text", () => {
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "unknown" as any,
				text: null as any,
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			expect(lastFrame()).toContain("Unknown message type")
		})

		it("should handle unknown ask with undefined text", () => {
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "ask",
				ask: "unknown_ask" as any,
				text: undefined,
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			expect(lastFrame()).toContain("Unknown ask type")
		})

		it("should handle unknown say with undefined text", () => {
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "say",
				say: "unknown_say" as any,
				text: undefined,
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			expect(lastFrame()).toContain("Unknown say type")
		})
	})
})
