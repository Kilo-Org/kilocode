import React from "react"
import { render } from "ink-testing-library"
import { describe, it, expect, vi } from "vitest"
import { MarkdownText } from "../MarkdownText.js"

describe("MarkdownText", () => {
	it("should render plain text", () => {
		const { lastFrame } = render(<MarkdownText>Hello World</MarkdownText>)
		expect(lastFrame()).toContain("Hello World")
	})

	it("should render markdown headings", () => {
		const { lastFrame } = render(<MarkdownText># Heading 1</MarkdownText>)
		const output = lastFrame()
		expect(output).toBeTruthy()
		// Terminal renderer adds formatting, so we just check it's not empty
		expect(output?.length).toBeGreaterThan(0)
	})

	it("should render markdown bold text", () => {
		const { lastFrame } = render(<MarkdownText>**bold text**</MarkdownText>)
		const output = lastFrame()
		expect(output).toBeTruthy()
		expect(output?.length).toBeGreaterThan(0)
	})

	it("should render markdown italic text", () => {
		const { lastFrame } = render(<MarkdownText>*italic text*</MarkdownText>)
		const output = lastFrame()
		expect(output).toBeTruthy()
		expect(output?.length).toBeGreaterThan(0)
	})

	it("should render markdown code blocks", () => {
		const markdown = "```javascript\nconst x = 1;\n```"
		const { lastFrame } = render(<MarkdownText>{markdown}</MarkdownText>)
		const output = lastFrame()
		expect(output).toBeTruthy()
		expect(output?.length).toBeGreaterThan(0)
	})

	it("should render markdown inline code", () => {
		const { lastFrame } = render(<MarkdownText>`inline code`</MarkdownText>)
		const output = lastFrame()
		expect(output).toBeTruthy()
		expect(output?.length).toBeGreaterThan(0)
	})

	it("should render markdown lists", () => {
		const markdown = "- Item 1\n- Item 2\n- Item 3"
		const { lastFrame } = render(<MarkdownText>{markdown}</MarkdownText>)
		const output = lastFrame()
		expect(output).toBeTruthy()
		expect(output).toContain("Item 1")
		expect(output).toContain("Item 2")
		expect(output).toContain("Item 3")
	})

	it("should render markdown links", () => {
		const { lastFrame } = render(<MarkdownText>[Link](https://example.com)</MarkdownText>)
		const output = lastFrame()
		expect(output).toBeTruthy()
		expect(output).toContain("Link")
	})

	it("should return null for empty string", () => {
		const { lastFrame } = render(<MarkdownText>{""}</MarkdownText>)
		expect(lastFrame()).toBe("")
	})

	it("should return null for whitespace-only string", () => {
		const { lastFrame } = render(<MarkdownText>{"   "}</MarkdownText>)
		expect(lastFrame()).toBe("")
	})

	it("should handle complex markdown with multiple elements", () => {
		const markdown = `# Title

This is a paragraph with **bold** and *italic* text.

- List item 1
- List item 2

\`\`\`javascript
const code = "example";
\`\`\`

[Link](https://example.com)`

		const { lastFrame } = render(<MarkdownText>{markdown}</MarkdownText>)
		const output = lastFrame()
		expect(output).toBeTruthy()
		expect(output?.length).toBeGreaterThan(0)
	})

	it("should accept and pass through TerminalRendererOptions", () => {
		const { lastFrame } = render(
			<MarkdownText width={80} reflowText={true}>
				# Heading with custom options
			</MarkdownText>,
		)
		const output = lastFrame()
		expect(output).toBeTruthy()
		expect(output?.length).toBeGreaterThan(0)
	})

	it("should trim whitespace from rendered output", () => {
		const { lastFrame } = render(<MarkdownText>{"  \n\nHello\n\n  "}</MarkdownText>)
		const output = lastFrame()
		expect(output).toBeTruthy()
		// Should not start or end with excessive whitespace
		expect(output).toContain("Hello")
	})

	it("should handle markdown with special characters", () => {
		const markdown = 'Text with `<special>` & "characters"'
		const { lastFrame } = render(<MarkdownText>{markdown}</MarkdownText>)
		const output = lastFrame()
		expect(output).toBeTruthy()
		expect(output?.length).toBeGreaterThan(0)
	})

	it("should render blockquotes", () => {
		const markdown = "> This is a quote"
		const { lastFrame } = render(<MarkdownText>{markdown}</MarkdownText>)
		const output = lastFrame()
		expect(output).toBeTruthy()
		expect(output).toContain("This is a quote")
	})

	it("should render horizontal rules", () => {
		const markdown = "Before\n\n---\n\nAfter"
		const { lastFrame } = render(<MarkdownText>{markdown}</MarkdownText>)
		const output = lastFrame()
		expect(output).toBeTruthy()
		expect(output).toContain("Before")
		expect(output).toContain("After")
	})

	describe("Typewriter Effect", () => {
		it("should show initial content immediately", () => {
			const { lastFrame } = render(<MarkdownText>Hello World</MarkdownText>)

			// First render shows content immediately (initial state)
			const output = lastFrame()
			expect(output).toContain("Hello World")
		})

		it("should handle chunk-based updates (content appending)", async () => {
			vi.useFakeTimers()

			const { rerender, lastFrame } = render(<MarkdownText>Hello</MarkdownText>)

			// Let first chunk animate
			await vi.advanceTimersByTimeAsync(200)

			// Add new chunk
			rerender(<MarkdownText>Hello World</MarkdownText>)

			// Should continue animating from where it left off
			await vi.advanceTimersByTimeAsync(300)

			const output = lastFrame()
			expect(output).toBeTruthy()

			vi.useRealTimers()
		})

		it("should clear animation timer on unmount", async () => {
			vi.useFakeTimers()

			const { unmount } = render(<MarkdownText>Hello World</MarkdownText>)

			// Start animation
			await vi.advanceTimersByTimeAsync(50)

			// Unmount should cleanup
			unmount()

			// Advance timers - should not cause errors
			await vi.advanceTimersByTimeAsync(500)

			vi.useRealTimers()
		})

		it("should render markdown only on displayed text (not per character)", async () => {
			vi.useFakeTimers()

			const markdown = "**Hello** World"
			const { lastFrame } = render(<MarkdownText>{markdown}</MarkdownText>)

			// Let it animate partially
			await vi.advanceTimersByTimeAsync(100)

			// Should have some content with markdown applied to what's visible
			const output = lastFrame()
			expect(output).toBeTruthy()

			// Complete animation
			await vi.advanceTimersByTimeAsync(500)

			const final = lastFrame()
			expect(final).toBeTruthy()
			expect(final?.length).toBeGreaterThan(0)

			vi.useRealTimers()
		})

		it("should handle rapid sequential updates", async () => {
			vi.useFakeTimers()

			const { rerender, lastFrame } = render(<MarkdownText>A</MarkdownText>)

			await vi.advanceTimersByTimeAsync(20)

			// Rapid updates
			rerender(<MarkdownText>AB</MarkdownText>)
			await vi.advanceTimersByTimeAsync(20)

			rerender(<MarkdownText>ABC</MarkdownText>)
			await vi.advanceTimersByTimeAsync(20)

			rerender(<MarkdownText>ABCD</MarkdownText>)
			await vi.advanceTimersByTimeAsync(200)

			const output = lastFrame()
			expect(output).toBeTruthy()

			vi.useRealTimers()
		})

		it("should not animate if content hasn't changed", async () => {
			vi.useFakeTimers()

			const { rerender, lastFrame } = render(<MarkdownText>Hello</MarkdownText>)

			await vi.advanceTimersByTimeAsync(500)
			const frame1 = lastFrame()

			// Re-render with same content
			rerender(<MarkdownText>Hello</MarkdownText>)
			await vi.advanceTimersByTimeAsync(100)

			const frame2 = lastFrame()
			expect(frame2).toBe(frame1)

			vi.useRealTimers()
		})

		it("should handle markdown with code blocks during animation", async () => {
			vi.useFakeTimers()

			const markdown = "Text with `code` inside"
			const { lastFrame } = render(<MarkdownText>{markdown}</MarkdownText>)

			await vi.advanceTimersByTimeAsync(200)

			const mid = lastFrame()
			expect(mid).toBeTruthy()

			await vi.advanceTimersByTimeAsync(500)

			const final = lastFrame()
			expect(final).toContain("code")

			vi.useRealTimers()
		})

		it("should handle long content efficiently", async () => {
			vi.useFakeTimers()

			const longText = "A".repeat(100)
			const { lastFrame } = render(<MarkdownText>{longText}</MarkdownText>)

			// Should start animating
			await vi.advanceTimersByTimeAsync(100)

			const mid = lastFrame()
			expect(mid).toBeTruthy()
			expect(mid?.length || 0).toBeGreaterThan(0)

			// Complete animation
			await vi.advanceTimersByTimeAsync(2000)

			const final = lastFrame()
			expect(final?.length).toBeGreaterThanOrEqual(longText.length - 10) // Allow for formatting

			vi.useRealTimers()
		})
	})
})
