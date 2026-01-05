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

// Animation frames used by the component
const ANIMATION_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
const FRAME_INTERVAL = 80

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
		expect(lastFrame()).toContain(ANIMATION_FRAMES[0])
		expect(lastFrame()).toContain("Thinking...")
	})

	it("should render with custom text", () => {
		const { lastFrame } = render(<ThinkingAnimation text="Processing..." />)

		expect(lastFrame()).toContain(ANIMATION_FRAMES[0])
		expect(lastFrame()).toContain("Processing...")
	})

	it("should cycle through animation frames", async () => {
		const { lastFrame } = render(<ThinkingAnimation />)

		// Initial frame
		expect(lastFrame()).toContain(ANIMATION_FRAMES[0])

		// Advance to next frame - use slightly more than interval to ensure timer fires
		await vi.advanceTimersByTimeAsync(FRAME_INTERVAL + 1)
		expect(lastFrame()).toContain(ANIMATION_FRAMES[1])

		// Advance to third frame
		await vi.advanceTimersByTimeAsync(FRAME_INTERVAL + 1)
		expect(lastFrame()).toContain(ANIMATION_FRAMES[2])

		// Advance to fourth frame
		await vi.advanceTimersByTimeAsync(FRAME_INTERVAL + 1)
		expect(lastFrame()).toContain(ANIMATION_FRAMES[3])
	})

	it("should loop back to first frame after completing cycle", async () => {
		const { lastFrame } = render(<ThinkingAnimation />)

		// Advance through all 10 frames plus a small buffer
		// Using runOnlyPendingTimers in a loop is more deterministic than advancing by exact time
		for (let i = 0; i < ANIMATION_FRAMES.length; i++) {
			await vi.advanceTimersByTimeAsync(FRAME_INTERVAL + 1)
		}

		// Should be back at first frame
		expect(lastFrame()).toContain(ANIMATION_FRAMES[0])
	})

	it("should clean up interval on unmount", () => {
		const clearIntervalSpy = vi.spyOn(global, "clearInterval")
		const { unmount } = render(<ThinkingAnimation />)

		unmount()

		expect(clearIntervalSpy).toHaveBeenCalled()
	})

	it("should continue animating after multiple cycles", async () => {
		const { lastFrame } = render(<ThinkingAnimation />)

		// Complete two full cycles using deterministic timer advancement
		const totalFrames = ANIMATION_FRAMES.length * 2
		for (let i = 0; i < totalFrames; i++) {
			await vi.advanceTimersByTimeAsync(FRAME_INTERVAL + 1)
		}

		// Should be back at first frame after completing full cycles
		expect(lastFrame()).toContain(ANIMATION_FRAMES[0])

		// Advance one more frame
		await vi.advanceTimersByTimeAsync(FRAME_INTERVAL + 1)
		expect(lastFrame()).toContain(ANIMATION_FRAMES[1])
	})
})
