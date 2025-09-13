import { describe, it, expect, beforeAll, vi } from "vitest"

// Mock vscode module
vi.mock("vscode", () => ({
	window: {
		activeColorTheme: {
			kind: 1, // Dark theme
		},
	},
	workspace: {
		getConfiguration: vi.fn(() => ({
			get: vi.fn((key: string) => {
				if (key === "workbench.colorTheme") return "Dark+ (default dark)"
				return undefined
			}),
		})),
	},
	ColorThemeKind: {
		Dark: 1,
		Light: 2,
	},
}))

import { SvgRenderer } from "../SvgRenderer"
import { initializeHighlighter, generateHighlightedHtmlWithRanges } from "../CodeHighlighter"
import { getThemeColors } from "../ThemeMapper"
import { type BackgroundRange } from "../CharacterDiff"

describe("SvgRenderer", () => {
	beforeAll(async () => {
		await initializeHighlighter()
	})

	describe("Integration with CodeHighlighter", () => {
		it("should work with highlighted HTML from CodeHighlighter", async () => {
			const code = 'function test() { return "hello"; }'
			const backgroundRanges: BackgroundRange[] = [
				{ start: 9, end: 13, type: "added" }, // highlight 'test' as added
			]
			const themeColors = getThemeColors()

			const { html } = await generateHighlightedHtmlWithRanges(code, "typescript", backgroundRanges)
			const renderer = new SvgRenderer(html, {
				width: 400,
				height: 50,
				fontSize: 14,
				fontFamily: "monospace",
				fontWeight: "normal",
				letterSpacing: 0,
				lineHeight: 20,
				themeColors,
			})

			const result = renderer.render()

			expect(result).toContain("<svg")
			expect(result).toContain("function")
			expect(result).toContain("test")
			expect(result).toContain("hello")
		})
	})
})
