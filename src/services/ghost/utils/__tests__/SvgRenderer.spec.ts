import { describe, it, expect, beforeAll, vi } from "vitest"

// Mock VSCode API
vi.mock("vscode", () => ({
	window: {
		activeTextEditor: undefined,
		activeColorTheme: {
			kind: 2, // Dark theme
		},
	},
	ColorThemeKind: {
		Light: 1,
		Dark: 2,
		HighContrast: 3,
		HighContrastLight: 4,
	},
	Range: class {
		constructor(
			public start: { line: number; character: number },
			public end: { line: number; character: number },
		) {}
	},
	Position: class {
		constructor(
			public line: number,
			public character: number,
		) {}
	},
}))

import { generateCodeSVG, type SVGRenderOptions } from "../SvgRenderer"
import { initializeHighlighter, type DiffLine } from "../CodeHighlighter"

describe("SvgRenderer", () => {
	beforeAll(async () => {
		await initializeHighlighter()
	})

	const defaultOptions: SVGRenderOptions = {
		fontSize: 14,
		fontFamily: "Consolas, monospace",
		dimensions: { width: 300, height: 100 },
		lineHeight: 1.2,
	}

	describe("generateCodeSVG", () => {
		it("should generate SVG data URI for simple code", async () => {
			const text = "const x = 42;"
			const language = "typescript"
			const currLineOffsetFromTop = 0
			const newDiffLines: DiffLine[] = []

			const result = await generateCodeSVG(text, language, defaultOptions, currLineOffsetFromTop, newDiffLines)

			expect(result).toMatch(/^data:image\/svg\+xml;base64,/)

			// Decode and check SVG content
			const base64Data = result.replace("data:image/svg+xml;base64,", "")
			const svgContent = Buffer.from(base64Data, "base64").toString("utf-8")

			expect(svgContent).toContain("<svg")
			expect(svgContent).toContain('width="300"')
			expect(svgContent).toContain('height="100"')
		})

		it("should generate SVG with diff highlighting", async () => {
			const text = "const x = 42;\nconst y = 24;"
			const language = "typescript"
			const currLineOffsetFromTop = 0
			const newDiffLines: DiffLine[] = [
				{ type: "new", line: "const x = 42;" },
				{ type: "new", line: "const y = 24;" },
			]

			const result = await generateCodeSVG(text, language, defaultOptions, currLineOffsetFromTop, newDiffLines)

			expect(result).toMatch(/^data:image\/svg\+xml;base64,/)

			// Decode and check SVG content
			const base64Data = result.replace("data:image/svg+xml;base64,", "")
			const svgContent = Buffer.from(base64Data, "base64").toString("utf-8")

			expect(svgContent).toContain("<svg")
			expect(svgContent).toContain("const")
		})

		it("should handle different languages", async () => {
			const testCases = [
				{ text: "console.log('hello');", language: "javascript" },
				{ text: "print('hello')", language: "python" },
				{ text: 'System.out.println("hello");', language: "java" },
				{ text: "echo 'hello'", language: "bash" },
			]

			for (const testCase of testCases) {
				const result = await generateCodeSVG(testCase.text, testCase.language, defaultOptions, 0, [])

				expect(result).toMatch(/^data:image\/svg\+xml;base64,/)

				const base64Data = result.replace("data:image/svg+xml;base64,", "")
				const svgContent = Buffer.from(base64Data, "base64").toString("utf-8")

				expect(svgContent).toContain("<svg")
			}
		})

		it("should handle empty text", async () => {
			const text = ""
			const language = "typescript"
			const currLineOffsetFromTop = 0
			const newDiffLines: DiffLine[] = []

			const result = await generateCodeSVG(text, language, defaultOptions, currLineOffsetFromTop, newDiffLines)

			expect(result).toMatch(/^data:image\/svg\+xml;base64,/)

			const base64Data = result.replace("data:image/svg+xml;base64,", "")
			const svgContent = Buffer.from(base64Data, "base64").toString("utf-8")

			expect(svgContent).toContain("<svg")
		})

		it("should handle different dimensions", async () => {
			const text = "const x = 42;"
			const language = "typescript"
			const currLineOffsetFromTop = 0
			const newDiffLines: DiffLine[] = []

			const customOptions: SVGRenderOptions = {
				...defaultOptions,
				dimensions: { width: 500, height: 200 },
			}

			const result = await generateCodeSVG(text, language, customOptions, currLineOffsetFromTop, newDiffLines)

			expect(result).toMatch(/^data:image\/svg\+xml;base64,/)

			const base64Data = result.replace("data:image/svg+xml;base64,", "")
			const svgContent = Buffer.from(base64Data, "base64").toString("utf-8")

			expect(svgContent).toContain('width="500"')
			expect(svgContent).toContain('height="200"')
		})

		it("should handle different font settings", async () => {
			const text = "const x = 42;"
			const language = "typescript"
			const currLineOffsetFromTop = 0
			const newDiffLines: DiffLine[] = []

			const customOptions: SVGRenderOptions = {
				...defaultOptions,
				fontSize: 16,
				fontFamily: "Monaco, monospace",
			}

			const result = await generateCodeSVG(text, language, customOptions, currLineOffsetFromTop, newDiffLines)

			expect(result).toMatch(/^data:image\/svg\+xml;base64,/)

			const base64Data = result.replace("data:image/svg+xml;base64,", "")
			const svgContent = Buffer.from(base64Data, "base64").toString("utf-8")

			expect(svgContent).toContain('font-size="16px"')
			expect(svgContent).toContain("Monaco, monospace")
		})

		it("should handle mixed diff types", async () => {
			const text = "const x = 42;\nconst y = 24;\nconst z = x + y;"
			const language = "typescript"
			const currLineOffsetFromTop = 0
			const newDiffLines: DiffLine[] = [
				{ type: "new", line: "const x = 42;" },
				{ type: "same", line: "const y = 24;" },
				{ type: "old", line: "const z = x + y;" },
			]

			const result = await generateCodeSVG(text, language, defaultOptions, currLineOffsetFromTop, newDiffLines)

			expect(result).toMatch(/^data:image\/svg\+xml;base64,/)

			const base64Data = result.replace("data:image/svg+xml;base64,", "")
			const svgContent = Buffer.from(base64Data, "base64").toString("utf-8")

			expect(svgContent).toContain("<svg")
			expect(svgContent).toContain("const")
		})

		it("should handle special characters in code", async () => {
			const text = 'const str = "Hello & <world>";'
			const language = "typescript"
			const currLineOffsetFromTop = 0
			const newDiffLines: DiffLine[] = []

			const result = await generateCodeSVG(text, language, defaultOptions, currLineOffsetFromTop, newDiffLines)

			expect(result).toMatch(/^data:image\/svg\+xml;base64,/)

			const base64Data = result.replace("data:image/svg+xml;base64,", "")
			const svgContent = Buffer.from(base64Data, "base64").toString("utf-8")

			expect(svgContent).toContain("<svg")
			// Special characters should be escaped in SVG
			expect(svgContent).toContain("&amp;")
			expect(svgContent).toContain("&lt;")
			expect(svgContent).toContain("&gt;")
		})
	})
})
