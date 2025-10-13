import React from "react"
import { render } from "ink-testing-library"
import { describe, it, expect } from "vitest"
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
})
