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

	it("renders unknown root message types and shows text when present", () => {
		const message = createTestMessage({
			type: "unknown_type",
			text: "This is an unknown message type",
		})

		const { lastFrame } = render(<ExtensionMessageRow message={message} />)

		expect(lastFrame()).toBeDefined()
		expect(lastFrame()).toContain("Unknown message type")
		expect(lastFrame()).toContain("unknown_type")
		expect(lastFrame()).toContain("This is an unknown message type")
	})

	it("renders unknown ask types and shows text content", () => {
		const message = createTestMessage({
			type: "ask",
			ask: "future_ask_type",
			text: "This is a future ask type",
		})

		const { lastFrame } = render(<ExtensionMessageRow message={message} />)

		expect(lastFrame()).toBeDefined()
		expect(lastFrame()).toContain("This is a future ask type")
		expect(lastFrame()).not.toContain("Error rendering message")
	})

	it("renders unknown ask types with empty text using a fallback indicator", () => {
		const message = createTestMessage({
			type: "ask",
			ask: "unknown_ask",
			text: "",
		})

		const { lastFrame } = render(<ExtensionMessageRow message={message} />)

		expect(lastFrame()).toBeDefined()
		expect(lastFrame()).toContain("Unknown ask type")
	})

	it("pretty-prints JSON-ish content for unknown say types", () => {
		const message = createTestMessage({
			type: "say",
			say: "unknown_say",
			text: JSON.stringify({ result: "success", data: { items: [1, 2, 3] } }),
		})

		const { lastFrame } = render(<ExtensionMessageRow message={message} />)

		expect(lastFrame()).toBeDefined()
		expect(lastFrame()).toContain('"result"')
		expect(lastFrame()).not.toContain("Error rendering message")
	})

	it("renders malformed JSON as raw text for unknown say types", () => {
		const message = createTestMessage({
			type: "say",
			say: "unknown_say",
			text: '{"incomplete": ',
		})

		const { lastFrame } = render(<ExtensionMessageRow message={message} />)

		expect(lastFrame()).toBeDefined()
		expect(lastFrame()).toContain('{"incomplete":')
		expect(lastFrame()).not.toContain("Error rendering message")
	})
})
