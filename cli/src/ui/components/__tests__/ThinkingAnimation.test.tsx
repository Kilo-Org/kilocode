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
const ANIMATION_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const
const FRAME_INTERVAL = 80
const TIMER_STEP = FRAME_INTERVAL + 1

type AnimationFrame = (typeof ANIMATION_FRAMES)[number]

const getDisplayedFrame = (frameText: string | undefined): AnimationFrame | undefined =>
	ANIMATION_FRAMES.find((frame) => frameText?.includes(frame))

const advanceUntilFrame = async (
	lastFrame: () => string | undefined,
	expectedFrame: AnimationFrame,
	maxSteps: number = ANIMATION_FRAMES.length + 2
) => {
	for (let i = 0; i < maxSteps; i++) {
		await vi.advanceTimersByTimeAsync(TIMER_STEP)
		if (lastFrame()?.includes(expectedFrame)) return
	}

	expect(lastFrame()).toContain(expectedFrame)
}

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

		// useEffect can schedule the interval after a short delay, so don't assume tick 1 starts at t=0
		await advanceUntilFrame(lastFrame, ANIMATION_FRAMES[1])
		await advanceUntilFrame(lastFrame, ANIMATION_FRAMES[2])
		await advanceUntilFrame(lastFrame, ANIMATION_FRAMES[3])
	})

	it("should loop back to first frame after completing cycle", async () => {
		const { lastFrame } = render(<ThinkingAnimation />)

		// Ensure the interval has started ticking before asserting about looping
		await advanceUntilFrame(lastFrame, ANIMATION_FRAMES[1])

		// After reaching frame[1], it should loop back to frame[0] within one cycle
		await advanceUntilFrame(lastFrame, ANIMATION_FRAMES[0], ANIMATION_FRAMES.length)

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

		// Wait for at least one tick so we know the interval is active
		await advanceUntilFrame(lastFrame, ANIMATION_FRAMES[1])

		const seenFrames = new Set<string>()
		for (let i = 0; i < ANIMATION_FRAMES.length * 2; i++) {
			await vi.advanceTimersByTimeAsync(TIMER_STEP)
			const frame = getDisplayedFrame(lastFrame())
			if (frame) seenFrames.add(frame)
		}

		// If it keeps animating, we should observe multiple distinct frames over time
		expect(seenFrames.size).toBeGreaterThan(3)
	})
})
