/**
 * Tests for HotkeyBadge component
 */

import React from "react"
import { render } from "ink-testing-library"
import { describe, it, expect } from "vitest"
import { HotkeyBadge } from "../HotkeyBadge.js"

describe("HotkeyBadge", () => {
	it("should render keys and description", () => {
		const { lastFrame } = render(<HotkeyBadge keys="Ctrl+C" description="to cancel" />)

		const output = lastFrame()
		expect(output).toContain("Ctrl+C")
		expect(output).toContain("to cancel")
	})

	it("should render with primary styling", () => {
		const { lastFrame } = render(<HotkeyBadge keys="Enter" description="to submit" primary={true} />)

		const output = lastFrame()
		expect(output).toContain("Enter")
		expect(output).toContain("to submit")
	})

	it("should render without primary styling by default", () => {
		const { lastFrame } = render(<HotkeyBadge keys="Esc" description="to cancel" />)

		const output = lastFrame()
		expect(output).toContain("Esc")
		expect(output).toContain("to cancel")
	})

	it("should handle complex key combinations", () => {
		const { lastFrame } = render(<HotkeyBadge keys="Cmd+Shift+P" description="to open palette" />)

		const output = lastFrame()
		expect(output).toContain("Cmd+Shift+P")
		expect(output).toContain("to open palette")
	})
})
