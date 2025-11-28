/**
 * Tests for ThinkingAnimation component
 */

import React from "react"
import { render } from "ink-testing-library"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { ThinkingAnimation } from "../ThinkingAnimation.js"

// Mock the useTheme hook
vi.mock("../../../state/hooks/useTheme.js", () => ({
	useTheme: () => ({
		brand: {
			primary: "#00ff00",
		},
	}),
}))

describe("ThinkingAnimation", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.restoreAllMocks()
		vi.useRealTimers()
	})

	it("should render with initial frame", () => {
		const { lastFrame } = render(<ThinkingAnimation />)

		// Should show first frame character (⠋) and default text
		expect(lastFrame()).toContain("⠋")
		expect(lastFrame()).toContain("Thinking...")
	})

	it("should render with custom text", () => {
		const { lastFrame } = render(<ThinkingAnimation text="Processing..." />)

		expect(lastFrame()).toContain("⠋")
		expect(lastFrame()).toContain("Processing...")
	})

	it("should cycle through animation frames", async () => {
		const { lastFrame } = render(<ThinkingAnimation />)

		// Initial frame
		expect(lastFrame()).toContain("⠋")

		// Advance to next frame (80ms) and wait for React to update
		await vi.advanceTimersByTimeAsync(80)
		expect(lastFrame()).toContain("⠙")

		// Advance to third frame
		await vi.advanceTimersByTimeAsync(80)
		expect(lastFrame()).toContain("⠹")

		// Advance to fourth frame
		await vi.advanceTimersByTimeAsync(80)
		expect(lastFrame()).toContain("⠸")
	})

	it("should loop back to first frame after completing cycle", async () => {
		const { lastFrame } = render(<ThinkingAnimation />)

		// Advance through all 10 frames (10 * 80ms = 800ms)
		await vi.advanceTimersByTimeAsync(800)

		// Should be back at first frame
		expect(lastFrame()).toContain("⠋")
	})

	it("should clean up interval on unmount", () => {
		const clearIntervalSpy = vi.spyOn(global, "clearInterval")
		const { unmount } = render(<ThinkingAnimation />)

		unmount()

		expect(clearIntervalSpy).toHaveBeenCalled()
	})

	it("should continue animating after multiple cycles", async () => {
		const { lastFrame } = render(<ThinkingAnimation />)

		// Complete two full cycles (2 * 800ms = 1600ms)
		await vi.advanceTimersByTimeAsync(1600)

		// Should still be at first frame
		expect(lastFrame()).toContain("⠋")

		// Advance one more frame
		await vi.advanceTimersByTimeAsync(80)
		expect(lastFrame()).toContain("⠙")
	})
})
