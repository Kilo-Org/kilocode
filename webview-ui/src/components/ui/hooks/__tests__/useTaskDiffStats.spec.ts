// kilocode_change - new file
// npx vitest src/components/ui/hooks/__tests__/useTaskDiffStats.spec.ts

import { renderHook } from "@testing-library/react"
import type { ClineMessage } from "@roo-code/types"
import { useTaskDiffStats } from "../kilocode/useTaskDiffStats"

describe("useTaskDiffStats", () => {
	describe("basic functionality", () => {
		it("should return zero stats for empty messages array", () => {
			const { result } = renderHook(() => useTaskDiffStats([]))

			expect(result.current).toEqual({ added: 0, removed: 0 })
		})

		it("should return zero stats when no tool messages exist", () => {
			const messages: ClineMessage[] = [
				{ ts: 1, type: "say", say: "text", text: "Hello" },
				{ ts: 2, type: "say", say: "text", text: "World" },
			]

			const { result } = renderHook(() => useTaskDiffStats(messages))

			expect(result.current).toEqual({ added: 0, removed: 0 })
		})

		it("should aggregate stats from tool messages (isAnswered is not required)", () => {
			// Tool messages don't have isAnswered set - they are accepted when the user approves them
			// The hook now processes all tool messages with diffStats
			const messages: ClineMessage[] = [
				{
					ts: 1,
					type: "ask",
					ask: "tool",
					text: JSON.stringify({
						tool: "editedExistingFile",
						path: "test.ts",
						diffStats: { added: 10, removed: 5 },
					}),
					isAnswered: false,
				},
			]

			const { result } = renderHook(() => useTaskDiffStats(messages))

			expect(result.current).toEqual({ added: 10, removed: 5 })
		})
	})

	describe("single file operations", () => {
		it("should aggregate stats from answered editedExistingFile tool", () => {
			const messages: ClineMessage[] = [
				{
					ts: 1,
					type: "ask",
					ask: "tool",
					text: JSON.stringify({
						tool: "editedExistingFile",
						path: "test.ts",
						diffStats: { added: 10, removed: 5 },
					}),
					isAnswered: true,
				},
			]

			const { result } = renderHook(() => useTaskDiffStats(messages))

			expect(result.current).toEqual({ added: 10, removed: 5 })
		})

		it("should aggregate stats from answered appliedDiff tool", () => {
			const messages: ClineMessage[] = [
				{
					ts: 1,
					type: "ask",
					ask: "tool",
					text: JSON.stringify({
						tool: "appliedDiff",
						path: "test.ts",
						diffStats: { added: 8, removed: 3 },
					}),
					isAnswered: true,
				},
			]

			const { result } = renderHook(() => useTaskDiffStats(messages))

			expect(result.current).toEqual({ added: 8, removed: 3 })
		})

		it("should aggregate stats from answered newFileCreated tool", () => {
			const messages: ClineMessage[] = [
				{
					ts: 1,
					type: "ask",
					ask: "tool",
					text: JSON.stringify({
						tool: "newFileCreated",
						path: "new-file.ts",
						diffStats: { added: 50, removed: 0 },
					}),
					isAnswered: true,
				},
			]

			const { result } = renderHook(() => useTaskDiffStats(messages))

			expect(result.current).toEqual({ added: 50, removed: 0 })
		})

		it("should aggregate stats from answered searchAndReplace tool", () => {
			const messages: ClineMessage[] = [
				{
					ts: 1,
					type: "ask",
					ask: "tool",
					text: JSON.stringify({
						tool: "searchAndReplace",
						path: "test.ts",
						diffStats: { added: 2, removed: 2 },
					}),
					isAnswered: true,
				},
			]

			const { result } = renderHook(() => useTaskDiffStats(messages))

			expect(result.current).toEqual({ added: 2, removed: 2 })
		})

		it("should aggregate stats from answered insertContent tool", () => {
			const messages: ClineMessage[] = [
				{
					ts: 1,
					type: "ask",
					ask: "tool",
					text: JSON.stringify({
						tool: "insertContent",
						path: "test.ts",
						diffStats: { added: 15, removed: 0 },
					}),
					isAnswered: true,
				},
			]

			const { result } = renderHook(() => useTaskDiffStats(messages))

			expect(result.current).toEqual({ added: 15, removed: 0 })
		})
	})

	describe("multiple operations", () => {
		it("should aggregate stats from multiple answered tool messages", () => {
			const messages: ClineMessage[] = [
				{
					ts: 1,
					type: "ask",
					ask: "tool",
					text: JSON.stringify({
						tool: "editedExistingFile",
						path: "file1.ts",
						diffStats: { added: 10, removed: 5 },
					}),
					isAnswered: true,
				},
				{
					ts: 2,
					type: "ask",
					ask: "tool",
					text: JSON.stringify({
						tool: "newFileCreated",
						path: "file2.ts",
						diffStats: { added: 20, removed: 0 },
					}),
					isAnswered: true,
				},
				{
					ts: 3,
					type: "ask",
					ask: "tool",
					text: JSON.stringify({
						tool: "appliedDiff",
						path: "file3.ts",
						diffStats: { added: 5, removed: 10 },
					}),
					isAnswered: true,
				},
			]

			const { result } = renderHook(() => useTaskDiffStats(messages))

			expect(result.current).toEqual({ added: 35, removed: 15 })
		})

		it("should count all tool messages regardless of isAnswered", () => {
			// Tool messages don't have isAnswered set - they are accepted when the user approves them
			// The hook now processes all tool messages with diffStats
			const messages: ClineMessage[] = [
				{
					ts: 1,
					type: "ask",
					ask: "tool",
					text: JSON.stringify({
						tool: "editedExistingFile",
						path: "file1.ts",
						diffStats: { added: 10, removed: 5 },
					}),
					isAnswered: true,
				},
				{
					ts: 2,
					type: "ask",
					ask: "tool",
					text: JSON.stringify({
						tool: "editedExistingFile",
						path: "file2.ts",
						diffStats: { added: 100, removed: 50 },
					}),
					isAnswered: false, // isAnswered is not used for filtering
				},
			]

			const { result } = renderHook(() => useTaskDiffStats(messages))

			expect(result.current).toEqual({ added: 110, removed: 55 })
		})
	})

	describe("batch operations", () => {
		it("should aggregate stats from batch diffs", () => {
			const messages: ClineMessage[] = [
				{
					ts: 1,
					type: "ask",
					ask: "tool",
					text: JSON.stringify({
						tool: "appliedDiff",
						batchDiffs: [
							{ path: "file1.ts", diffStats: { added: 10, removed: 5 } },
							{ path: "file2.ts", diffStats: { added: 20, removed: 10 } },
							{ path: "file3.ts", diffStats: { added: 5, removed: 2 } },
						],
					}),
					isAnswered: true,
				},
			]

			const { result } = renderHook(() => useTaskDiffStats(messages))

			expect(result.current).toEqual({ added: 35, removed: 17 })
		})

		it("should handle batch diffs with missing diffStats", () => {
			const messages: ClineMessage[] = [
				{
					ts: 1,
					type: "ask",
					ask: "tool",
					text: JSON.stringify({
						tool: "appliedDiff",
						batchDiffs: [
							{ path: "file1.ts", diffStats: { added: 10, removed: 5 } },
							{ path: "file2.ts" }, // No diffStats
							{ path: "file3.ts", diffStats: { added: 5, removed: 2 } },
						],
					}),
					isAnswered: true,
				},
			]

			const { result } = renderHook(() => useTaskDiffStats(messages))

			expect(result.current).toEqual({ added: 15, removed: 7 })
		})
	})

	describe("non-diff tools", () => {
		it("should ignore non-diff tools like readFile", () => {
			const messages: ClineMessage[] = [
				{
					ts: 1,
					type: "ask",
					ask: "tool",
					text: JSON.stringify({
						tool: "readFile",
						path: "test.ts",
					}),
					isAnswered: true,
				},
			]

			const { result } = renderHook(() => useTaskDiffStats(messages))

			expect(result.current).toEqual({ added: 0, removed: 0 })
		})

		it("should ignore listFilesTopLevel tool", () => {
			const messages: ClineMessage[] = [
				{
					ts: 1,
					type: "ask",
					ask: "tool",
					text: JSON.stringify({
						tool: "listFilesTopLevel",
						path: "src",
					}),
					isAnswered: true,
				},
			]

			const { result } = renderHook(() => useTaskDiffStats(messages))

			expect(result.current).toEqual({ added: 0, removed: 0 })
		})
	})

	describe("edge cases", () => {
		it("should handle invalid JSON gracefully", () => {
			const messages: ClineMessage[] = [
				{
					ts: 1,
					type: "ask",
					ask: "tool",
					text: "invalid json",
					isAnswered: true,
				},
			]

			const { result } = renderHook(() => useTaskDiffStats(messages))

			expect(result.current).toEqual({ added: 0, removed: 0 })
		})

		it("should handle missing diffStats gracefully", () => {
			const messages: ClineMessage[] = [
				{
					ts: 1,
					type: "ask",
					ask: "tool",
					text: JSON.stringify({
						tool: "editedExistingFile",
						path: "test.ts",
						// No diffStats
					}),
					isAnswered: true,
				},
			]

			const { result } = renderHook(() => useTaskDiffStats(messages))

			expect(result.current).toEqual({ added: 0, removed: 0 })
		})

		it("should handle null/undefined values in diffStats", () => {
			const messages: ClineMessage[] = [
				{
					ts: 1,
					type: "ask",
					ask: "tool",
					text: JSON.stringify({
						tool: "editedExistingFile",
						path: "test.ts",
						diffStats: { added: null, removed: undefined },
					}),
					isAnswered: true,
				},
			]

			const { result } = renderHook(() => useTaskDiffStats(messages))

			expect(result.current).toEqual({ added: 0, removed: 0 })
		})
	})
})
