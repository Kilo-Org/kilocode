import { describe, it, expect } from "vitest"
import { generateCliMessageId, generateExtensionMessageId } from "../messageId.js"
import type { CliMessage } from "../../../types/cli.js"
import type { ExtensionChatMessage } from "../../../types/messages.js"

function createCliMessage(overrides: Partial<CliMessage>): CliMessage {
	return {
		id: "test-id",
		type: "assistant",
		content: "test content",
		ts: 1704067200000,
		...overrides,
	}
}

function createExtensionMessage(overrides: Partial<ExtensionChatMessage>): ExtensionChatMessage {
	return {
		ts: 1704067200000,
		type: "say",
		...overrides,
	}
}

describe("generateCliMessageId", () => {
	it("generates ID with cli prefix", () => {
		const message = createCliMessage({})
		const id = generateCliMessageId(message)
		expect(id).toMatch(/^cli-/)
	})

	it("includes timestamp in ID", () => {
		const message = createCliMessage({ ts: 1704067200000 })
		const id = generateCliMessageId(message)
		expect(id).toContain("1704067200000")
	})

	it("generates deterministic IDs for same input", () => {
		const message = createCliMessage({ id: "unique-id", ts: 1704067200000 })
		const id1 = generateCliMessageId(message)
		const id2 = generateCliMessageId(message)
		expect(id1).toBe(id2)
	})

	it("generates different IDs for different messages", () => {
		const message1 = createCliMessage({ id: "id-1", ts: 1704067200000 })
		const message2 = createCliMessage({ id: "id-2", ts: 1704067200000 })
		const id1 = generateCliMessageId(message1)
		const id2 = generateCliMessageId(message2)
		expect(id1).not.toBe(id2)
	})

	it("handles messages without id by using content", () => {
		const message = createCliMessage({ id: "", content: "some content", ts: 1704067200000 })
		const id = generateCliMessageId(message)
		expect(id).toMatch(/^cli-1704067200000-/)
	})

	it("handles messages without content by using type", () => {
		const message = createCliMessage({ id: "", content: "", type: "error", ts: 1704067200000 })
		const id = generateCliMessageId(message)
		expect(id).toMatch(/^cli-1704067200000-/)
	})
})

describe("generateExtensionMessageId", () => {
	it("generates ID with ext prefix", () => {
		const message = createExtensionMessage({})
		const id = generateExtensionMessageId(message)
		expect(id).toMatch(/^ext-/)
	})

	it("includes timestamp in ID", () => {
		const message = createExtensionMessage({ ts: 1704067200000 })
		const id = generateExtensionMessageId(message)
		expect(id).toContain("1704067200000")
	})

	it("generates deterministic IDs for same input", () => {
		const message = createExtensionMessage({ type: "say", say: "text", text: "hello", ts: 1704067200000 })
		const id1 = generateExtensionMessageId(message)
		const id2 = generateExtensionMessageId(message)
		expect(id1).toBe(id2)
	})

	it("generates different IDs for different message types", () => {
		const message1 = createExtensionMessage({ type: "ask", ask: "tool", ts: 1704067200000 })
		const message2 = createExtensionMessage({ type: "say", say: "text", ts: 1704067200000 })
		const id1 = generateExtensionMessageId(message1)
		const id2 = generateExtensionMessageId(message2)
		expect(id1).not.toBe(id2)
	})

	it("includes ask type in hash calculation", () => {
		const message1 = createExtensionMessage({ type: "ask", ask: "tool", ts: 1704067200000 })
		const message2 = createExtensionMessage({ type: "ask", ask: "command", ts: 1704067200000 })
		const id1 = generateExtensionMessageId(message1)
		const id2 = generateExtensionMessageId(message2)
		expect(id1).not.toBe(id2)
	})

	it("includes say type in hash calculation", () => {
		const message1 = createExtensionMessage({ type: "say", say: "text", ts: 1704067200000 })
		const message2 = createExtensionMessage({ type: "say", say: "error", ts: 1704067200000 })
		const id1 = generateExtensionMessageId(message1)
		const id2 = generateExtensionMessageId(message2)
		expect(id1).not.toBe(id2)
	})

	it("generates same ID for messages with different text (streaming stability)", () => {
		// During streaming, text changes but messageId should remain stable
		const partialMessage = createExtensionMessage({
			type: "say",
			say: "text",
			text: "Hello",
			partial: true,
			ts: 1704067200000,
		})
		const completeMessage = createExtensionMessage({
			type: "say",
			say: "text",
			text: "Hello, world!",
			partial: false,
			ts: 1704067200000,
		})
		const id1 = generateExtensionMessageId(partialMessage)
		const id2 = generateExtensionMessageId(completeMessage)
		expect(id1).toBe(id2) // Same ID for streaming updates
	})
})
