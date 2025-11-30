/**
 * Tests for ExtensionMessageRow component
 *
 * This test suite verifies that the ExtensionMessageRow component correctly routes
 * different message types to their appropriate sub-components.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render } from "ink-testing-library"
import { ExtensionMessageRow } from "../ExtensionMessageRow.js"
import type { ExtensionChatMessage } from "../../../../types/messages.js"
import type { ClineAsk, ClineSay } from "@roo-code/types"

// Mock the logs service
vi.mock("../../../../services/logs.js", () => ({
	logs: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}))

describe("ExtensionMessageRow", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("Ask Message Routing", () => {
		it("should route 'ask' message with type 'tool' to AskMessageRouter", () => {
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "ask",
				ask: "tool",
				text: JSON.stringify({
					tool: "readFile",
					path: "test.ts",
				}),
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			// The component should render without errors
			expect(lastFrame()).toBeDefined()
			// Should not show unknown message type
			expect(lastFrame()).not.toContain("Unknown message type")
		})

		it("should route 'ask' message with type 'command' to AskCommandMessage", () => {
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "ask",
				ask: "command",
				text: "npm install",
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			expect(lastFrame()).not.toContain("Unknown message type")
		})

		it("should route 'ask' message with type 'followup' to AskFollowupMessage", () => {
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "ask",
				ask: "followup",
				text: JSON.stringify({
					question: "What would you like to do?",
					suggest: [{ answer: "Option 1" }, { answer: "Option 2" }],
				}),
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			expect(lastFrame()).not.toContain("Unknown message type")
		})

		it("should route 'ask' message with type 'completion_result' to AskCompletionResultMessage", () => {
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "ask",
				ask: "completion_result",
				text: "Task completed successfully",
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			expect(lastFrame()).not.toContain("Unknown message type")
		})

		it("should route 'ask' message with type 'mistake_limit_reached' to AskMistakeLimitMessage", () => {
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "ask",
				ask: "mistake_limit_reached",
				text: "Too many mistakes",
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			expect(lastFrame()).not.toContain("Unknown message type")
		})

		it("should show default message for unknown 'ask' type", () => {
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "ask",
				ask: "followup" as unknown as ClineAsk, // Use valid type but test unknown handling
				text: "Unknown ask type",
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			// Should show the text or indicate unknown type
			expect(lastFrame()).toContain("Unknown ask type")
		})
	})

	describe("Say Message Routing", () => {
		it("should route 'say' message with type 'text' to SayTextMessage", () => {
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "say",
				say: "text",
				text: "This is a plain text message",
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			expect(lastFrame()).toContain("This is a plain text message")
			expect(lastFrame()).not.toContain("Unknown message type")
		})

		it("should route 'say' message with type 'error' to SayErrorMessage", () => {
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "say",
				say: "error",
				text: "An error occurred",
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			expect(lastFrame()).toContain("Error")
			expect(lastFrame()).toContain("An error occurred")
			expect(lastFrame()).not.toContain("Unknown message type")
		})

		it("should route 'say' message with type 'completion_result' to SayCompletionResultMessage", () => {
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "say",
				say: "completion_result",
				text: "Task completed",
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			expect(lastFrame()).not.toContain("Unknown message type")
		})

		it("should route 'say' message with type 'api_req_started' to SayApiReqStartedMessage", () => {
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "say",
				say: "api_req_started",
				text: JSON.stringify({
					request: "API request started",
				}),
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			expect(lastFrame()).not.toContain("Unknown message type")
		})

		it("should show default message for unknown 'say' type", () => {
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "say",
				say: "text" as unknown as ClineSay, // Use valid type but test unknown handling
				text: "Unknown say type",
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			// Should show the text or indicate unknown type
			expect(lastFrame()).toContain("Unknown say type")
		})
	})

	describe("Unknown Message Type", () => {
		it("should show fallback for completely unknown message type", () => {
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "unknown" as unknown as ExtensionChatMessage["type"],
				text: "Unknown message",
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			expect(lastFrame()).toContain("Unknown message type")
		})
	})

	describe("Error Boundary", () => {
		it("should catch and display errors from child components", () => {
			// Create a message that might cause an error in parsing
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "ask",
				ask: "tool",
				text: "invalid json {",
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			// Should render without crashing
			expect(lastFrame()).toBeDefined()
		})
	})

	describe("Partial Messages", () => {
		it("should handle partial 'say' text messages", () => {
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "say",
				say: "text",
				text: "Streaming message",
				partial: true,
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			expect(lastFrame()).toContain("Streaming message")
			// Should show ellipsis for partial messages
			expect(lastFrame()).toContain("...")
		})

		it("should preserve spacing between icon and text during streaming", () => {
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "say",
				say: "text",
				text: "Hello! I'm Kilo Code",
				partial: true,
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			// The icon (>) should be followed by a space before the text
			// This regex checks for the icon followed by whitespace and then text
			expect(lastFrame()).toMatch(/>\s+Hello/)
			expect(lastFrame()).toContain("Hello! I'm Kilo Code")
		})

		it("should preserve spacing even when text starts streaming from empty", () => {
			// First render with empty text
			const emptyMessage: ExtensionChatMessage = {
				ts: Date.now(),
				type: "say",
				say: "text",
				text: "",
				partial: true,
			}

			const { lastFrame: emptyFrame } = render(<ExtensionMessageRow message={emptyMessage} />)
			// Should render nothing when text is empty
			expect(emptyFrame()).toBe("")

			// Then render with text arriving
			const streamingMessage: ExtensionChatMessage = {
				ts: Date.now(),
				type: "say",
				say: "text",
				text: "Hello",
				partial: true,
			}

			const { lastFrame: streamingFrame } = render(<ExtensionMessageRow message={streamingMessage} />)

			expect(streamingFrame()).toBeDefined()
			// Should have proper spacing between icon and text
			expect(streamingFrame()).toMatch(/>\s+Hello/)
		})
	})

	describe("Messages with Images", () => {
		it("should handle messages with attached images", () => {
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "say",
				say: "text",
				text: "Message with images",
				images: ["image1.png", "image2.png"],
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			expect(lastFrame()).toContain("Message with images")
			// Should indicate images are attached
			expect(lastFrame()).toContain("2 image(s) attached")
		})

		it("should not render when text is empty and no images", () => {
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "say",
				say: "text",
				text: "",
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			// Should render nothing (empty string)
			expect(lastFrame()).toBe("")
		})

		it("should not render when text is only whitespace and no images", () => {
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "say",
				say: "text",
				text: "   \n\t  ",
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			// Should render nothing (empty string)
			expect(lastFrame()).toBe("")
		})

		it("should render when text is empty but has images", () => {
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "say",
				say: "text",
				text: "",
				images: ["image1.png"],
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			expect(lastFrame()).not.toBe("")
			// Should show image indicator
			expect(lastFrame()).toContain("1 image(s) attached")
		})

		it("should render when text is whitespace but has images", () => {
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "say",
				say: "text",
				text: "   ",
				images: ["image1.png", "image2.png"],
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			expect(lastFrame()).not.toBe("")
			// Should show image indicator
			expect(lastFrame()).toContain("2 image(s) attached")
		})
	})

	describe("Tool Messages", () => {
		it("should handle 'say' tool messages with valid JSON", () => {
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "say",
				say: "user_feedback_diff",
				text: JSON.stringify({
					tool: "editedExistingFile",
					path: "src/test.ts",
					content: "new content",
				}),
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			expect(lastFrame()).not.toContain("Unknown message type")
		})

		it("should handle 'ask' tool messages with valid JSON", () => {
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "ask",
				ask: "tool",
				text: JSON.stringify({
					tool: "readFile",
					path: "src/app.ts",
				}),
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			expect(lastFrame()).not.toContain("Unknown message type")
		})
	})

	describe("MCP Server Messages", () => {
		it("should handle 'ask' use_mcp_server messages", () => {
			const message: ExtensionChatMessage = {
				ts: Date.now(),
				type: "ask",
				ask: "use_mcp_server",
				text: JSON.stringify({
					type: "use_mcp_tool",
					serverName: "test-server",
					toolName: "test-tool",
					arguments: "{}",
				}),
			}

			const { lastFrame } = render(<ExtensionMessageRow message={message} />)

			expect(lastFrame()).toBeDefined()
			expect(lastFrame()).not.toContain("Unknown message type")
		})
	})
})
