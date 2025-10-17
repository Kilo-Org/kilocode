import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { processNextEditData } from "./processNextEditData"
import { Position } from "../.."
import { FakeConfigHandler } from "../../test/FakeConfigHandler"

// Mock only external/async dependencies that would require complex setup
vi.mock("./autocompleteContextFetching", () => ({
	getAutocompleteContext: vi.fn(),
}))

vi.mock("../NextEditProvider", () => ({
	NextEditProvider: {
		getInstance: vi.fn(),
	},
}))

// Import mocked modules
import { getAutocompleteContext } from "./autocompleteContextFetching"
import { NextEditProvider } from "../NextEditProvider"

// Import real implementations
import * as prevEditModule from "./prevEditLruCache"
const { prevEditLruCache } = prevEditModule

describe("processNextEditData", () => {
	let mockIde: any
	let mockConfigHandler: FakeConfigHandler
	let mockGetDefinitionsFromLsp: any
	let mockNextEditProvider: any

	beforeEach(() => {
		vi.clearAllMocks()

		// Setup mock IDE
		mockIde = {
			getWorkspaceDirs: vi.fn().mockResolvedValue(["/workspace"]),
			readFile: vi.fn().mockResolvedValue("file content"),
		}

		// Setup mock config handler
		mockConfigHandler = new FakeConfigHandler({
			autocompleteModel: {
				model: "test-model",
			} as any,
		})

		// Setup mock LSP function
		mockGetDefinitionsFromLsp = vi.fn().mockResolvedValue([])

		// Setup mock NextEditProvider
		mockNextEditProvider = {
			addAutocompleteContext: vi.fn(),
		}
		;(NextEditProvider.getInstance as any).mockReturnValue(mockNextEditProvider)

		// Setup mock getAutocompleteContext
		;(getAutocompleteContext as any).mockResolvedValue("test autocomplete context")

		// Spy on real prevEditLruCache functions to verify they're called
		vi.spyOn(prevEditModule, "setPrevEdit")
		vi.spyOn(prevEditLruCache, "clear")
	})

	afterEach(() => {
		vi.clearAllMocks()
		// Clear the real cache after each test
		prevEditLruCache.clear()
	})

	const mockPosition: Position = { line: 10, character: 5 }

	const getBaseParams = () => ({
		filePath: "file:///workspace/test.ts",
		beforeContent: "const a = 1;",
		afterContent: "const a = 2;",
		cursorPosBeforeEdit: mockPosition,
		cursorPosAfterPrevEdit: mockPosition,
		ide: mockIde,
		configHandler: mockConfigHandler as any,
		getDefinitionsFromLsp: mockGetDefinitionsFromLsp,
		recentlyEditedRanges: [],
		recentlyVisitedRanges: [],
		workspaceDir: "file:///workspace",
	})

	describe("basic functionality", () => {
		it("should fetch autocomplete context", async () => {
			await processNextEditData(getBaseParams())

			expect(getAutocompleteContext).toHaveBeenCalledWith(
				getBaseParams().filePath,
				getBaseParams().cursorPosBeforeEdit,
				getBaseParams().ide,
				getBaseParams().configHandler,
				getBaseParams().getDefinitionsFromLsp,
				getBaseParams().recentlyEditedRanges,
				getBaseParams().recentlyVisitedRanges,
				expect.any(Number), // maxPromptTokens is randomized
				getBaseParams().beforeContent,
				"Codestral",
			)
		})

		it("should add context to NextEditProvider", async () => {
			await processNextEditData(getBaseParams())

			expect(mockNextEditProvider.addAutocompleteContext).toHaveBeenCalledWith("test autocomplete context")
		})

		it("should store current edit in cache", async () => {
			await processNextEditData(getBaseParams())

			expect(prevEditModule.setPrevEdit).toHaveBeenCalledWith({
				unidiff: expect.any(String),
				fileUri: getBaseParams().filePath,
				workspaceUri: getBaseParams().workspaceDir,
				timestamp: expect.any(Number),
			})
		})

		it("should create and store diff with unified format", async () => {
			await processNextEditData(getBaseParams())

			// Verify that setPrevEdit was called with a unified diff
			expect(prevEditModule.setPrevEdit).toHaveBeenCalledTimes(1)
			const storedEdit = (prevEditModule.setPrevEdit as any).mock.calls[0][0]

			// Unified diffs should contain diff markers
			expect(storedEdit.unidiff).toContain("---")
			expect(storedEdit.unidiff).toContain("+++")
			expect(storedEdit.unidiff).toContain("@@")
		})
	})

	describe("history timeout", () => {
		it("should clear cache when last edit was more than 10 minutes ago", async () => {
			const oldTimestamp = Date.now() - 11 * 60 * 1000 // 11 minutes ago

			// Populate the real cache with an old edit
			prevEditModule.setPrevEdit({
				unidiff: "--- test\n+++ test\n@@ @@\n-old\n+new",
				fileUri: "file:///workspace/test.ts",
				workspaceUri: "file:///workspace",
				timestamp: oldTimestamp,
			})

			await processNextEditData(getBaseParams())

			expect(prevEditLruCache.clear).toHaveBeenCalled()
		})

		it("should not clear cache when last edit was within 10 minutes", async () => {
			const recentTimestamp = Date.now() - 5 * 60 * 1000 // 5 minutes ago

			// Populate the real cache with a recent edit
			prevEditModule.setPrevEdit({
				unidiff: "--- test\n+++ test\n@@ @@\n-old\n+new",
				fileUri: "file:///workspace/test.ts",
				workspaceUri: "file:///workspace",
				timestamp: recentTimestamp,
			})

			await processNextEditData(getBaseParams())

			expect(prevEditLruCache.clear).not.toHaveBeenCalled()
		})
	})

	describe("workspace change detection", () => {
		it("should clear cache when workspace changes", async () => {
			// Populate the real cache with an edit from a different workspace
			prevEditModule.setPrevEdit({
				unidiff: "--- test\n+++ test\n@@ @@\n-old\n+new",
				fileUri: "file:///workspace/test.ts",
				workspaceUri: "file:///different-workspace",
				timestamp: Date.now(),
			})

			await processNextEditData(getBaseParams())

			expect(prevEditLruCache.clear).toHaveBeenCalled()
		})

		it("should not clear cache when workspace is the same", async () => {
			// Populate the real cache with an edit from the same workspace
			prevEditModule.setPrevEdit({
				unidiff: "--- test\n+++ test\n@@ @@\n-old\n+new",
				fileUri: "file:///workspace/test.ts",
				workspaceUri: "file:///workspace",
				timestamp: Date.now(),
			})

			await processNextEditData(getBaseParams())

			expect(prevEditLruCache.clear).not.toHaveBeenCalled()
		})
	})

	describe("maxPromptTokens randomization", () => {
		it("should use random maxPromptTokens between 500 and 12000", async () => {
			;(getAutocompleteContext as any).mockClear()

			await processNextEditData(getBaseParams())

			const maxPromptTokens = (getAutocompleteContext as any).mock.calls[0][7]

			expect(maxPromptTokens).toBeGreaterThanOrEqual(500)
			expect(maxPromptTokens).toBeLessThanOrEqual(12000)
		})
	})

	describe("edge cases", () => {
		it("should handle empty previous edits array", async () => {
			// Cache is already empty by default
			await expect(processNextEditData(getBaseParams())).resolves.not.toThrow()
		})

		it("should handle multiple previous edits", async () => {
			const consoleLogSpy = vi.spyOn(console, "log")

			// Populate the real cache with multiple edits
			prevEditModule.setPrevEdit({
				unidiff: "--- a/test1.ts\n+++ b/test1.ts\n@@ @@\nheader\n-old1\n+new1",
				fileUri: "file:///workspace/test1.ts",
				workspaceUri: "file:///workspace",
				timestamp: Date.now() - 1000,
			})

			prevEditModule.setPrevEdit({
				unidiff: "--- a/test2.ts\n+++ b/test2.ts\n@@ @@\nheader\n-old2\n+new2",
				fileUri: "file:///workspace/test2.ts",
				workspaceUri: "file:///workspace",
				timestamp: Date.now() - 2000,
			})

			await processNextEditData(getBaseParams())

			// Verify console.log was called with nextEditWithHistory
			expect(consoleLogSpy).toHaveBeenCalledWith(
				"nextEditWithHistory",
				expect.objectContaining({
					previousEdits: expect.arrayContaining([
						expect.objectContaining({
							filename: expect.stringContaining("test"),
							diff: expect.any(String),
						}),
					]),
					fileURI: getBaseParams().filePath,
					workspaceDirURI: getBaseParams().workspaceDir,
				}),
			)

			consoleLogSpy.mockRestore()
		})

		it("should handle undefined model name", async () => {
			await expect(
				processNextEditData({
					...getBaseParams(),
					modelNameOrInstance: undefined,
				}),
			).resolves.not.toThrow()
		})
	})
})
