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
			expect(result).toMatchInlineSnapshot(`
					"<svg xmlns="http://www.w3.org/2000/svg" width="400" height="20" shape-rendering="crispEdges">
			<g>
				<rect x="0" y="0" rx="10" ry="10" width="400" height="20" fill="#1e1e1e" shape-rendering="crispEdges" />
				<rect x="0" y="0" width="100%" height="20" fill="#1e1e1e" shape-rendering="crispEdges" />
				<rect x="75.60000000000001" y="0" width="33.6" height="20" fill="rgba(107, 166, 205, 0.2)" shape-rendering="crispEdges" />
				<text x="0" y="10" font-family="monospace" font-size="14" xml:space="preserve" dominant-baseline="central" shape-rendering="crispEdges"><tspan xml:space="preserve" fill="#569CD6">function</tspan><tspan xml:space="preserve" fill="#D4D4D4"> </tspan><tspan xml:space="preserve" fill="#DCDCAA">test</tspan><tspan xml:space="preserve" fill="#D4D4D4">() { </tspan><tspan xml:space="preserve" fill="#C586C0">return</tspan><tspan xml:space="preserve" fill="#D4D4D4"> </tspan><tspan xml:space="preserve" fill="#CE9178">&quot;hello&quot;</tspan><tspan xml:space="preserve" fill="#D4D4D4">; }</tspan></text>
			</g>
		</svg>"`)
		})
	})
})
