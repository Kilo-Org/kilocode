import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { getAllSnippets, getAllSnippetsWithoutRace } from "./getAllSnippets"
import { AutocompleteSnippetType } from "../types"
import type { HelperVars } from "../util/HelperVars"
import type { IDE } from "../../index"
import type { GetLspDefinitionsFunction } from "../types"
import type { ContextRetrievalService } from "../context/ContextRetrievalService"

describe("getAllSnippets", () => {
	let mockHelper: HelperVars
	let mockIde: IDE
	let mockGetDefinitionsFromLsp: GetLspDefinitionsFunction
	let mockContextRetrievalService: ContextRetrievalService

	beforeEach(() => {
		// Create mock helper with minimal required properties
		mockHelper = {
			input: {
				filepath: "/test/file.ts",
				recentlyEditedRanges: [
					{
						filepath: "/test/recent.ts",
						lines: ["const x = 1;", "const y = 2;"],
					},
				],
				recentlyVisitedRanges: [
					{
						filepath: "/test/visited.ts",
						content: "visited content",
						type: AutocompleteSnippetType.Code,
					},
				],
			},
			filepath: "/test/file.ts",
			fullPrefix: "const result = ",
			fullSuffix: ";",
			lang: "typescript",
			options: {
				onlyMyCode: false,
				useRecentlyEdited: true,
				useRecentlyOpened: true,
				experimental_enableStaticContextualization: false,
			},
		} as any

		// Create mock IDE
		mockIde = {
			getWorkspaceDirs: vi.fn().mockResolvedValue(["/test"]),
			getClipboardContent: vi.fn().mockResolvedValue({
				text: "clipboard content",
				copiedAt: "2024-01-01T00:00:00.000Z",
			}),
			readFile: vi.fn().mockResolvedValue("file content"),
		} as any

		// Create mock LSP function
		mockGetDefinitionsFromLsp = vi.fn().mockResolvedValue([])

		// Create mock context retrieval service
		mockContextRetrievalService = {
			getRootPathSnippets: vi.fn().mockResolvedValue([]),
			getSnippetsFromImportDefinitions: vi.fn().mockResolvedValue([]),
			getStaticContextSnippets: vi.fn().mockResolvedValue([]),
		} as any
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	describe("getAllSnippets with race conditions", () => {
		it("should return all snippet types", async () => {
			const result = await getAllSnippets({
				helper: mockHelper,
				ide: mockIde,
				getDefinitionsFromLsp: mockGetDefinitionsFromLsp,
				contextRetrievalService: mockContextRetrievalService,
			})

			expect(result).toHaveProperty("rootPathSnippets")
			expect(result).toHaveProperty("importDefinitionSnippets")
			expect(result).toHaveProperty("ideSnippets")
			expect(result).toHaveProperty("recentlyEditedRangeSnippets")
			expect(result).toHaveProperty("diffSnippets")
			expect(result).toHaveProperty("clipboardSnippets")
			expect(result).toHaveProperty("recentlyVisitedRangesSnippets")
			expect(result).toHaveProperty("recentlyOpenedFileSnippets")
			expect(result).toHaveProperty("staticSnippet")
		})

		it("should collect recently edited snippets synchronously", async () => {
			const result = await getAllSnippets({
				helper: mockHelper,
				ide: mockIde,
				getDefinitionsFromLsp: mockGetDefinitionsFromLsp,
				contextRetrievalService: mockContextRetrievalService,
			})

			expect(result.recentlyEditedRangeSnippets).toHaveLength(1)
			expect(result.recentlyEditedRangeSnippets[0]).toEqual({
				filepath: "/test/recent.ts",
				content: "const x = 1;\nconst y = 2;",
				type: AutocompleteSnippetType.Code,
			})
		})

		it("should pass through recently visited ranges", async () => {
			const result = await getAllSnippets({
				helper: mockHelper,
				ide: mockIde,
				getDefinitionsFromLsp: mockGetDefinitionsFromLsp,
				contextRetrievalService: mockContextRetrievalService,
			})

			expect(result.recentlyVisitedRangesSnippets).toEqual(mockHelper.input.recentlyVisitedRanges)
		})

		it("should timeout slow snippet sources after default 100ms", async () => {
			// Mock a slow service that takes 200ms
			mockContextRetrievalService.getRootPathSnippets = vi.fn().mockImplementation(
				() =>
					new Promise((resolve) => {
						setTimeout(
							() =>
								resolve([
									{
										filepath: "/slow.ts",
										content: "slow",
										type: AutocompleteSnippetType.Code,
									},
								]),
							200,
						)
					}),
			)

			const startTime = Date.now()
			const result = await getAllSnippets({
				helper: mockHelper,
				ide: mockIde,
				getDefinitionsFromLsp: mockGetDefinitionsFromLsp,
				contextRetrievalService: mockContextRetrievalService,
			})
			const duration = Date.now() - startTime

			// Should timeout and return empty array, not wait 200ms
			expect(result.rootPathSnippets).toEqual([])
			expect(duration).toBeLessThan(150) // Some buffer for timing
		})

		it("should return results from fast sources even if other sources are slow", async () => {
			// Mock one fast and one slow source
			mockContextRetrievalService.getRootPathSnippets = vi.fn().mockResolvedValue([
				{
					filepath: "/fast.ts",
					content: "fast",
					type: AutocompleteSnippetType.Code,
				},
			])
			mockContextRetrievalService.getSnippetsFromImportDefinitions = vi
				.fn()
				.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve([]), 200)))

			const result = await getAllSnippets({
				helper: mockHelper,
				ide: mockIde,
				getDefinitionsFromLsp: mockGetDefinitionsFromLsp,
				contextRetrievalService: mockContextRetrievalService,
			})

			// Fast source should return results
			expect(result.rootPathSnippets).toHaveLength(1)
			expect(result.rootPathSnippets[0].content).toBe("fast")

			// Slow source should timeout and return empty
			expect(result.importDefinitionSnippets).toEqual([])
		})

		it("should collect clipboard snippets", async () => {
			const result = await getAllSnippets({
				helper: mockHelper,
				ide: mockIde,
				getDefinitionsFromLsp: mockGetDefinitionsFromLsp,
				contextRetrievalService: mockContextRetrievalService,
			})

			expect(result.clipboardSnippets).toHaveLength(1)
			expect(result.clipboardSnippets[0]).toEqual({
				content: "clipboard content",
				copiedAt: "2024-01-01T00:00:00.000Z",
				type: AutocompleteSnippetType.Clipboard,
			})
		})

		it("should handle empty results from snippet sources", async () => {
			// All sources return empty
			mockContextRetrievalService.getRootPathSnippets = vi.fn().mockResolvedValue([])
			mockContextRetrievalService.getSnippetsFromImportDefinitions = vi.fn().mockResolvedValue([])
			mockIde.getClipboardContent = vi.fn().mockResolvedValue({
				text: "",
				copiedAt: "2024-01-01T00:00:00.000Z",
			})

			const result = await getAllSnippets({
				helper: mockHelper,
				ide: mockIde,
				getDefinitionsFromLsp: mockGetDefinitionsFromLsp,
				contextRetrievalService: mockContextRetrievalService,
			})

			expect(result.rootPathSnippets).toEqual([])
			expect(result.importDefinitionSnippets).toEqual([])
			expect(result.clipboardSnippets).toHaveLength(1) // Still returns clipboard snippet
		})

		it("should return empty array for IDE snippets when disabled", async () => {
			const result = await getAllSnippets({
				helper: mockHelper,
				ide: mockIde,
				getDefinitionsFromLsp: mockGetDefinitionsFromLsp,
				contextRetrievalService: mockContextRetrievalService,
			})

			// IDE_SNIPPETS_ENABLED is false in the implementation
			expect(result.ideSnippets).toEqual([])
			expect(mockGetDefinitionsFromLsp).not.toHaveBeenCalled()
		})

		it("should return empty array for diff snippets (temporarily disabled)", async () => {
			const result = await getAllSnippets({
				helper: mockHelper,
				ide: mockIde,
				getDefinitionsFromLsp: mockGetDefinitionsFromLsp,
				contextRetrievalService: mockContextRetrievalService,
			})

			expect(result.diffSnippets).toEqual([])
		})

		it("should handle option useRecentlyEdited = false", async () => {
			mockHelper.options.useRecentlyEdited = false

			const result = await getAllSnippets({
				helper: mockHelper,
				ide: mockIde,
				getDefinitionsFromLsp: mockGetDefinitionsFromLsp,
				contextRetrievalService: mockContextRetrievalService,
			})

			expect(result.recentlyEditedRangeSnippets).toEqual([])
		})

		it("should handle option useRecentlyOpened = false", async () => {
			mockHelper.options.useRecentlyOpened = false

			const result = await getAllSnippets({
				helper: mockHelper,
				ide: mockIde,
				getDefinitionsFromLsp: mockGetDefinitionsFromLsp,
				contextRetrievalService: mockContextRetrievalService,
			})

			expect(result.recentlyOpenedFileSnippets).toEqual([])
		})

		it("should collect static context snippets when experimental flag is enabled", async () => {
			mockHelper.options.experimental_enableStaticContextualization = true
			mockContextRetrievalService.getStaticContextSnippets = vi.fn().mockResolvedValue([
				{
					filepath: "/static.ts",
					content: "static",
					type: AutocompleteSnippetType.Static,
				},
			])

			const result = await getAllSnippets({
				helper: mockHelper,
				ide: mockIde,
				getDefinitionsFromLsp: mockGetDefinitionsFromLsp,
				contextRetrievalService: mockContextRetrievalService,
			})

			expect(result.staticSnippet).toHaveLength(1)
			expect(result.staticSnippet[0].content).toBe("static")
		})

		it("should return empty static snippets when experimental flag is disabled", async () => {
			mockHelper.options.experimental_enableStaticContextualization = false

			const result = await getAllSnippets({
				helper: mockHelper,
				ide: mockIde,
				getDefinitionsFromLsp: mockGetDefinitionsFromLsp,
				contextRetrievalService: mockContextRetrievalService,
			})

			expect(result.staticSnippet).toEqual([])
			expect(mockContextRetrievalService.getStaticContextSnippets).not.toHaveBeenCalled()
		})
	})

	describe("error handling", () => {
		it("should propagate errors from context retrieval service", async () => {
			mockContextRetrievalService.getRootPathSnippets = vi.fn().mockRejectedValue(new Error("Service error"))

			// Errors are not caught by racePromise - they propagate if they occur before timeout
			await expect(
				getAllSnippets({
					helper: mockHelper,
					ide: mockIde,
					getDefinitionsFromLsp: mockGetDefinitionsFromLsp,
					contextRetrievalService: mockContextRetrievalService,
				}),
			).rejects.toThrow("Service error")
		})

		it("should propagate errors from IDE clipboard", async () => {
			mockIde.getClipboardContent = vi.fn().mockRejectedValue(new Error("Clipboard error"))

			// Errors are not caught by racePromise - they propagate if they occur before timeout
			await expect(
				getAllSnippets({
					helper: mockHelper,
					ide: mockIde,
					getDefinitionsFromLsp: mockGetDefinitionsFromLsp,
					contextRetrievalService: mockContextRetrievalService,
				}),
			).rejects.toThrow("Clipboard error")
		})

		it("should pass through null from snippet sources", async () => {
			mockContextRetrievalService.getRootPathSnippets = vi.fn().mockResolvedValue(null as any)

			const result = await getAllSnippets({
				helper: mockHelper,
				ide: mockIde,
				getDefinitionsFromLsp: mockGetDefinitionsFromLsp,
				contextRetrievalService: mockContextRetrievalService,
			})

			// racePromise returns null if the promise resolves to null (not converted to [])
			expect(result.rootPathSnippets).toBeNull()
		})
	})

	describe("getAllSnippetsWithoutRace", () => {
		it("should wait for all promises without timeout", async () => {
			// Mock a slow service that takes 200ms
			mockContextRetrievalService.getRootPathSnippets = vi.fn().mockImplementation(
				() =>
					new Promise((resolve) => {
						setTimeout(
							() =>
								resolve([
									{
										filepath: "/slow.ts",
										content: "slow",
										type: AutocompleteSnippetType.Code,
									},
								]),
							200,
						)
					}),
			)

			const result = await getAllSnippetsWithoutRace({
				helper: mockHelper,
				ide: mockIde,
				getDefinitionsFromLsp: mockGetDefinitionsFromLsp,
				contextRetrievalService: mockContextRetrievalService,
			})

			// Should wait and get results, not timeout
			expect(result.rootPathSnippets).toHaveLength(1)
			expect(result.rootPathSnippets[0].content).toBe("slow")
		})

		it("should return all snippet types without racing", async () => {
			const result = await getAllSnippetsWithoutRace({
				helper: mockHelper,
				ide: mockIde,
				getDefinitionsFromLsp: mockGetDefinitionsFromLsp,
				contextRetrievalService: mockContextRetrievalService,
			})

			expect(result).toHaveProperty("rootPathSnippets")
			expect(result).toHaveProperty("importDefinitionSnippets")
			expect(result).toHaveProperty("ideSnippets")
			expect(result).toHaveProperty("recentlyEditedRangeSnippets")
			expect(result).toHaveProperty("diffSnippets")
			expect(result).toHaveProperty("clipboardSnippets")
			expect(result).toHaveProperty("recentlyVisitedRangesSnippets")
			expect(result).toHaveProperty("recentlyOpenedFileSnippets")
			expect(result).toHaveProperty("staticSnippet")
		})

		it("should handle errors without race timeout", async () => {
			mockContextRetrievalService.getRootPathSnippets = vi.fn().mockRejectedValue(new Error("Service error"))

			// Should propagate error since no timeout
			await expect(
				getAllSnippetsWithoutRace({
					helper: mockHelper,
					ide: mockIde,
					getDefinitionsFromLsp: mockGetDefinitionsFromLsp,
					contextRetrievalService: mockContextRetrievalService,
				}),
			).rejects.toThrow("Service error")
		})
	})

	describe("parallel execution", () => {
		it("should execute all snippet collections in parallel", async () => {
			const executionOrder: string[] = []

			mockContextRetrievalService.getRootPathSnippets = vi.fn().mockImplementation(async () => {
				executionOrder.push("rootPath-start")
				await new Promise((resolve) => setTimeout(resolve, 50))
				executionOrder.push("rootPath-end")
				return []
			})

			mockContextRetrievalService.getSnippetsFromImportDefinitions = vi.fn().mockImplementation(async () => {
				executionOrder.push("import-start")
				await new Promise((resolve) => setTimeout(resolve, 50))
				executionOrder.push("import-end")
				return []
			})

			mockIde.getClipboardContent = vi.fn().mockImplementation(async () => {
				executionOrder.push("clipboard-start")
				await new Promise((resolve) => setTimeout(resolve, 50))
				executionOrder.push("clipboard-end")
				return { text: "test", copiedAt: "2024-01-01T00:00:00.000Z" }
			})

			await getAllSnippets({
				helper: mockHelper,
				ide: mockIde,
				getDefinitionsFromLsp: mockGetDefinitionsFromLsp,
				contextRetrievalService: mockContextRetrievalService,
			})

			// All should start before any complete (parallel execution)
			expect(executionOrder[0]).toBe("rootPath-start")
			expect(executionOrder[1]).toBe("import-start")
			expect(executionOrder[2]).toBe("clipboard-start")
		})
	})
})
