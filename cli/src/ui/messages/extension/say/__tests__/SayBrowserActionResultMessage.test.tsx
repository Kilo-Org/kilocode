import React from "react"
import { render } from "ink-testing-library"
import { describe, it, expect } from "vitest"
import { SayBrowserActionResultMessage } from "../SayBrowserActionResultMessage.js"
import type { ExtensionChatMessage } from "../../../../../types/messages.js"

describe("SayBrowserActionResultMessage", () => {
	const baseMessage: ExtensionChatMessage = {
		ts: Date.now(),
		type: "say",
		say: "browser_action_result",
	}

	it("should display header for browser action result", () => {
		const { lastFrame } = render(
			<SayBrowserActionResultMessage
				message={{
					...baseMessage,
					text: JSON.stringify({ screenshot: "data:image/png;base64,abc123" }),
				}}
			/>,
		)
		expect(lastFrame()).toContain("Browser Action Result")
	})

	it("should show screenshot indicator instead of base64 data", () => {
		const browserResult = {
			screenshot: "data:image/webp;base64,UklGRn44AABXRUJQVlA4...", // Simulated base64 data
			logs: "",
			currentUrl: "https://example.com",
			viewportWidth: 1280,
			viewportHeight: 800,
		}

		const { lastFrame } = render(
			<SayBrowserActionResultMessage
				message={{
					...baseMessage,
					text: JSON.stringify(browserResult),
				}}
			/>,
		)

		const output = lastFrame()

		// Should show screenshot indicator
		expect(output).toContain("Screenshot captured")

		// Should NOT contain the base64 data
		expect(output).not.toContain("UklGRn44AABXRUJQVlA4")
		expect(output).not.toContain("data:image")

		// Should show URL
		expect(output).toContain("https://example.com")

		// Should show viewport
		expect(output).toContain("1280x800")
	})

	it("should display console logs when present", () => {
		const browserResult = {
			logs: "Console: Hello from the page\nError: Something went wrong",
		}

		const { lastFrame } = render(
			<SayBrowserActionResultMessage
				message={{
					...baseMessage,
					text: JSON.stringify(browserResult),
				}}
			/>,
		)

		const output = lastFrame()
		expect(output).toContain("Console logs:")
		expect(output).toContain("Hello from the page")
		expect(output).toContain("Something went wrong")
	})

	it("should display cursor position when present", () => {
		const browserResult = {
			currentMousePosition: "500,300",
		}

		const { lastFrame } = render(
			<SayBrowserActionResultMessage
				message={{
					...baseMessage,
					text: JSON.stringify(browserResult),
				}}
			/>,
		)

		expect(lastFrame()).toContain("Cursor: 500,300")
	})

	it("should handle empty result gracefully", () => {
		const { lastFrame } = render(
			<SayBrowserActionResultMessage
				message={{
					...baseMessage,
					text: JSON.stringify({}),
				}}
			/>,
		)

		expect(lastFrame()).toContain("Browser action completed")
	})

	it("should handle invalid JSON gracefully", () => {
		const { lastFrame } = render(
			<SayBrowserActionResultMessage
				message={{
					...baseMessage,
					text: "not valid json",
				}}
			/>,
		)

		expect(lastFrame()).toContain("Browser action completed")
	})

	it("should handle missing text gracefully", () => {
		const { lastFrame } = render(
			<SayBrowserActionResultMessage
				message={{
					...baseMessage,
					text: undefined,
				}}
			/>,
		)

		expect(lastFrame()).toContain("Browser action completed")
	})

	it("should not show logs section when logs are empty", () => {
		const browserResult = {
			screenshot: "data:image/png;base64,abc",
			logs: "",
		}

		const { lastFrame } = render(
			<SayBrowserActionResultMessage
				message={{
					...baseMessage,
					text: JSON.stringify(browserResult),
				}}
			/>,
		)

		expect(lastFrame()).not.toContain("Console logs:")
	})

	it("should not show logs section when logs are only whitespace", () => {
		const browserResult = {
			screenshot: "data:image/png;base64,abc",
			logs: "   \n\t  ",
		}

		const { lastFrame } = render(
			<SayBrowserActionResultMessage
				message={{
					...baseMessage,
					text: JSON.stringify(browserResult),
				}}
			/>,
		)

		expect(lastFrame()).not.toContain("Console logs:")
	})

	it("should display all available info together", () => {
		const browserResult = {
			screenshot: "data:image/png;base64,abc123",
			logs: "Page loaded",
			currentUrl: "https://test.com/page",
			currentMousePosition: "100,200",
			viewportWidth: 1920,
			viewportHeight: 1080,
		}

		const { lastFrame } = render(
			<SayBrowserActionResultMessage
				message={{
					...baseMessage,
					text: JSON.stringify(browserResult),
				}}
			/>,
		)

		const output = lastFrame()
		expect(output).toContain("Screenshot captured")
		expect(output).toContain("https://test.com/page")
		expect(output).toContain("1920x1080")
		expect(output).toContain("100,200")
		expect(output).toContain("Page loaded")
	})
})
