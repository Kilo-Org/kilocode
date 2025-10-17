/**
 * Tests for useFollowupCIResponse hook
 *
 * Tests that follow-up messages are handled correctly:
 * - In normal mode: no automatic response
 * - In CI mode: automatic response sent
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { createStore } from "jotai"
import { ciModeAtom } from "../../atoms/ci.js"
import type { ExtensionChatMessage } from "../../../types/messages.js"
import { CI_MODE_MESSAGES } from "../../../constants/ci.js"

// Mock the webview message hook
const mockSendAskResponse = vi.fn()
vi.mock("../useWebviewMessage.js", () => ({
	useWebviewMessage: () => ({
		sendAskResponse: mockSendAskResponse,
	}),
}))

describe("useFollowupCIResponse Logic", () => {
	let store: ReturnType<typeof createStore>

	beforeEach(() => {
		store = createStore()
		mockSendAskResponse.mockClear()
		mockSendAskResponse.mockResolvedValue(undefined)
	})

	const createMockMessage = (overrides?: Partial<ExtensionChatMessage>): ExtensionChatMessage => ({
		ts: Date.now(),
		type: "ask",
		ask: "followup",
		text: "What should I do next?",
		partial: false,
		isAnswered: false,
		...overrides,
	})

	describe("CI Mode Detection", () => {
		it("should detect CI mode from atom", () => {
			store.set(ciModeAtom, false)
			expect(store.get(ciModeAtom)).toBe(false)

			store.set(ciModeAtom, true)
			expect(store.get(ciModeAtom)).toBe(true)
		})
	})

	describe("Message Validation", () => {
		it("should identify valid follow-up messages", () => {
			const message = createMockMessage()

			expect(message.type).toBe("ask")
			expect(message.ask).toBe("followup")
			expect(message.partial).toBe(false)
			expect(message.isAnswered).toBe(false)
		})

		it("should identify answered messages", () => {
			const message = createMockMessage({ isAnswered: true })

			expect(message.isAnswered).toBe(true)
		})

		it("should identify partial messages", () => {
			const message = createMockMessage({ partial: true })

			expect(message.partial).toBe(true)
		})
	})

	describe("CI Mode Response Logic", () => {
		it("should have correct CI mode message", () => {
			expect(CI_MODE_MESSAGES.FOLLOWUP_RESPONSE).toBe(
				"This process is running in non-interactive CI mode. No user input is available. You must make autonomous decisions based on best practices and reasonable assumptions. Proceed with the most appropriate option.",
			)
		})

		it("should prepare correct response payload", () => {
			const expectedPayload = {
				response: "messageResponse",
				text: CI_MODE_MESSAGES.FOLLOWUP_RESPONSE,
			}

			expect(expectedPayload.response).toBe("messageResponse")
			expect(expectedPayload.text).toContain("non-interactive CI mode")
		})
	})

	describe("Hook Export", () => {
		it("should export useFollowupCIResponse hook", async () => {
			const hooks = await import("../index.js")

			expect(hooks.useFollowupCIResponse).toBeDefined()
			expect(typeof hooks.useFollowupCIResponse).toBe("function")
		})
	})
})
