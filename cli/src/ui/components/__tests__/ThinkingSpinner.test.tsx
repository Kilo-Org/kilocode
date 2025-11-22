/**
 * Tests for ThinkingSpinner component
 */

import React from "react"
import { render } from "ink-testing-library"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { ThinkingSpinner } from "../ThinkingSpinner.js"

// Mock timers for animation
vi.useFakeTimers()

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

describe("ThinkingSpinner", () => {
	beforeEach(() => {
		vi.clearAllTimers()
	})

	afterEach(() => {
		vi.clearAllTimers()
	})

	it("should render with default gray color", () => {
		const { lastFrame } = render(<ThinkingSpinner />)
		const output = lastFrame()
		expect(output).toContain("Thinking...")
	})

	it("should render with custom color", () => {
		const { lastFrame } = render(<ThinkingSpinner color="blue" />)
		const output = lastFrame()
		expect(output).toContain("Thinking...")
	})

	it("should display initial spinner frame", () => {
		const { lastFrame } = render(<ThinkingSpinner />)
		const output = lastFrame()
		// Should contain the first frame (⠋) and "Thinking..."
		expect(output).toContain(SPINNER_FRAMES[0])
		expect(output).toContain("Thinking...")
	})

	it("should animate through frames on interval", () => {
		const { lastFrame, rerender } = render(<ThinkingSpinner />)

		let output = lastFrame()
		expect(output).toContain(SPINNER_FRAMES[0])

		// Advance animation by one frame (80ms)
		vi.advanceTimersByTime(80)
		rerender(<ThinkingSpinner />)
		output = lastFrame()
		expect(output).toContain(SPINNER_FRAMES[1])

		// Advance animation by another frame
		vi.advanceTimersByTime(80)
		rerender(<ThinkingSpinner />)
		output = lastFrame()
		expect(output).toContain(SPINNER_FRAMES[2])
	})

	it("should cycle through all frames and restart", () => {
		const { lastFrame, rerender } = render(<ThinkingSpinner />)

		// Cycle through all frames
		for (let i = 0; i < SPINNER_FRAMES.length; i++) {
			const output = lastFrame()
			expect(output).toContain(SPINNER_FRAMES[i])
			vi.advanceTimersByTime(80)
			rerender(<ThinkingSpinner />)
		}

		// After cycling through all frames, should be back at the start
		const output = lastFrame()
		expect(output).toContain(SPINNER_FRAMES[0])
	})

	it("should clean up interval on unmount", () => {
		const { unmount } = render(<ThinkingSpinner />)
		const clearIntervalSpy = vi.spyOn(global, "clearInterval")

		unmount()

		expect(clearIntervalSpy).toHaveBeenCalled()
		clearIntervalSpy.mockRestore()
	})
})
