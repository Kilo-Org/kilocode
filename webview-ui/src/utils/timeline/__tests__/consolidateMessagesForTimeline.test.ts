import type { ClineMessage } from "@roo-code/types"
import { consolidateMessagesForTimeline } from "../consolidateMessagesForTimeline"

function createMessage(id: string): ClineMessage {
	return {
		ts: Date.now(),
		type: "say",
		say: "text",
		text: `Message ${id}`,
	}
}

describe("consolidateMessagesForTimeline", () => {
	it("processes messages correctly", () => {
		const messages = [createMessage("1"), createMessage("2"), createMessage("3")]
		const result = consolidateMessagesForTimeline(messages)

		expect(result.processedMessages).toHaveLength(2) // First message is skipped
		expect(result.messageToOriginalIndex).toBeInstanceOf(Map)
		expect(result.messageToOriginalIndex.size).toBe(2)
	})

	it("returns empty arrays for single message", () => {
		const messages = [createMessage("1")]
		const result = consolidateMessagesForTimeline(messages)

		expect(result.processedMessages).toHaveLength(0)
		expect(result.messageToOriginalIndex.size).toBe(0)
	})

	it("maps messages to correct original indices", () => {
		const messages = [createMessage("1"), createMessage("2"), createMessage("3")]
		const result = consolidateMessagesForTimeline(messages)

		// First message (index 0) is skipped, so we should have mappings for indices 1 and 2
		const indices = Array.from(result.messageToOriginalIndex.values())
		expect(indices).toContain(1)
		expect(indices).toContain(2)
		expect(indices).not.toContain(0)
	})

	it("handles grouped messages correctly", () => {
		const groupedMessages = [createMessage("1"), [createMessage("2a"), createMessage("2b")], createMessage("3")]
		const result = consolidateMessagesForTimeline(groupedMessages)

		expect(result.processedMessages.length).toBeGreaterThan(0)
		expect(result.messageToOriginalIndex.size).toBeGreaterThan(0)
	})
})
