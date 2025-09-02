import { describe, it, expect } from "vitest"
import { convertHtmlToSvg, calculateTipDimensions, type SvgConversionOptions } from "../HtmlToSvgRenderer"
import { type ThemeColors } from "../CodeHighlighter"

describe("HtmlToSvgConverter", () => {
	describe("calculateTipDimensions", () => {
		it("should calculate dimensions for single line text", () => {
			const text = "const x = 42;"
			const fontSize = 14
			const lineHeight = 1.2

			const result = calculateTipDimensions(text, fontSize, lineHeight)

			expect(result.width).toBeGreaterThan(0)
			expect(result.height).toBeGreaterThan(0)
			expect(result.width).toBeGreaterThan(result.height)
		})

		it("should calculate dimensions for multi-line text", () => {
			const text = "const x = 42;\nconst y = 24;\nconst z = x + y;"
			const fontSize = 14
			const lineHeight = 1.2

			const result = calculateTipDimensions(text, fontSize, lineHeight)

			expect(result.width).toBeGreaterThan(0)
			// The height should be exactly 3 lines worth, accounting for Math.round()
			const expectedHeight = Math.round(fontSize * lineHeight * 3)
			expect(result.height).toBe(expectedHeight)
		})

		it("should handle empty text", () => {
			const text = ""
			const fontSize = 14
			const lineHeight = 1.2

			const result = calculateTipDimensions(text, fontSize, lineHeight)

			expect(result.width).toBeGreaterThan(0) // Should have minimum width
			expect(result.height).toBeGreaterThan(0)
		})

		it("should handle different font sizes", () => {
			const text = "const x = 42; const y = 24; const z = x + y; // This is a longer line to exceed minimum width"
			const smallFontSize = 10
			const largeFontSize = 20
			const lineHeight = 1.2

			const smallResult = calculateTipDimensions(text, smallFontSize, lineHeight)
			const largeResult = calculateTipDimensions(text, largeFontSize, lineHeight)

			expect(largeResult.width).toBeGreaterThan(smallResult.width)
			expect(largeResult.height).toBeGreaterThan(smallResult.height)
		})

		it("should calculate correct height with line height multiplier", () => {
			const text = "line1\nline2\nline3"
			const fontSize = 14
			const lineHeight = 1.5 // Multiplier

			const result = calculateTipDimensions(text, fontSize, lineHeight)

			// Expected height: 3 lines * (14px * 1.5) = 3 * 21 = 63px
			const expectedHeight = 3 * (fontSize * lineHeight)
			expect(result.height).toBe(Math.round(expectedHeight))
		})

		it("should handle single line with custom line height", () => {
			const text = "single line"
			const fontSize = 16
			const lineHeight = 1.8

			const result = calculateTipDimensions(text, fontSize, lineHeight)

			// Expected height: 1 line * (16px * 1.8) = 28.8px rounded = 29px
			const expectedHeight = fontSize * lineHeight
			expect(result.height).toBe(Math.round(expectedHeight))
		})
	})

	describe("convertHtmlToSvg", () => {
		const mockThemeColors: ThemeColors = {
			background: "#1e1e1e",
			foreground: "#d4d4d4",
			modifiedBackground: "#28a74530",
			border: "#3c3c3c",
		}

		const defaultOptions: SvgConversionOptions = {
			width: 300,
			height: 100,
			fontSize: 14,
			fontFamily: "Consolas, monospace",
			lineHeight: 1.2,
		}

		it("should convert simple HTML to SVG", () => {
			const html = "<pre><code>const x = 42;</code></pre>"

			const result = convertHtmlToSvg(html, defaultOptions, mockThemeColors)

			expect(result).toContain("<svg")
			expect(result).toContain('width="300"')
			expect(result).toContain('height="100"')
			expect(result).toContain(mockThemeColors.background)
			expect(result).toContain("const x = 42;")
		})

		it("should handle HTML with styling", () => {
			const html =
				'<pre><code><span style="color: #569cd6;">const</span> x = <span style="color: #b5cea8;">42</span>;</code></pre>'

			const result = convertHtmlToSvg(html, defaultOptions, mockThemeColors)

			expect(result).toContain("<svg")
			expect(result).toContain("const")
			expect(result).toContain("42")
		})

		it("should handle empty HTML", () => {
			const html = ""

			const result = convertHtmlToSvg(html, defaultOptions, mockThemeColors)

			expect(result).toContain("<svg")
			expect(result).toContain('width="300"')
			expect(result).toContain('height="100"')
		})

		it("should handle malformed HTML gracefully", () => {
			const html = "<pre><code>const x = 42;<unclosed-tag>"

			const result = convertHtmlToSvg(html, defaultOptions, mockThemeColors)

			expect(result).toContain("<svg")
			expect(result).toContain("const x = 42;")
		})

		it("should respect font family and size options", () => {
			const html = "<pre><code>const x = 42;</code></pre>"
			const customOptions: SvgConversionOptions = {
				...defaultOptions,
				fontSize: 16,
				fontFamily: "Monaco, monospace",
			}

			const result = convertHtmlToSvg(html, customOptions, mockThemeColors)

			expect(result).toContain('font-size="16px"')
			expect(result).toContain("Monaco, monospace")
		})

		it("should handle diff highlighting classes", () => {
			const html = '<pre><code><span class="diff-add">+ const x = 42;</span></code></pre>'

			const result = convertHtmlToSvg(html, defaultOptions, mockThemeColors)

			expect(result).toContain("<svg")
			expect(result).toContain("const x = 42;")
		})

		it("should escape special characters in SVG", () => {
			const html = '<pre><code>const str = "Hello &amp; &lt;world&gt;";</code></pre>'

			const result = convertHtmlToSvg(html, defaultOptions, mockThemeColors)

			expect(result).toContain("&amp;")
			expect(result).toContain("&lt;")
			expect(result).toContain("&gt;")
			expect(result).toContain("&quot;")
		})
	})
})
