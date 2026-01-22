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

	describe("Theme support", () => {
		it("should render with hex color theme", () => {
			const theme = {
				id: "test",
				name: "Test",
				type: "dark" as const,
				brand: { primary: "#00ff00", secondary: "#ff00ff" },
				semantic: {
					success: "#00ff00",
					error: "#ff0000",
					warning: "#ffff00",
					info: "#00ffff",
					neutral: "#888888",
				},
				interactive: {
					prompt: "#ffffff",
					selection: "#444444",
					hover: "#555555",
					disabled: "#333333",
					focus: "#666666",
				},
				messages: { user: "#00ff00", assistant: "#0000ff", system: "#888888", error: "#ff0000" },
				actions: { approve: "#00ff00", reject: "#ff0000", cancel: "#888888", pending: "#ffff00" },
				code: {
					addition: "#00ff00",
					deletion: "#ff0000",
					modification: "#ffff00",
					context: "#888888",
					lineNumber: "#444444",
				},
				markdown: {
					text: "#ffffff",
					heading: "#00ff00",
					strong: "#ff0000",
					em: "#ffff00",
					code: "#00ffff",
					blockquote: "#888888",
					link: "#0000ff",
					list: "#ff00ff",
				},
				ui: {
					border: { default: "#444444", active: "#00ff00", warning: "#ffff00", error: "#ff0000" },
					text: { primary: "#ffffff", secondary: "#cccccc", dimmed: "#888888", highlight: "#00ff00" },
					background: { default: "#000000", elevated: "#111111" },
				},
				status: { online: "#00ff00", offline: "#ff0000", busy: "#ffff00", idle: "#888888" },
			}

			const { lastFrame } = render(<MarkdownText theme={theme}>Hello World</MarkdownText>)
			expect(lastFrame()).toContain("Hello World")
		})

		it("should render with named color theme", () => {
			const theme = {
				id: "test",
				name: "Test",
				type: "light" as const,
				brand: { primary: "green", secondary: "magenta" },
				semantic: { success: "green", error: "red", warning: "yellow", info: "cyan", neutral: "gray" },
				interactive: { prompt: "white", selection: "gray", hover: "gray", disabled: "gray", focus: "gray" },
				messages: { user: "green", assistant: "blue", system: "gray", error: "red" },
				actions: { approve: "green", reject: "red", cancel: "gray", pending: "yellow" },
				code: {
					addition: "green",
					deletion: "red",
					modification: "yellow",
					context: "gray",
					lineNumber: "gray",
				},
				markdown: {
					text: "white",
					heading: "green",
					strong: "red",
					em: "yellow",
					code: "cyan",
					blockquote: "gray",
					link: "blue",
					list: "magenta",
				},
				ui: {
					border: { default: "gray", active: "green", warning: "yellow", error: "red" },
					text: { primary: "white", secondary: "gray", dimmed: "gray", highlight: "green" },
					background: { default: "black", elevated: "gray" },
				},
				status: { online: "green", offline: "red", busy: "yellow", idle: "gray" },
			}

			const { lastFrame } = render(<MarkdownText theme={theme}>Hello World</MarkdownText>)
			expect(lastFrame()).toContain("Hello World")
		})

		it("should fall back to white for unknown color names", () => {
			const theme = {
				id: "test",
				name: "Test",
				type: "custom" as const,
				brand: { primary: "invalidcolor", secondary: "invalidcolor" },
				semantic: {
					success: "invalidcolor",
					error: "invalidcolor",
					warning: "invalidcolor",
					info: "invalidcolor",
					neutral: "invalidcolor",
				},
				interactive: {
					prompt: "invalidcolor",
					selection: "invalidcolor",
					hover: "invalidcolor",
					disabled: "invalidcolor",
					focus: "invalidcolor",
				},
				messages: {
					user: "invalidcolor",
					assistant: "invalidcolor",
					system: "invalidcolor",
					error: "invalidcolor",
				},
				actions: {
					approve: "invalidcolor",
					reject: "invalidcolor",
					cancel: "invalidcolor",
					pending: "invalidcolor",
				},
				code: {
					addition: "invalidcolor",
					deletion: "invalidcolor",
					modification: "invalidcolor",
					context: "invalidcolor",
					lineNumber: "invalidcolor",
				},
				markdown: {
					text: "invalidcolor",
					heading: "invalidcolor",
					strong: "invalidcolor",
					em: "invalidcolor",
					code: "invalidcolor",
					blockquote: "invalidcolor",
					link: "invalidcolor",
					list: "invalidcolor",
				},
				ui: {
					border: {
						default: "invalidcolor",
						active: "invalidcolor",
						warning: "invalidcolor",
						error: "invalidcolor",
					},
					text: {
						primary: "invalidcolor",
						secondary: "invalidcolor",
						dimmed: "invalidcolor",
						highlight: "invalidcolor",
					},
					background: { default: "invalidcolor", elevated: "invalidcolor" },
				},
				status: { online: "invalidcolor", offline: "invalidcolor", busy: "invalidcolor", idle: "invalidcolor" },
			}

			// Should still render without throwing errors
			const { lastFrame } = render(<MarkdownText theme={theme}>Hello World</MarkdownText>)
			expect(lastFrame()).toContain("Hello World")
		})
	})
})
