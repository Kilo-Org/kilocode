import { describe, it, expect } from "vitest"
import { normalizeAutoTriggerDelayToMs, formatDelay, DELAY_VALUES } from "../autocompleteDelayUtils"

describe("normalizeAutoTriggerDelay", () => {
	it("should return 3000 for undefined", () => {
		expect(normalizeAutoTriggerDelayToMs(undefined)).toBe(3000)
	})

	it("should return value as-is for values >= 50", () => {
		expect(normalizeAutoTriggerDelayToMs(50)).toBe(50)
		expect(normalizeAutoTriggerDelayToMs(100)).toBe(100)
		expect(normalizeAutoTriggerDelayToMs(1000)).toBe(1000)
		expect(normalizeAutoTriggerDelayToMs(5000)).toBe(5000)
	})

	it("should convert legacy second values to milliseconds (values < 50)", () => {
		expect(normalizeAutoTriggerDelayToMs(1)).toBe(1000)
		expect(normalizeAutoTriggerDelayToMs(3)).toBe(3000)
		expect(normalizeAutoTriggerDelayToMs(5)).toBe(5000)
	})

	it("should cap legacy values at 5 seconds (5000ms)", () => {
		expect(normalizeAutoTriggerDelayToMs(6)).toBe(5000)
		expect(normalizeAutoTriggerDelayToMs(10)).toBe(5000)
		expect(normalizeAutoTriggerDelayToMs(30)).toBe(5000)
	})
})

describe("formatDelay", () => {
	it("should format milliseconds values below 1000ms", () => {
		expect(formatDelay(50)).toBe("50ms")
		expect(formatDelay(100)).toBe("100ms")
		expect(formatDelay(500)).toBe("500ms")
		expect(formatDelay(999)).toBe("999ms")
	})

	it("should format values >= 1000ms as seconds", () => {
		expect(formatDelay(1000)).toBe("1s")
		expect(formatDelay(1500)).toBe("1.5s")
		expect(formatDelay(3000)).toBe("3s")
		expect(formatDelay(5000)).toBe("5s")
	})
})

describe("DELAY_VALUES", () => {
	it("should contain expected delay values", () => {
		expect(DELAY_VALUES).toEqual([
			50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000,
		])
	})

	it("should start at 50ms", () => {
		expect(DELAY_VALUES[0]).toBe(50)
	})

	it("should end at 5000ms", () => {
		expect(DELAY_VALUES[DELAY_VALUES.length - 1]).toBe(5000)
	})

	it("should include default value of 3000ms", () => {
		expect(DELAY_VALUES).toContain(3000)
	})
})
