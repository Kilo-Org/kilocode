import { MessageLogDeduper } from "../messageLogDeduper.js"

describe("MessageLogDeduper", () => {
	it("dedupes identical messages for same action+ts", () => {
		const d = new MessageLogDeduper()
		const msg = { ts: 123, type: "say", say: "reasoning", text: "hello", partial: false }

		expect(d.shouldLog("updated", msg)).toBe(true)
		expect(d.shouldLog("updated", msg)).toBe(false)
	})

	it("logs again if payload changes for same action+ts", () => {
		const d = new MessageLogDeduper()
		expect(d.shouldLog("updated", { ts: 123, text: "a" })).toBe(true)
		expect(d.shouldLog("updated", { ts: 123, text: "b" })).toBe(true)
	})

	it("does not dedupe across different actions", () => {
		const d = new MessageLogDeduper()
		const msg = { ts: 123, text: "same" }
		expect(d.shouldLog("created", msg)).toBe(true)
		expect(d.shouldLog("updated", msg)).toBe(true)
	})

	it("evicts oldest entries", () => {
		const d = new MessageLogDeduper(2)

		expect(d.shouldLog("updated", { ts: 1, text: "a" })).toBe(true)
		expect(d.shouldLog("updated", { ts: 2, text: "b" })).toBe(true)
		// causes eviction of ts:1
		expect(d.shouldLog("updated", { ts: 3, text: "c" })).toBe(true)
		// ts:1 was evicted so it should log again
		expect(d.shouldLog("updated", { ts: 1, text: "a" })).toBe(true)
	})
})
