import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render } from "@testing-library/react"
import { BrailleSpinner } from "../BrailleSpinner"

describe("BrailleSpinner", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.runOnlyPendingTimers()
		vi.useRealTimers()
	})

	const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

	it("should render with initial frame", () => {
		const { container } = render(<BrailleSpinner />)
		const spinnerText = container.textContent

		expect(spinnerText).toBe(SPINNER_FRAMES[0])
	})

	it("should animate through frames on interval", () => {
		const { container, rerender } = render(<BrailleSpinner />)

		// Initial frame
		expect(container.textContent).toBe(SPINNER_FRAMES[0])

		// Advance animation by one frame (80ms)
		vi.advanceTimersByTime(80)
		rerender(<BrailleSpinner />)
		expect(container.textContent).toBe(SPINNER_FRAMES[1])

		// Advance another frame
		vi.advanceTimersByTime(80)
		rerender(<BrailleSpinner />)
		expect(container.textContent).toBe(SPINNER_FRAMES[2])
	})

	it("should loop back to first frame after last frame", () => {
		const { container, rerender } = render(<BrailleSpinner />)

		// Advance to last frame
		vi.advanceTimersByTime(80 * (SPINNER_FRAMES.length - 1))
		rerender(<BrailleSpinner />)
		expect(container.textContent).toBe(SPINNER_FRAMES[SPINNER_FRAMES.length - 1])

		// Advance one more time - should loop back to first frame
		vi.advanceTimersByTime(80)
		rerender(<BrailleSpinner />)
		expect(container.textContent).toBe(SPINNER_FRAMES[0])
	})

	it("should accept custom className", () => {
		const { container } = render(<BrailleSpinner className="custom-class" />)
		const span = container.querySelector("span")

		expect(span).toHaveClass("custom-class")
	})

	it("should cleanup interval on unmount", () => {
		const clearIntervalSpy = vi.spyOn(global, "clearInterval")

		const { unmount } = render(<BrailleSpinner />)
		unmount()

		expect(clearIntervalSpy).toHaveBeenCalled()
		clearIntervalSpy.mockRestore()
	})
})
