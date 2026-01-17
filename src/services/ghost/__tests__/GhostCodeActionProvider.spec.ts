import * as vscode from "vscode"
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import { GhostCodeActionProvider } from "../GhostCodeActionProvider"

// Mock i18n
vi.mock("../../../i18n", () => ({
	t: vi.fn((key: string) => key),
	initializeI18n: vi.fn(),
	getCurrentLanguage: vi.fn(),
	changeLanguage: vi.fn(),
}))

describe("GhostCodeActionProvider", () => {
	let provider: GhostCodeActionProvider
	let mockConfig: any

	beforeEach(() => {
		provider = new GhostCodeActionProvider()
		mockConfig = {
			get: vi.fn(),
		}
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(mockConfig)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("provideCodeActions", () => {
		it("should return empty array when enableCodeActions is false", async () => {
			mockConfig.get.mockReturnValue(false)

			const document = {} as vscode.TextDocument
			const range = new vscode.Range(0, 0, 1, 0)
			const context = {} as vscode.CodeActionContext
			const token = {} as vscode.CancellationToken

			const result = await provider.provideCodeActions(document, range, context, token)

			expect(result).toEqual([])
			expect(mockConfig.get).toHaveBeenCalledWith("enableCodeActions", true)
		})

		it("should return code action when enableCodeActions is true", async () => {
			mockConfig.get.mockReturnValue(true)

			const document = { uri: vscode.Uri.parse("file:///test.txt") } as vscode.TextDocument
			const range = new vscode.Range(0, 0, 1, 0)
			const context = {} as vscode.CodeActionContext
			const token = {} as vscode.CancellationToken

			const result = await provider.provideCodeActions(document, range, context, token)

			expect(result).toBeTruthy()
			expect(Array.isArray(result)).toBe(true)
			expect(result!.length).toBe(1)
			expect(result![0].title).toBe("kilocode:ghost.codeAction.title")
			expect(mockConfig.get).toHaveBeenCalledWith("enableCodeActions", true)
		})
	})
})
