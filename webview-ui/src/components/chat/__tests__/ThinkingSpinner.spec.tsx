import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { ThinkingSpinner } from "../ThinkingSpinner"

describe("ThinkingSpinner", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.runOnlyPendingTimers()
		vi.useRealTimers()
	})

	it("renders with initial frame", () => {
		render(<ThinkingSpinner />)
		const element = screen.getByText(/Thinking/i)
		expect(element).toBeInTheDocument()
		expect(element.textContent).toContain("⠋ Thinking...")
	})

	it("animates through frames", async () => {
		render(<ThinkingSpinner />)
		const element = screen.getByText(/Thinking/i)

		// Initial frame should be ⠋
		expect(element.textContent).toBe("⠋ Thinking...")

		// Advance by one animation interval (80ms)
		await vi.advanceTimersByTimeAsync(80)
		expect(element.textContent).toBe("⠙ Thinking...")

		// Advance by another interval
		await vi.advanceTimersByTimeAsync(80)
		expect(element.textContent).toBe("⠹ Thinking...")
	})

	it("cycles through all frames", async () => {
		render(<ThinkingSpinner />)
		const element = screen.getByText(/Thinking/i)
		const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

		// Advance through all frames
		for (let i = 0; i < SPINNER_FRAMES.length; i++) {
			expect(element.textContent).toContain(SPINNER_FRAMES[i])
			if (i < SPINNER_FRAMES.length - 1) {
				await vi.advanceTimersByTimeAsync(80)
			}
		}

		// Advance one more time to wrap around
		await vi.advanceTimersByTimeAsync(80)
		expect(element.textContent).toContain(SPINNER_FRAMES[0])
	})

	it("accepts className prop", () => {
		render(<ThinkingSpinner className="text-blue-500" />)
		const element = screen.getByText(/Thinking/i)
		expect(element).toHaveClass("text-blue-500")
	})

	it("cleans up interval on unmount", () => {
		const clearIntervalSpy = vi.spyOn(global, "clearInterval")
		const { unmount } = render(<ThinkingSpinner />)

		unmount()

		expect(clearIntervalSpy).toHaveBeenCalled()
		clearIntervalSpy.mockRestore()
	})
})
