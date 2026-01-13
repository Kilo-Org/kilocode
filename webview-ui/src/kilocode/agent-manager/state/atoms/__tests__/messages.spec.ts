import { describe, it, expect } from "vitest"
import type { ClineMessage } from "@roo-code/types"
import { reconcileMessages, messageToEvent, getContentLength } from "../messages"

describe("messages atom helpers", () => {
	describe("messageToEvent", () => {
		it("maps api_req_started to api_req_started event", () => {
			const msg: ClineMessage = { ts: 1, type: "say", say: "api_req_started" }
			expect(messageToEvent(msg)).toEqual({ type: "api_req_started" })
		})

		it("maps say:text to say_text with partial flag", () => {
			const msg: ClineMessage = { ts: 1, type: "say", say: "text", text: "hi", partial: true }
			expect(messageToEvent(msg)).toEqual({ type: "say_text", partial: true })
		})

		it("maps ask:followup to ask_followup with partial flag", () => {
			const msg: ClineMessage = { ts: 1, type: "ask", ask: "followup", partial: false }
			expect(messageToEvent(msg)).toEqual({ type: "ask_followup", partial: false })
		})

		it("maps completion_result ask to ask_completion_result", () => {
			const msg: ClineMessage = { ts: 1, type: "ask", ask: "completion_result" }
			expect(messageToEvent(msg)).toEqual({ type: "ask_completion_result" })
		})

		it("returns null for unknown ask types", () => {
			// Cast through unknown so we can simulate a malformed ask value
			const msg = { ts: 1, type: "ask", ask: "unknown_type" } as unknown as ClineMessage
			expect(messageToEvent(msg)).toBeNull()
		})
	})

	describe("reconcileMessages", () => {
		it("keeps existing final message when incoming is partial and shorter", () => {
			const existing: ClineMessage = { ts: 1, type: "say", say: "text", text: "hello", partial: false }
			const incoming: ClineMessage = { ts: 1, type: "say", say: "text", text: "hi", partial: true }

			const versions = new Map<number, number>([[1, getContentLength(existing)]])
			const result = reconcileMessages([existing], [incoming], versions)

			expect(result[0]).toEqual(existing)
		})

		it("replaces existing when incoming has more content", () => {
			const existing: ClineMessage = { ts: 1, type: "say", say: "text", text: "hi", partial: true }
			const incoming: ClineMessage = { ts: 1, type: "say", say: "text", text: "hello!", partial: true }

			const versions = new Map<number, number>([[1, getContentLength(existing)]])
			const result = reconcileMessages([existing], [incoming], versions)

			expect(result[0]).toEqual(incoming)
		})

		it("passes through new messages when ts not seen", () => {
			const incoming: ClineMessage = { ts: 2, type: "say", say: "text", text: "new" }
			const result = reconcileMessages([], [incoming], new Map())
			expect(result[0]).toEqual(incoming)
		})
	})
})
