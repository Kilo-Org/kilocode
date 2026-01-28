import { render } from "ink-testing-library"

import type { Toast } from "../../hooks/useToast.js"
import ToastDisplay from "../ToastDisplay.js"

describe("ToastDisplay", () => {
	it("should render nothing when toast is null", () => {
		const { lastFrame } = render(<ToastDisplay toast={null} />)

		expect(lastFrame()).toBe("")
	})

	it("should render info toast with cyan color and info icon", () => {
		const toast: Toast = {
			id: "test-1",
			message: "Info message",
			type: "info",
			duration: 3000,
			createdAt: Date.now(),
		}

		const { lastFrame } = render(<ToastDisplay toast={toast} />)

		expect(lastFrame()).toContain("Info message")
		expect(lastFrame()).toContain("ℹ")
	})

	it("should render success toast with success icon", () => {
		const toast: Toast = {
			id: "test-2",
			message: "Success message",
			type: "success",
			duration: 3000,
			createdAt: Date.now(),
		}

		const { lastFrame } = render(<ToastDisplay toast={toast} />)

		expect(lastFrame()).toContain("Success message")
		expect(lastFrame()).toContain("✓")
	})

	it("should render warning toast with warning icon", () => {
		const toast: Toast = {
			id: "test-3",
			message: "Warning message",
			type: "warning",
			duration: 3000,
			createdAt: Date.now(),
		}

		const { lastFrame } = render(<ToastDisplay toast={toast} />)

		expect(lastFrame()).toContain("Warning message")
		expect(lastFrame()).toContain("⚠")
	})

	it("should render error toast with error icon", () => {
		const toast: Toast = {
			id: "test-4",
			message: "Error message",
			type: "error",
			duration: 3000,
			createdAt: Date.now(),
		}

		const { lastFrame } = render(<ToastDisplay toast={toast} />)

		expect(lastFrame()).toContain("Error message")
		expect(lastFrame()).toContain("✗")
	})

	it("should display the full message", () => {
		const toast: Toast = {
			id: "test-5",
			message: "Switched to Code mode",
			type: "info",
			duration: 2000,
			createdAt: Date.now(),
		}

		const { lastFrame } = render(<ToastDisplay toast={toast} />)

		expect(lastFrame()).toContain("Switched to Code mode")
	})
})
