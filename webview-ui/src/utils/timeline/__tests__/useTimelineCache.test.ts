import { renderHook } from "@testing-library/react"
import type { ClineMessage } from "@roo-code/types"
import { useTimelineCache } from "../useTimelineCache"

jest.mock("../timelineMessageProcessing", () => ({
	processTimelineMessages: jest.fn((messages: any[]) => ({
		processedMessages: messages.slice(1),
		messageToOriginalIndex: new Map(messages.slice(1).map((msg: any, idx: number) => [msg, idx + 1])),
	})),
}))

jest.mock("../calculateTaskTimelineSizes", () => ({
	calculateTaskTimelineSizes: jest.fn((messages) =>
		messages.map(() => ({
			width: 16,
			height: 12,
			contentLength: 100,
			timingMs: 1000,
		})),
	),
}))

jest.mock("../taskTimelineTypeRegistry", () => ({
	getTaskTimelineMessageColor: jest.fn(() => "bg-blue-500"),
}))

const createMessage = (id: string): ClineMessage => ({
	ts: Date.now(),
	type: "say",
	say: "text",
	text: `Message ${id}`,
})

describe("useTimelineCache", () => {
	it("processes messages correctly", () => {
		const messages = [createMessage("1"), createMessage("2"), createMessage("3")]
		const { result } = renderHook(() => useTimelineCache(messages))

		expect(result.current).toHaveLength(2) // Skips first message
		expect(result.current[0].message).toBe(messages[1])
		expect(result.current[1].message).toBe(messages[2])
	})

	it("caches results when message count doesn't change", () => {
		const messages = [createMessage("1"), createMessage("2")]
		const { result, rerender } = renderHook(() => useTimelineCache(messages))

		const firstResult = result.current
		rerender()
		const secondResult = result.current

		expect(firstResult).toBe(secondResult)
	})

	it("recalculates when new messages added", () => {
		const initialMessages = [createMessage("1"), createMessage("2")]
		const { result, rerender } = renderHook(({ messages }) => useTimelineCache(messages), {
			initialProps: { messages: initialMessages },
		})

		const firstResult = result.current

		const newMessages = [...initialMessages, createMessage("3")]
		rerender({ messages: newMessages })

		expect(result.current).not.toBe(firstResult)
		expect(result.current).toHaveLength(2)
	})

	it("returns cached data without isActive", () => {
		const messages = [createMessage("1"), createMessage("2"), createMessage("3")]
		const { result } = renderHook(() => useTimelineCache(messages))

		const timelineData = result.current
		expect(timelineData[0]).toHaveProperty("index")
		expect(timelineData[0]).toHaveProperty("color")
		expect(timelineData[0]).toHaveProperty("message")
		expect(timelineData[0]).toHaveProperty("sizeData")
		expect(timelineData[0]).not.toHaveProperty("isActive")
	})
})
