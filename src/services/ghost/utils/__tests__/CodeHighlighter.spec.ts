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

import {
	initializeHighlighter,
	generateHighlightedHtml,
	getLanguageForDocument,
	type DiffLine,
} from "../CodeHighlighter"
import * as vscode from "vscode"

describe("CodeHighlighter", () => {
	beforeAll(async () => {
		await initializeHighlighter()
	})

	describe("getLanguageForDocument", () => {
		it("should return correct language for TypeScript", () => {
			const mockDocument = {
				languageId: "typescript",
			} as vscode.TextDocument

			const result = getLanguageForDocument(mockDocument)
			expect(result).toBe("typescript")
		})

		it("should return correct language for JavaScript", () => {
			const mockDocument = {
				languageId: "javascript",
			} as vscode.TextDocument

			const result = getLanguageForDocument(mockDocument)
			expect(result).toBe("javascript")
		})

		it("should return correct language for TypeScript React", () => {
			const mockDocument = {
				languageId: "typescriptreact",
			} as vscode.TextDocument

			const result = getLanguageForDocument(mockDocument)
			expect(result).toBe("typescript")
		})

		it("should return plaintext for unknown language", () => {
			const mockDocument = {
				languageId: "unknown-language",
			} as vscode.TextDocument

			const result = getLanguageForDocument(mockDocument)
			expect(result).toBe("plaintext")
		})
	})

	describe("generateHighlightedHtml", () => {
		it("should generate HTML for simple TypeScript code", async () => {
			const code = "const x = 42;"
			const language = "typescript"
			const startLine = 0
			const diffLines: DiffLine[] = []

			const result = await generateHighlightedHtml(code, language, startLine, diffLines)

			expect(result.html).toContain("const")
			expect(result.html).toContain("42")
			expect(result.themeColors).toBeDefined()
			expect(result.themeColors.background).toBeDefined()
			expect(result.themeColors.foreground).toBeDefined()
		})

		it("should generate HTML with diff highlighting for new lines", async () => {
			const code = "const x = 42;\nconst y = 24;"
			const language = "typescript"
			const startLine = 0
			const diffLines: DiffLine[] = [
				{ type: "new", line: "const x = 42;" },
				{ type: "new", line: "const y = 24;" },
			]

			const result = await generateHighlightedHtml(code, language, startLine, diffLines)

			expect(result.html).toContain("const")
			expect(result.html).toBeDefined()
			expect(result.themeColors).toBeDefined()
		})

		it("should handle empty code", async () => {
			const code = ""
			const language = "typescript"
			const startLine = 0
			const diffLines: DiffLine[] = []

			const result = await generateHighlightedHtml(code, language, startLine, diffLines)

			expect(result.html).toBeDefined()
			expect(result.themeColors).toBeDefined()
		})

		it("should handle invalid language gracefully", async () => {
			// Mock console.error to suppress expected error output
			const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

			const code = "const x = 42;"
			const language = "invalid-language"
			const startLine = 0
			const diffLines: DiffLine[] = []

			const result = await generateHighlightedHtml(code, language, startLine, diffLines)

			expect(result.html).toBeDefined()
			expect(result.themeColors).toBeDefined()

			// Verify that error was logged (but suppressed from output)
			expect(consoleSpy).toHaveBeenCalledWith("Failed to generate highlighted HTML:", expect.any(Error))

			// Restore console.error
			consoleSpy.mockRestore()
		})
	})
})
