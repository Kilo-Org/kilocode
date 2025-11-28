import { describe, it, expect, beforeEach, vi } from "vitest"
import { GhostContextProvider } from "../GhostContextProvider"
import { AutocompleteInput } from "../../types"
import { AutocompleteSnippetType } from "../../../continuedev/core/autocomplete/snippets/types"
import { GhostModel } from "../../GhostModel"
import { RooIgnoreController } from "../../../../core/ignore/RooIgnoreController"
import * as vscode from "vscode"
import crypto from "crypto"

vi.mock("vscode", () => ({
	Uri: {
		parse: (uriString: string) => ({
			toString: () => uriString,
			fsPath: uriString.replace("file://", ""),
		}),
		file: (path: string) => ({
			toString: () => `file://${path}`,
			fsPath: path,
		}),
	},
	workspace: {
		textDocuments: [],
		workspaceFolders: [],
	},
	window: {
		activeTextEditor: null,
	},
}))

vi.mock("../../../continuedev/core/autocomplete/context/ContextRetrievalService", () => ({
	ContextRetrievalService: vi.fn().mockImplementation(() => ({
		initializeForFile: vi.fn().mockResolvedValue(undefined),
	})),
}))

vi.mock("../../../continuedev/core/vscode-test-harness/src/VSCodeIde", () => ({
	VsCodeIde: vi.fn().mockImplementation(() => ({
		getWorkspaceDirs: vi.fn().mockResolvedValue(["file:///workspace"]),
	})),
}))

vi.mock("../../../continuedev/core/autocomplete/util/HelperVars", () => ({
	HelperVars: {
		create: vi.fn().mockResolvedValue({
			filepath: "file:///test.ts",
			lang: { name: "typescript", singleLineComment: "//" },
		}),
	},
}))

vi.mock("../../../continuedev/core/autocomplete/snippets/getAllSnippets", () => ({
	getAllSnippetsWithoutRace: vi.fn().mockResolvedValue({
		recentlyOpenedFileSnippets: [],
		importDefinitionSnippets: [],
		rootPathSnippets: [],
		recentlyEditedRangeSnippets: [],
		recentlyVisitedRangesSnippets: [],
		diffSnippets: [],
		clipboardSnippets: [],
		ideSnippets: [],
		staticSnippet: [],
	}),
}))

vi.mock("../../../continuedev/core/autocomplete/templating/filtering", () => ({
	getSnippets: vi
		.fn()
		.mockImplementation((_helper, payload) => [
			...payload.recentlyOpenedFileSnippets,
			...payload.importDefinitionSnippets,
		]),
}))

function createAutocompleteInput(filepath: string = "/test.ts"): AutocompleteInput {
	return {
		isUntitledFile: false,
		completionId: crypto.randomUUID(),
		filepath,
		pos: { line: 0, character: 0 },
		recentlyVisitedRanges: [],
		recentlyEditedRanges: [],
	}
}

describe("GhostContextProvider", () => {
	let contextProvider: GhostContextProvider
	let mockContext: vscode.ExtensionContext
	let mockModel: GhostModel
	let mockIgnoreController: Promise<RooIgnoreController> | undefined

	beforeEach(() => {
		vi.clearAllMocks()
		mockContext = {
			subscriptions: [],
			globalState: {
				get: vi.fn(),
				update: vi.fn(),
			},
		} as any

		mockModel = {
			getModelName: vi.fn().mockReturnValue("codestral"),
		} as any

		mockIgnoreController = undefined

		contextProvider = new GhostContextProvider(mockContext, mockModel, mockIgnoreController)
	})

	describe("getProcessedSnippets", () => {
		it("should return empty snippets when no snippets available", async () => {
			const input = createAutocompleteInput("/test.ts")
			const result = await contextProvider.getProcessedSnippets(input, "/test.ts")

			expect(result.snippetsWithUris).toEqual([])
			expect(result.helper).toBeDefined()
			expect(result.workspaceDirs).toEqual(["file:///workspace"])
		})

		it("should return processed snippets when snippets are available", async () => {
			const { getAllSnippetsWithoutRace } = await import(
				"../../../continuedev/core/autocomplete/snippets/getAllSnippets"
			)

			;(getAllSnippetsWithoutRace as any).mockResolvedValueOnce({
				recentlyOpenedFileSnippets: [
					{
						filepath: "/recent.ts",
						content: "const recent = 1;",
						type: AutocompleteSnippetType.Code,
					},
				],
				importDefinitionSnippets: [],
				rootPathSnippets: [],
				recentlyEditedRangeSnippets: [],
				recentlyVisitedRangesSnippets: [],
				diffSnippets: [],
				clipboardSnippets: [],
				ideSnippets: [],
				staticSnippet: [],
			})

			const input = createAutocompleteInput("/test.ts")
			const result = await contextProvider.getProcessedSnippets(input, "/test.ts")

			expect(result.snippetsWithUris).toHaveLength(1)
			expect(result.snippetsWithUris[0]).toEqual({
				filepath: "file:///recent.ts",
				content: "const recent = 1;",
				type: AutocompleteSnippetType.Code,
			})
		})

		it("should process multiple snippets correctly", async () => {
			const { getAllSnippetsWithoutRace } = await import(
				"../../../continuedev/core/autocomplete/snippets/getAllSnippets"
			)

			;(getAllSnippetsWithoutRace as any).mockResolvedValueOnce({
				recentlyOpenedFileSnippets: [
					{
						filepath: "/file1.ts",
						content: "const first = 1;",
						type: AutocompleteSnippetType.Code,
					},
				],
				importDefinitionSnippets: [
					{
						filepath: "/file2.ts",
						content: "const second = 2;",
						type: AutocompleteSnippetType.Code,
					},
				],
				rootPathSnippets: [],
				recentlyEditedRangeSnippets: [],
				recentlyVisitedRangesSnippets: [],
				diffSnippets: [],
				clipboardSnippets: [],
				ideSnippets: [],
				staticSnippet: [],
			})

			const input = createAutocompleteInput("/test.ts")
			const result = await contextProvider.getProcessedSnippets(input, "/test.ts")

			expect(result.snippetsWithUris).toHaveLength(2)
			expect(result.snippetsWithUris[0]).toEqual({
				filepath: "file:///file1.ts",
				content: "const first = 1;",
				type: AutocompleteSnippetType.Code,
			})
			expect(result.snippetsWithUris[1]).toEqual({
				filepath: "file:///file2.ts",
				content: "const second = 2;",
				type: AutocompleteSnippetType.Code,
			})
		})

		it("should propagate errors from getAllSnippetsWithoutRace", async () => {
			const { getAllSnippetsWithoutRace } = await import(
				"../../../continuedev/core/autocomplete/snippets/getAllSnippets"
			)

			;(getAllSnippetsWithoutRace as any).mockRejectedValueOnce(new Error("Test error"))

			const input = createAutocompleteInput("/test.ts")

			await expect(contextProvider.getProcessedSnippets(input, "/test.ts")).rejects.toThrow("Test error")
		})
	})

	describe("with RooIgnoreController", () => {
		beforeEach(() => {
			const mockController = {
				validateAccess: vi.fn().mockReturnValue(true),
				initialize: vi.fn(),
				dispose: vi.fn(),
				filterPaths: vi.fn(),
				validateCommand: vi.fn(),
				getInstructions: vi.fn(),
			} as any

			mockIgnoreController = Promise.resolve(mockController)

			contextProvider = new GhostContextProvider(mockContext, mockModel, mockIgnoreController)
		})

		it("should filter out blocked files", async () => {
			const { getAllSnippetsWithoutRace } = await import(
				"../../../continuedev/core/autocomplete/snippets/getAllSnippets"
			)

			// Mock validateAccess to block /blocked.ts
			const controller = await mockIgnoreController!
			;(controller as any).validateAccess.mockImplementation((path: string) => {
				return !path.includes("blocked.ts")
			})
			;(getAllSnippetsWithoutRace as any).mockResolvedValueOnce({
				recentlyOpenedFileSnippets: [
					{
						filepath: "/allowed.ts",
						content: "const allowed = 1;",
						type: AutocompleteSnippetType.Code,
					},
					{
						filepath: "/blocked.ts",
						content: "const blocked = 2;",
						type: AutocompleteSnippetType.Code,
					},
				],
				importDefinitionSnippets: [],
				rootPathSnippets: [],
				recentlyEditedRangeSnippets: [],
				recentlyVisitedRangesSnippets: [],
				diffSnippets: [],
				clipboardSnippets: [],
				ideSnippets: [],
				staticSnippet: [],
			})

			const input = createAutocompleteInput("/test.ts")
			const result = await contextProvider.getProcessedSnippets(input, "/test.ts")

			// Should only contain the allowed file
			expect(result.snippetsWithUris).toHaveLength(1)
			const snippet = result.snippetsWithUris[0]
			expect("filepath" in snippet && snippet.filepath).toBeTruthy()
			if ("filepath" in snippet) {
				expect(snippet.filepath).toContain("allowed.ts")
			}
			expect(snippet.content).toBe("const allowed = 1;")
		})

		it("should keep snippets without file paths", async () => {
			const { getAllSnippetsWithoutRace } = await import(
				"../../../continuedev/core/autocomplete/snippets/getAllSnippets"
			)

			const controller = await mockIgnoreController!
			;(controller as any).validateAccess.mockReturnValue(false) // Block all files
			;(getAllSnippetsWithoutRace as any).mockResolvedValueOnce({
				recentlyOpenedFileSnippets: [
					{
						filepath: "/blocked.ts",
						content: "const blocked = 1;",
						type: AutocompleteSnippetType.Code,
					},
				],
				importDefinitionSnippets: [],
				rootPathSnippets: [],
				recentlyEditedRangeSnippets: [],
				recentlyVisitedRangesSnippets: [],
				diffSnippets: [
					{
						content: "diff content",
						type: AutocompleteSnippetType.Diff,
					},
				],
				clipboardSnippets: [
					{
						content: "clipboard content",
						type: AutocompleteSnippetType.Clipboard,
						copiedAt: "2024-01-01",
					},
				],
				ideSnippets: [],
				staticSnippet: [],
			})

			const { getSnippets } = await import("../../../continuedev/core/autocomplete/templating/filtering")
			;(getSnippets as any).mockImplementation((_helper: any, payload: any) => [
				...payload.recentlyOpenedFileSnippets,
				...payload.diffSnippets,
				...payload.clipboardSnippets,
			])

			const input = createAutocompleteInput("/test.ts")
			const result = await contextProvider.getProcessedSnippets(input, "/test.ts")

			// Should not contain blocked file
			expect(
				result.snippetsWithUris.some((s) => "filepath" in s && s.filepath && s.filepath.includes("blocked.ts")),
			).toBe(false)
			// But should contain snippets without file paths
			expect(result.snippetsWithUris).toHaveLength(2)
			expect(result.snippetsWithUris[0].content).toBe("diff content")
			expect(result.snippetsWithUris[0].type).toBe(AutocompleteSnippetType.Diff)
			expect(result.snippetsWithUris[1].content).toBe("clipboard content")
			expect(result.snippetsWithUris[1].type).toBe(AutocompleteSnippetType.Clipboard)
		})

		it("should allow all files when no ignore controller is provided", async () => {
			// Create provider without ignore controller
			contextProvider = new GhostContextProvider(mockContext, mockModel)

			const { getAllSnippetsWithoutRace } = await import(
				"../../../continuedev/core/autocomplete/snippets/getAllSnippets"
			)

			;(getAllSnippetsWithoutRace as any).mockResolvedValueOnce({
				recentlyOpenedFileSnippets: [
					{
						filepath: "/any-file.ts",
						content: "const any = 1;",
						type: AutocompleteSnippetType.Code,
					},
				],
				importDefinitionSnippets: [],
				rootPathSnippets: [],
				recentlyEditedRangeSnippets: [],
				recentlyVisitedRangesSnippets: [],
				diffSnippets: [],
				clipboardSnippets: [],
				ideSnippets: [],
				staticSnippet: [],
			})

			const input = createAutocompleteInput("/test.ts")
			const result = await contextProvider.getProcessedSnippets(input, "/test.ts")

			// Should contain all files when no controller
			expect(result.snippetsWithUris).toHaveLength(1)
			const snippet = result.snippetsWithUris[0]
			expect("filepath" in snippet && snippet.filepath).toBeTruthy()
			if ("filepath" in snippet) {
				expect(snippet.filepath).toContain("any-file.ts")
			}
			expect(snippet.content).toBe("const any = 1;")
		})
	})
})
