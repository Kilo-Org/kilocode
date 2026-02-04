// npx vitest run core/task/__tests__/mergeConsecutiveApiMessages.spec.ts

import { mergeConsecutiveApiMessages } from "../mergeConsecutiveApiMessages"

describe("mergeConsecutiveApiMessages", () => {
	it("merges consecutive user messages by default", () => {
		const merged = mergeConsecutiveApiMessages([
			{ role: "user", content: "A", ts: 1 },
			{ role: "user", content: [{ type: "text", text: "B" }], ts: 2 },
			{ role: "assistant", content: "C", ts: 3 },
		])

		expect(merged).toHaveLength(2)
		expect(merged[0].role).toBe("user")
		expect(merged[0].content).toEqual([
			{ type: "text", text: "A" },
			{ type: "text", text: "B" },
		])
		expect(merged[1].role).toBe("assistant")
	})

	it("merges regular user message into a summary (API shaping only)", () => {
		const merged = mergeConsecutiveApiMessages([
			{ role: "user", content: [{ type: "text", text: "Summary" }], ts: 1, isSummary: true, condenseId: "s" },
			{ role: "user", content: [{ type: "text", text: "After" }], ts: 2 },
		])

		expect(merged).toHaveLength(1)
		expect(merged[0].isSummary).toBe(true)
		expect(merged[0].content).toEqual([
			{ type: "text", text: "Summary" },
			{ type: "text", text: "After" },
		])
	})

	it("does not merge a summary into a preceding message", () => {
		const merged = mergeConsecutiveApiMessages([
			{ role: "user", content: [{ type: "text", text: "Before" }], ts: 1 },
			{ role: "user", content: [{ type: "text", text: "Summary" }], ts: 2, isSummary: true, condenseId: "s" },
		])

		expect(merged).toHaveLength(2)
		expect(merged[0].isSummary).toBeUndefined()
		expect(merged[1].isSummary).toBe(true)
	})
})
