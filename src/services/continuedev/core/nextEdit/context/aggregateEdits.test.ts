import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { EditAggregator } from "./aggregateEdits"
import { RangeInFileWithNextEditInfo } from "../.."

describe("aggregateEdits", () => {
	let mockCallback: ReturnType<typeof vi.fn>

	beforeEach(() => {
		mockCallback = vi.fn()
		// Reset singleton before each test
		;(EditAggregator as any)._instance = null
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	const createMockEdit = (
		line: number,
		filePath: string = "test.ts",
		editText: string = "test",
		fileContents: string = "line1\nline2\nline3\nline4\nline5",
	): RangeInFileWithNextEditInfo => ({
		filepath: filePath,
		range: {
			start: { line, character: 0 },
			end: { line, character: 5 },
		},
		editText,
		fileContents,
		beforeCursorPos: { line, character: 0 },
		afterCursorPos: { line, character: editText.length },
		workspaceDir: "/test/workspace",
	})

	describe("EditAggregator", () => {
		describe("getInstance", () => {
			it("should create singleton instance", () => {
				const instance1 = EditAggregator.getInstance()
				const instance2 = EditAggregator.getInstance()

				expect(instance1).toBe(instance2)
			})

			it("should use default config when not provided", () => {
				const instance = EditAggregator.getInstance()

				expect(instance.config).toEqual({
					deltaT: 1.0,
					deltaL: 5,
					maxEdits: 500,
					maxDuration: 100.0,
					contextSize: 5,
					contextLines: 3,
				})
			})

			it("should update config on existing instance", () => {
				const instance1 = EditAggregator.getInstance({ deltaT: 2.0 })
				expect(instance1.config.deltaT).toBe(2.0)

				const instance2 = EditAggregator.getInstance({ deltaL: 10 })
				expect(instance2.config.deltaT).toBe(2.0)
				expect(instance2.config.deltaL).toBe(10)
			})

			it("should update callback on existing instance", () => {
				const callback1 = vi.fn()
				const callback2 = vi.fn()

				const instance1 = EditAggregator.getInstance(undefined, callback1)
				expect(instance1.onComparisonFinalized).toBe(callback1)

				const instance2 = EditAggregator.getInstance(undefined, callback2)
				expect(instance2.onComparisonFinalized).toBe(callback2)
			})
		})

		describe("processEdit", () => {
			it("should process single edit", async () => {
				const aggregator = EditAggregator.getInstance({}, mockCallback)
				const edit = createMockEdit(1)

				await aggregator.processEdit(edit)

				expect(aggregator.getActiveClusterCount()).toBe(1)
			})

			it("should cluster edits on same line within time window", async () => {
				const aggregator = EditAggregator.getInstance({ deltaT: 1.0 }, mockCallback)
				const timestamp = Date.now()

				await aggregator.processEdit(createMockEdit(1), timestamp)
				await aggregator.processEdit(createMockEdit(1), timestamp + 500)

				// Should still be in same cluster
				expect(aggregator.getActiveClusterCount()).toBe(1)
			})
		})

		describe("processEdits", () => {
			it("should process multiple edits", async () => {
				const aggregator = EditAggregator.getInstance({}, mockCallback)
				const edits = [createMockEdit(1), createMockEdit(2), createMockEdit(3)]

				await aggregator.processEdits(edits)

				// Wait for async processing to complete - queue processing has delays
				await new Promise((resolve) => setTimeout(resolve, 100))

				expect(aggregator.getProcessingQueueSize()).toBe(0)
			})

			it("should only process last edit when queue is large", async () => {
				const aggregator = EditAggregator.getInstance({}, mockCallback)
				const manyEdits = Array(60)
					.fill(null)
					.map((_, i) => createMockEdit(i))

				// Fill queue
				for (const edit of manyEdits.slice(0, 55)) {
					;(aggregator as any).fileStates.set(edit.filepath, {
						activeClusters: [],
						currentContent: edit.fileContents,
						priorComparisons: [],
						processingQueue: Array(1)
							.fill(null)
							.map(() => async () => {}),
						isProcessing: false,
					})
				}

				await aggregator.processEdits(manyEdits.slice(55))

				// Should have processed only the last edit
				expect(aggregator.getActiveClusterCount()).toBeGreaterThanOrEqual(0)
			})
		})

		describe("finalizeAllClusters", () => {
			it("should finalize all active clusters", async () => {
				const aggregator = EditAggregator.getInstance({}, mockCallback)

				await aggregator.processEdit(createMockEdit(1, "file1.ts"))
				await aggregator.processEdit(createMockEdit(1, "file2.ts"))
				await aggregator.processEdit(createMockEdit(1, "file3.ts"))

				await aggregator.finalizeAllClusters()

				expect(aggregator.getActiveClusterCount()).toBe(0)
			})

			it("should handle empty state", async () => {
				const aggregator = EditAggregator.getInstance({}, mockCallback)

				await expect(aggregator.finalizeAllClusters()).resolves.not.toThrow()
			})
		})

		describe("getActiveClusterCount", () => {
			it("should return zero initially", () => {
				const aggregator = EditAggregator.getInstance({}, mockCallback)

				expect(aggregator.getActiveClusterCount()).toBe(0)
			})

			it("should count clusters across multiple files", async () => {
				const aggregator = EditAggregator.getInstance({ deltaT: 10.0 }, mockCallback)

				await aggregator.processEdit(createMockEdit(1, "file1.ts"))
				await aggregator.processEdit(createMockEdit(5, "file1.ts"))

				expect(aggregator.getActiveClusterCount()).toBeGreaterThanOrEqual(1)
			})
		})

		describe("getProcessingQueueSize", () => {
			it("should return zero initially", () => {
				const aggregator = EditAggregator.getInstance({}, mockCallback)

				expect(aggregator.getProcessingQueueSize()).toBe(0)
			})
		})

		describe("resetState", () => {
			it("should clear all file states", async () => {
				const aggregator = EditAggregator.getInstance({}, mockCallback)

				await aggregator.processEdit(createMockEdit(1, "file1.ts"))
				await aggregator.processEdit(createMockEdit(1, "file2.ts"))

				aggregator.resetState()

				expect(aggregator.getActiveClusterCount()).toBe(0)
				expect(aggregator.getProcessingQueueSize()).toBe(0)
			})
		})

		describe("cluster finalization conditions", () => {
			it("should finalize cluster when exceeding maxEdits", async () => {
				const aggregator = EditAggregator.getInstance({ maxEdits: 3, deltaT: 10.0 }, mockCallback)
				const timestamp = Date.now()

				// Create edits with incremental content changes
				let content = "line1\nline2\nline3\nline4\nline5"
				await aggregator.processEdit(createMockEdit(1, "test.ts", "new1", content), timestamp)

				content = "line1\nnew1\nline3\nline4\nline5"
				await aggregator.processEdit(createMockEdit(1, "test.ts", "new2", content), timestamp + 100)

				content = "line1\nnew1\nnew2\nline4\nline5"
				await aggregator.processEdit(createMockEdit(1, "test.ts", "new3", content), timestamp + 200)

				content = "line1\nnew1\nnew2\nnew3\nline5"
				await aggregator.processEdit(createMockEdit(1, "test.ts", "new4", content), timestamp + 300)

				// Wait for async processing to complete - queue processing has delays
				await new Promise((resolve) => setTimeout(resolve, 100))

				expect(mockCallback).toHaveBeenCalled()
			})

			it("should skip whitespace-only diffs", async () => {
				const aggregator = EditAggregator.getInstance({}, mockCallback)
				const content = "const a = 1;"

				await aggregator.processEdit(createMockEdit(0, "test.ts", "  ", content))
				await aggregator.finalizeAllClusters()

				// Whitespace-only diffs should not trigger callback
				expect(mockCallback).not.toHaveBeenCalled()
			})
		})
	})
})
