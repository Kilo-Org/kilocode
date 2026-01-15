import { formatDuration, formatTokens } from "../formatters"

describe("formatDuration()", () => {
	it("formats as H:MM:SS", () => {
		expect(formatDuration(0)).toBe("0:00:00")
		expect(formatDuration(1_000)).toBe("0:00:01")
		expect(formatDuration(61_000)).toBe("0:01:01")
		expect(formatDuration(3_661_000)).toBe("1:01:01")
	})
})

describe("formatTokens()", () => {
	it("formats small numbers without suffix", () => {
		expect(formatTokens(0)).toBe("0")
		expect(formatTokens(999)).toBe("999")
	})

	it("formats thousands without decimals and clamps to 1.0M at boundary", () => {
		expect(formatTokens(1_000)).toBe("1k")
		expect(formatTokens(72_500)).toBe("73k")
		expect(formatTokens(999_499)).toBe("999k")
		expect(formatTokens(999_500)).toBe("1.0M")
	})

	it("formats millions with one decimal and clamps to 1.0B at boundary", () => {
		expect(formatTokens(1_000_000)).toBe("1.0M")
		expect(formatTokens(3_240_000)).toBe("3.2M")
		expect(formatTokens(999_950_000)).toBe("1.0B")
	})
})
