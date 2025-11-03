/**
 * Tests for message utility functions
 * @kilocode_change - Tests for orphaned partial ask messages bug fix
 */

import { describe, it, expect } from "vitest"
import { findPartialAskMessage, findPartialSayMessage } from "../../kilocode/task/message-utils"
import type { ClineMessage } from "@roo-code/types"

describe("findPartialAskMessage", () => {
	it("should find the most recent partial ask message", () => {
		const messages: ClineMessage[] = [
			{ ts: 1, type: "ask", ask: "tool", text: "test", partial: false },
			{ ts: 2, type: "ask", ask: "tool", text: "test", partial: true },
			{ ts: 3, type: "say", say: "checkpoint_saved", text: "hash123" },
		]

		const result = findPartialAskMessage(messages, "tool")
		expect(result).toBeDefined()
		expect(result?.message.ts).toBe(2)
		expect(result?.index).toBe(1)
	})

	it("should return undefined when no partial ask exists", () => {
		const messages: ClineMessage[] = [
			{ ts: 1, type: "ask", ask: "tool", text: "test", partial: false },
			{ ts: 2, type: "say", say: "checkpoint_saved", text: "hash123" },
		]

		const result = findPartialAskMessage(messages, "tool")
		expect(result).toBeUndefined()
	})

	it("should find the correct type when multiple ask types exist", () => {
		const messages: ClineMessage[] = [
			{ ts: 1, type: "ask", ask: "tool", text: "test", partial: true },
			{ ts: 2, type: "ask", ask: "command", text: "test2", partial: true },
			{ ts: 3, type: "say", say: "checkpoint_saved", text: "hash123" },
		]

		const result = findPartialAskMessage(messages, "command")
		expect(result).toBeDefined()
		expect(result?.message.ask).toBe("command")
		expect(result?.message.ts).toBe(2)
	})

	it("should handle multiple checkpoints between partial start and completion", () => {
		const messages: ClineMessage[] = [
			{ ts: 1, type: "ask", ask: "tool", text: "test", partial: true },
			{ ts: 2, type: "say", say: "checkpoint_saved", text: "hash1" },
			{ ts: 3, type: "say", say: "checkpoint_saved", text: "hash2" },
			{ ts: 4, type: "say", say: "checkpoint_saved", text: "hash3" },
		]

		const result = findPartialAskMessage(messages, "tool")
		expect(result).toBeDefined()
		expect(result?.message.ts).toBe(1)
		expect(result?.index).toBe(0)
	})

	it("should find the most recent partial when multiple partials of same type exist", () => {
		const messages: ClineMessage[] = [
			{ ts: 1, type: "ask", ask: "tool", text: "old", partial: true },
			{ ts: 2, type: "ask", ask: "tool", text: "new", partial: true },
			{ ts: 3, type: "say", say: "checkpoint_saved", text: "hash123" },
		]

		const result = findPartialAskMessage(messages, "tool")
		expect(result).toBeDefined()
		expect(result?.message.text).toBe("new")
		expect(result?.message.ts).toBe(2)
	})
})

describe("findPartialSayMessage", () => {
	it("should find the most recent partial say message", () => {
		const messages: ClineMessage[] = [
			{ ts: 1, type: "say", say: "text", text: "test", partial: false },
			{ ts: 2, type: "say", say: "text", text: "test", partial: true },
			{ ts: 3, type: "say", say: "checkpoint_saved", text: "hash123" },
		]

		const result = findPartialSayMessage(messages, "text")
		expect(result).toBeDefined()
		expect(result?.message.ts).toBe(2)
		expect(result?.index).toBe(1)
	})

	it("should return undefined when no partial say exists", () => {
		const messages: ClineMessage[] = [
			{ ts: 1, type: "say", say: "text", text: "test", partial: false },
			{ ts: 2, type: "say", say: "checkpoint_saved", text: "hash123" },
		]

		const result = findPartialSayMessage(messages, "text")
		expect(result).toBeUndefined()
	})

	it("should find the correct type when multiple say types exist", () => {
		const messages: ClineMessage[] = [
			{ ts: 1, type: "say", say: "text", text: "test", partial: true },
			{ ts: 2, type: "say", say: "reasoning", text: "thinking", partial: true },
			{ ts: 3, type: "say", say: "checkpoint_saved", text: "hash123" },
		]

		const result = findPartialSayMessage(messages, "reasoning")
		expect(result).toBeDefined()
		expect(result?.message.say).toBe("reasoning")
		expect(result?.message.ts).toBe(2)
	})

	it("should handle multiple checkpoints between partial start and completion", () => {
		const messages: ClineMessage[] = [
			{ ts: 1, type: "say", say: "text", text: "test", partial: true },
			{ ts: 2, type: "say", say: "checkpoint_saved", text: "hash1" },
			{ ts: 3, type: "say", say: "checkpoint_saved", text: "hash2" },
		]

		const result = findPartialSayMessage(messages, "text")
		expect(result).toBeDefined()
		expect(result?.message.ts).toBe(1)
		expect(result?.index).toBe(0)
	})
})
