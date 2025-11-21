import { highlightHunks } from "../highlightDiff"
import { getHighlighter } from "../highlighter"

// Mock the highlighter
vi.mock("../highlighter", () => ({
	getHighlighter: vi.fn(),
}))

// Mock hast-util-to-jsx-runtime
vi.mock("hast-util-to-jsx-runtime", () => ({
	toJsxRuntime: vi.fn((node, _options) => {
		// Simple mock that returns a string representation
		if (node.children) {
			return node.children
				.map((child: any) => {
					if (child.type === "text") {
						return child.value
					}
					return `<span>${child.value || ""}</span>`
				})
				.join("")
		}
		return node.value || "highlighted-content"
	}),
}))

const mockHighlighter = {
	codeToHast: vi.fn((text: string, options: any) => ({
		children: [
			{
				children: [
					{
						tagName: "code",
						properties: { class: `hljs language-${options.lang}` },
						children: text.split("\n").map((line) => ({
							tagName: "span",
							properties: { className: ["line"] },
							children: [{ type: "text", value: `highlighted(${line})` }],
						})),
					},
				],
			},
		],
	})),
}

beforeEach(() => {
	vi.clearAllMocks()
	;(getHighlighter as any).mockResolvedValue(mockHighlighter)
})

describe("highlightHunks", () => {
	it("should highlight simple old and new text", async () => {
		const result = await highlightHunks(
			"const x = 1\nconsole.log(x)",
			"const x = 2\nconsole.log(x)",
			"javascript",
			"light",
		)

		expect(result.oldLines).toHaveLength(2)
		expect(result.newLines).toHaveLength(2)
		expect(getHighlighter).toHaveBeenCalledWith("javascript")
		expect(mockHighlighter.codeToHast).toHaveBeenCalledTimes(2)
	})

	it("should handle empty text", async () => {
		const result = await highlightHunks("", "", "javascript", "light")

		expect(result.oldLines).toEqual([""])
		expect(result.newLines).toEqual([""])
	})

	it("should handle single-line text", async () => {
		const result = await highlightHunks("const x = 1", "const x = 2", "javascript", "dark")

		expect(result.oldLines).toHaveLength(1)
		expect(result.newLines).toHaveLength(1)
		expect(mockHighlighter.codeToHast).toHaveBeenCalledWith(
			"const x = 1",
			expect.objectContaining({
				lang: "javascript",
				theme: "github-dark",
			}),
		)
	})

	it("should handle multi-line text with different lengths", async () => {
		const oldText = "line1\nline2\nline3"
		const newText = "line1\nmodified line2"

		const result = await highlightHunks(oldText, newText, "txt", "light")

		expect(result.oldLines).toHaveLength(3)
		expect(result.newLines).toHaveLength(2)
	})

	it("should map light theme to github-light", async () => {
		await highlightHunks("test", "test", "javascript", "light")

		expect(mockHighlighter.codeToHast).toHaveBeenCalledWith(
			"test",
			expect.objectContaining({
				theme: "github-light",
			}),
		)
	})

	it("should map dark theme to github-dark", async () => {
		await highlightHunks("test", "test", "javascript", "dark")

		expect(mockHighlighter.codeToHast).toHaveBeenCalledWith(
			"test",
			expect.objectContaining({
				theme: "github-dark",
			}),
		)
	})

	it("should use correct transformers", async () => {
		await highlightHunks("test", "test", "javascript", "light")

		expect(mockHighlighter.codeToHast).toHaveBeenCalledWith(
			"test",
			expect.objectContaining({
				transformers: expect.arrayContaining([
					expect.objectContaining({
						pre: expect.any(Function),
						code: expect.any(Function),
					}),
				]),
			}),
		)
	})

	it("should handle highlighting errors gracefully", async () => {
		mockHighlighter.codeToHast.mockImplementation(() => {
			throw new Error("Highlighting failed")
		})

		const result = await highlightHunks("const x = 1", "const x = 2", "javascript", "light")

		// Should fall back to plain text
		expect(result.oldLines).toEqual(["const x = 1"])
		expect(result.newLines).toEqual(["const x = 2"])
	})

	it("should handle getHighlighter rejection", async () => {
		;(getHighlighter as any).mockRejectedValueOnce(new Error("Highlighter failed"))

		const result = await highlightHunks("const x = 1", "const x = 2", "javascript", "light")

		// Should fall back to plain text
		expect(result.oldLines).toEqual(["const x = 1"])
		expect(result.newLines).toEqual(["const x = 2"])
	})

	it("should handle text with trailing newlines", async () => {
		const result = await highlightHunks("line1\nline2\n", "line1\nline2\n", "txt", "light")

		expect(result.oldLines).toHaveLength(3) // Including empty line from trailing newline
		expect(result.newLines).toHaveLength(3)
		// The empty line at the end is preserved as-is (performance optimization)
		expect(result.oldLines[2]).toBe("")
		expect(result.newLines[2]).toBe("")
	})

	it("should preserve whitespace-only lines", async () => {
		const result = await highlightHunks("line1\n   \nline3", "line1\n\t\nline3", "txt", "light")

		expect(result.oldLines).toHaveLength(3)
		expect(result.newLines).toHaveLength(3)
		// Whitespace-only lines are preserved as-is (performance optimization)
		expect(result.oldLines[1]).toBe("   ")
		expect(result.newLines[1]).toBe("\t")
	})
})

describe("integration scenarios", () => {
	it("should handle typical single hunk scenario", async () => {
		const oldText = "function hello() {\n  console.log('old')\n}"
		const newText = "function hello() {\n  console.log('new')\n}"

		const result = await highlightHunks(oldText, newText, "javascript", "light")

		expect(result.oldLines).toHaveLength(3)
		expect(result.newLines).toHaveLength(3)
		// Each line should be processed by the highlighter
		result.oldLines.forEach((line) => {
			expect(typeof line === "string" || typeof line === "object").toBe(true)
		})
	})

	it("should handle addition-only hunk", async () => {
		const oldText = ""
		const newText = "// New comment\nconst x = 1"

		const result = await highlightHunks(oldText, newText, "javascript", "light")

		expect(result.oldLines).toEqual([""])
		expect(result.newLines).toHaveLength(2)
	})

	it("should handle deletion-only hunk", async () => {
		const oldText = "// Deleted comment\nconst x = 1"
		const newText = ""

		const result = await highlightHunks(oldText, newText, "javascript", "light")

		expect(result.oldLines).toHaveLength(2)
		expect(result.newLines).toEqual([""])
	})

	it("should handle context with mixed changes", async () => {
		const oldText = "line1\nold line\nline3\nold line2"
		const newText = "line1\nnew line\nline3\nnew line2"

		const result = await highlightHunks(oldText, newText, "txt", "light")

		expect(result.oldLines).toHaveLength(4)
		expect(result.newLines).toHaveLength(4)
	})
})
