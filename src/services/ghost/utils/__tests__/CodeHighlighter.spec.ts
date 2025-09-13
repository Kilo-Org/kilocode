import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock shiki
vi.mock("shiki", () => ({
	getSingletonHighlighter: vi.fn().mockResolvedValue({
		codeToTokens: vi.fn().mockReturnValue({
			tokens: [
				[
					{ content: "function", color: "#569cd6" },
					{ content: " ", color: "#d4d4d4" },
					{ content: "test", color: "#dcdcaa" },
					{ content: "()", color: "#d4d4d4" },
				],
			],
		}),
	}),
}))

// Mock vscode
vi.mock("vscode", () => ({
	window: {
		activeColorTheme: { kind: 1 },
	},
	ColorThemeKind: { Dark: 1, Light: 2 },
	workspace: {
		getConfiguration: vi.fn().mockReturnValue({
			get: vi.fn().mockReturnValue("Dark+ (default dark)"),
		}),
	},
}))

import { initializeHighlighter, getLanguageForDocument } from "../CodeHighlighter"

describe("CodeHighlighter", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("getLanguageForDocument", () => {
		it("should map TypeScript correctly", () => {
			const mockDocument = { languageId: "typescript" } as any
			const result = getLanguageForDocument(mockDocument)
			expect(result).toBe("typescript")
		})

		it("should map unknown language to plaintext", () => {
			const mockDocument = { languageId: "unknown-language" } as any
			const result = getLanguageForDocument(mockDocument)
			expect(result).toBe("plaintext")
		})
	})

	describe("initializeHighlighter", () => {
		it("should initialize without throwing", async () => {
			await expect(initializeHighlighter()).resolves.not.toThrow()
		})
	})
})
