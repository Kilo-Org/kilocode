import { calculateTaskTimelineSizes } from "../calculateTaskTimelineSizes"
import type { ClineMessage } from "@roo-code/types"

describe("calculateTaskTimelineSizes", () => {
	const createTestMessage = (
		text: string,
		timestamp: number,
		type: "ask" | "say" = "say",
		say?: string,
	): ClineMessage => ({
		ts: timestamp,
		type,
		text,
		...(type === "say" && say ? { say: say as any } : {}),
	})

	it("should return empty array for empty messages", () => {
		const result = calculateTaskTimelineSizes([])
		expect(result).toEqual([])
	})

	it("should calculate sizes based on content length and timing", () => {
		const baseTime = 1000
		const messages = [
			createTestMessage("Short", baseTime),
			createTestMessage("This is a much longer message with more content", baseTime + 2000), // 2s later
			createTestMessage("Medium", baseTime + 8000), // 6s later
		]

		const result = calculateTaskTimelineSizes(messages)

		expect(result).toHaveLength(3)

		// First message was active for 2s (until second message)
		expect(result[0].timingMs).toBe(2000)
		expect(result[0].contentLength).toBe(5) // "Short"

		// Second message was active for 6s (until third message)
		expect(result[1].timingMs).toBe(6000)
		expect(result[1].contentLength).toBe(47) // Longer message

		// Third message has no timing (last message)
		expect(result[2].timingMs).toBeNull()
		expect(result[2].contentLength).toBe(6) // "Medium"

		// Verify sizing logic - width based on timing, height based on content
		expect(result[1].width).toBeGreaterThan(result[0].width) // 6s > 2s
		expect(result[2].width).toBeLessThan(result[1].width) // Last message should use minimum width
		expect(result[1].height).toBeGreaterThan(result[0].height) // Longer content
		expect(result[1].height).toBeGreaterThan(result[2].height) // Longer content than "Medium"
	})

	it("should respect min/max size constraints", () => {
		const messages = [
			createTestMessage("X", 1000), // Very short
			createTestMessage("X".repeat(1000), 2000), // Very long
		]

		const result = calculateTaskTimelineSizes(messages)

		result.forEach((size) => {
			expect(size.width).toBeGreaterThanOrEqual(8) // MIN_WIDTH_PX
			expect(size.width).toBeLessThanOrEqual(32) // MAX_WIDTH_PX
			expect(size.height).toBeGreaterThanOrEqual(8) // MIN_HEIGHT_PX
			expect(size.height).toBeLessThanOrEqual(24) // MAX_HEIGHT_PX
		})
	})

	it("should handle array messages correctly", () => {
		const messages = [
			[createTestMessage("First", 1000), createTestMessage("Second", 1000)],
			createTestMessage("Single", 2000),
		]

		const result = calculateTaskTimelineSizes(messages)

		expect(result).toHaveLength(2)
		// Array message should combine content lengths
		expect(result[0].contentLength).toBe(11) // "First" + "Second" = 5 + 6
		expect(result[1].contentLength).toBe(6) // "Single"
	})

	it("should handle messages with additional content types", () => {
		const messageWithReasoning: ClineMessage = {
			ts: 1000,
			type: "say",
			text: "Main text",
			reasoning: "Some reasoning",
			images: ["image1", "image2"],
		}

		const messages = [messageWithReasoning]
		const result = calculateTaskTimelineSizes(messages)

		// Should include text + reasoning + images (2 * 100)
		const expectedLength = "Main text".length + "Some reasoning".length + 2 * 100
		expect(result[0].contentLength).toBe(expectedLength)
	})

	it("should handle single message correctly", () => {
		const messages = [createTestMessage("Single message", 1000)]
		const result = calculateTaskTimelineSizes(messages)

		expect(result).toHaveLength(1)
		expect(result[0].timingMs).toBeNull() // Last (and only) message has no timing
		expect(result[0].contentLength).toBe(14) // "Single message"
		expect(result[0].width).toBeGreaterThanOrEqual(8)
		expect(result[0].height).toBeGreaterThanOrEqual(8)
	})
})
