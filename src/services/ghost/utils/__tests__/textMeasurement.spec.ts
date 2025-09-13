import { describe, it, expect } from "vitest"
import { calculateContainerWidth, calculateTextWidth } from "../textMeasurement"

describe("calculateContainerWidth", () => {
	it("should provide adequate width for single line text", () => {
		const text = "\t// Function implementation"
		const fontSize = 14
		const width = calculateContainerWidth(text, fontSize)

		// Should have minimum width
		expect(width).toBeGreaterThanOrEqual(32)
	})

	it("should handle multi-line text correctly", () => {
		const text = "function example() {\n\t// Function implementation\n}"
		const fontSize = 14
		const width = calculateContainerWidth(text, fontSize)

		// Should be based on longest line (the comment line)
		const longestLine = "\t// Function implementation"
		const expectedMinWidth = longestLine.length * fontSize * 0.6 + 32
		expect(width).toBeGreaterThanOrEqual(Math.floor(expectedMinWidth))
	})

	it("should maintain minimum width for short text", () => {
		const width = calculateContainerWidth("a", 14)
		expect(width).toBeGreaterThanOrEqual(32)
	})

	it("regression test: should prevent 'implementation' cutoff", () => {
		// This is the exact scenario from the bug report
		const text = "\t// Function implementation"
		const fontSize = 14
		const containerWidth = calculateContainerWidth(text, fontSize)
		const actualTextWidth = calculateTextWidth(text, fontSize)

		// Container should be wider than the actual text content
		expect(containerWidth).toBeGreaterThan(actualTextWidth)

		// Should have at least 32px padding
		expect(containerWidth - actualTextWidth).toBeGreaterThanOrEqual(32)
	})
})
