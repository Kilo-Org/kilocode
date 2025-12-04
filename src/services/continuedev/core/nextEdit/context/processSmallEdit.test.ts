import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { processSmallEdit } from "./processSmallEdit"
import { BeforeAfterDiff } from "./diffFormatting"
import { Position } from "../.."
import { FakeConfigHandler } from "../../test/FakeConfigHandler"

// Mock only external/async dependencies that would require complex setup
vi.mock("./aggregateEdits", () => ({
	EditAggregator: {
		getInstance: vi.fn(),
	},
}))

vi.mock("../NextEditProvider", () => ({
	NextEditProvider: {
		getInstance: vi.fn(),
	},
}))

vi.mock("./processNextEditData", () => ({
	processNextEditData: vi.fn(),
}))

// Import mocked modules
import { EditAggregator } from "./aggregateEdits"
import { NextEditProvider } from "../NextEditProvider"
import { processNextEditData } from "./processNextEditData"

describe("processSmallEdit", () => {
	let mockEditAggregator: any
	let mockNextEditProvider: any
	let mockIde: any
	let mockConfigHandler: any
	let mockGetDefsFromLspFunction: any

	beforeEach(() => {
		vi.clearAllMocks()

		// Setup real config handler
		mockConfigHandler = new FakeConfigHandler()

		// Setup mock EditAggregator
		mockEditAggregator = {
			latestContextData: {
				configHandler: new FakeConfigHandler(),
				getDefsFromLspFunction: vi.fn(),
				recentlyEditedRanges: [{ filepath: "test.ts", range: {} }],
				recentlyVisitedRanges: [{ filepath: "other.ts", contents: "test" }],
				workspaceDir: "file:///workspace",
			},
		}
		;(EditAggregator.getInstance as any).mockReturnValue(mockEditAggregator)

		// Setup mock NextEditProvider
		mockNextEditProvider = {
			addDiffToContext: vi.fn(),
		}
		;(NextEditProvider.getInstance as any).mockReturnValue(mockNextEditProvider)

		// Setup mock processNextEditData
		;(processNextEditData as any).mockResolvedValue(undefined)

		// Setup mock IDE
		mockIde = {
			getWorkspaceDirs: vi.fn().mockResolvedValue(["/workspace"]),
			readFile: vi.fn().mockResolvedValue("file content"),
		}

		// Setup mock LSP function
		mockGetDefsFromLspFunction = vi.fn().mockResolvedValue([])
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	const mockPosition: Position = { line: 10, character: 5 }

	const createMockBeforeAfterDiff = (): BeforeAfterDiff => ({
		filePath: "file:///workspace/test.ts",
		beforeContent: "const a = 1;\nconst b = 2;",
		afterContent: "const a = 1;\nconst b = 3;",
	})

	describe("basic functionality", () => {
		it("should retrieve context data from EditAggregator", async () => {
			const diff = createMockBeforeAfterDiff()

			await processSmallEdit(
				diff,
				mockPosition,
				mockPosition,
				mockConfigHandler,
				mockGetDefsFromLspFunction,
				mockIde,
			)

			expect(EditAggregator.getInstance).toHaveBeenCalled()
		})

		it("should create unified diff with 3 context lines", async () => {
			const diff = createMockBeforeAfterDiff()

			await processSmallEdit(
				diff,
				mockPosition,
				mockPosition,
				mockConfigHandler,
				mockGetDefsFromLspFunction,
				mockIde,
			)

			// Verify that addDiffToContext was called with a unified diff format
			expect(mockNextEditProvider.addDiffToContext).toHaveBeenCalledTimes(1)
			const diffArg = mockNextEditProvider.addDiffToContext.mock.calls[0][0]

			// Unified diffs should contain diff markers
			expect(diffArg).toContain("---")
			expect(diffArg).toContain("+++")
			expect(diffArg).toContain("@@")
		})

		it("should add diff to NextEditProvider", async () => {
			const diff = createMockBeforeAfterDiff()

			await processSmallEdit(
				diff,
				mockPosition,
				mockPosition,
				mockConfigHandler,
				mockGetDefsFromLspFunction,
				mockIde,
			)

			// Verify that addDiffToContext was called with a string (the actual diff output)
			expect(mockNextEditProvider.addDiffToContext).toHaveBeenCalledTimes(1)
			expect(mockNextEditProvider.addDiffToContext).toHaveBeenCalledWith(expect.stringContaining("test.ts"))
		})

		it("should call processNextEditData with context data", async () => {
			const diff = createMockBeforeAfterDiff()

			await processSmallEdit(
				diff,
				mockPosition,
				mockPosition,
				mockConfigHandler,
				mockGetDefsFromLspFunction,
				mockIde,
			)

			expect(processNextEditData).toHaveBeenCalledWith({
				filePath: diff.filePath,
				beforeContent: diff.beforeContent,
				afterContent: diff.afterContent,
				cursorPosBeforeEdit: mockPosition,
				cursorPosAfterPrevEdit: mockPosition,
				ide: mockIde,
				configHandler: mockEditAggregator.latestContextData.configHandler,
				getDefinitionsFromLsp: mockEditAggregator.latestContextData.getDefsFromLspFunction,
				recentlyEditedRanges: mockEditAggregator.latestContextData.recentlyEditedRanges,
				recentlyVisitedRanges: mockEditAggregator.latestContextData.recentlyVisitedRanges,
				workspaceDir: mockEditAggregator.latestContextData.workspaceDir,
			})
		})
	})

	describe("default context handling", () => {
		it("should use default values when latestContextData is missing", async () => {
			// Remove latestContextData
			mockEditAggregator.latestContextData = undefined
			;(EditAggregator.getInstance as any).mockReturnValue(mockEditAggregator)

			const diff = createMockBeforeAfterDiff()

			await processSmallEdit(
				diff,
				mockPosition,
				mockPosition,
				mockConfigHandler,
				mockGetDefsFromLspFunction,
				mockIde,
			)

			expect(processNextEditData).toHaveBeenCalledWith(
				expect.objectContaining({
					configHandler: mockConfigHandler,
					getDefinitionsFromLsp: mockGetDefsFromLspFunction,
					recentlyEditedRanges: [],
					recentlyVisitedRanges: [],
					workspaceDir: undefined,
				}),
			)
		})

		it("should use provided configHandler when no context data", async () => {
			mockEditAggregator.latestContextData = null
			;(EditAggregator.getInstance as any).mockReturnValue(mockEditAggregator)

			const diff = createMockBeforeAfterDiff()

			await processSmallEdit(
				diff,
				mockPosition,
				mockPosition,
				mockConfigHandler,
				mockGetDefsFromLspFunction,
				mockIde,
			)

			const call = (processNextEditData as any).mock.calls[0][0]
			expect(call.configHandler).toBe(mockConfigHandler)
			expect(call.getDefinitionsFromLsp).toBe(mockGetDefsFromLspFunction)
		})

		it("should use empty arrays for ranges when no context data", async () => {
			mockEditAggregator.latestContextData = undefined
			;(EditAggregator.getInstance as any).mockReturnValue(mockEditAggregator)

			const diff = createMockBeforeAfterDiff()

			await processSmallEdit(
				diff,
				mockPosition,
				mockPosition,
				mockConfigHandler,
				mockGetDefsFromLspFunction,
				mockIde,
			)

			const call = (processNextEditData as any).mock.calls[0][0]
			expect(call.recentlyEditedRanges).toEqual([])
			expect(call.recentlyVisitedRanges).toEqual([])
		})
	})

	describe("cursor position handling", () => {
		it("should pass different cursor positions correctly", async () => {
			const diff = createMockBeforeAfterDiff()

			const beforePos: Position = { line: 5, character: 10 }
			const afterPos: Position = { line: 6, character: 15 }

			await processSmallEdit(diff, beforePos, afterPos, mockConfigHandler, mockGetDefsFromLspFunction, mockIde)

			expect(processNextEditData).toHaveBeenCalledWith(
				expect.objectContaining({
					cursorPosBeforeEdit: beforePos,
					cursorPosAfterPrevEdit: afterPos,
				}),
			)
		})

		it("should handle same cursor position before and after", async () => {
			const diff = createMockBeforeAfterDiff()
			const samePos: Position = { line: 10, character: 5 }

			await processSmallEdit(diff, samePos, samePos, mockConfigHandler, mockGetDefsFromLspFunction, mockIde)

			const call = (processNextEditData as any).mock.calls[0][0]
			expect(call.cursorPosBeforeEdit).toEqual(samePos)
			expect(call.cursorPosAfterPrevEdit).toEqual(samePos)
		})
	})

	describe("async behavior", () => {
		it("should not wait for processNextEditData to complete", async () => {
			let processResolve: any
			const delayedPromise = new Promise((resolve) => {
				processResolve = resolve
			})
			;(processNextEditData as any).mockReturnValue(delayedPromise)

			const diff = createMockBeforeAfterDiff()

			// processSmallEdit should complete without waiting
			const result = await processSmallEdit(
				diff,
				mockPosition,
				mockPosition,
				mockConfigHandler,
				mockGetDefsFromLspFunction,
				mockIde,
			)

			expect(result).toBeUndefined()
			expect(processNextEditData).toHaveBeenCalled()

			// Clean up
			processResolve()
		})
	})

	describe("different file paths", () => {
		it("should handle various file path formats", async () => {
			const testPaths = [
				"file:///workspace/src/index.ts",
				"file:///workspace/test.js",
				"file:///different/path/file.py",
			]

			for (const path of testPaths) {
				mockNextEditProvider.addDiffToContext.mockClear()
				const diff: BeforeAfterDiff = {
					filePath: path,
					beforeContent: "test",
					afterContent: "test2",
				}

				await processSmallEdit(
					diff,
					mockPosition,
					mockPosition,
					mockConfigHandler,
					mockGetDefsFromLspFunction,
					mockIde,
				)

				// Verify diff was generated and added to context
				expect(mockNextEditProvider.addDiffToContext).toHaveBeenCalledTimes(1)
				expect(mockNextEditProvider.addDiffToContext).toHaveBeenCalledWith(expect.stringContaining("@@"))
			}
		})
	})

	describe("integration with context data", () => {
		it("should use all context data fields when available", async () => {
			const customConfigHandler = new FakeConfigHandler()
			const contextData = {
				configHandler: customConfigHandler,
				getDefsFromLspFunction: vi.fn(),
				recentlyEditedRanges: [{ filepath: "edited.ts", range: {} }],
				recentlyVisitedRanges: [{ filepath: "visited.ts", contents: "code" }],
				workspaceDir: "file:///custom/workspace",
			}

			mockEditAggregator.latestContextData = contextData
			;(EditAggregator.getInstance as any).mockReturnValue(mockEditAggregator)

			const diff = createMockBeforeAfterDiff()

			await processSmallEdit(
				diff,
				mockPosition,
				mockPosition,
				mockConfigHandler,
				mockGetDefsFromLspFunction,
				mockIde,
			)

			expect(processNextEditData).toHaveBeenCalledWith({
				filePath: diff.filePath,
				beforeContent: diff.beforeContent,
				afterContent: diff.afterContent,
				cursorPosBeforeEdit: mockPosition,
				cursorPosAfterPrevEdit: mockPosition,
				ide: mockIde,
				configHandler: customConfigHandler,
				getDefinitionsFromLsp: contextData.getDefsFromLspFunction,
				recentlyEditedRanges: contextData.recentlyEditedRanges,
				recentlyVisitedRanges: contextData.recentlyVisitedRanges,
				workspaceDir: contextData.workspaceDir,
			})
		})
	})
})
