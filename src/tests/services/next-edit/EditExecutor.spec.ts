/**
 * Unit tests for EditExecutor service
 *
 * Tests for T016: EditExecutor edit application and diff generation
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { EditExecutor } from "@/services/next-edit/EditExecutor"
import type { EditSuggestion, EditAction, EditCategory } from "@/services/next-edit/types"
import { createApplyFailedError, createFileNotFoundError } from "@/services/next-edit/errors"

// Mock VSCode ExtensionContext
const createMockContext = () => ({
	workspaceState: {
		get: vi.fn(),
		update: vi.fn(),
	},
})

describe("EditExecutor", () => {
	let executor: EditExecutor
	let mockContext: any

	beforeEach(() => {
		mockContext = createMockContext()
		executor = new EditExecutor(mockContext)
	})

	describe("applyEdit", () => {
		it("should apply an edit successfully", async () => {
			const edit: EditSuggestion = {
				id: "edit-1",
				sessionId: "session-1",
				filePath: "file:///test/workspace/src/test.ts",
				lineStart: 10,
				lineEnd: 10,
				originalContent: "var x = 1;",
				suggestedContent: "const x = 1;",
				rationale: "Use const for variables that are not reassigned",
				confidence: 0.9,
				dependencies: [],
				dependents: [],
				status: "pending" as any,
				language: "typescript",
				category: "refactor" as EditCategory,
				priority: 1,
			}

			const result = await executor.applyEdit(edit)

			expect(result).toHaveProperty("action")
			expect(result).toHaveProperty("success")
			expect(result.success).toBe(true)
			expect(result.action).toHaveProperty("id")
			expect(result.action).toHaveProperty("editId", "edit-1")
			expect(result.action).toHaveProperty("action", "accept")
		})

		it("should apply edit with user modification", async () => {
			const edit: EditSuggestion = {
				id: "edit-1",
				sessionId: "session-1",
				filePath: "file:///test/workspace/src/test.ts",
				lineStart: 10,
				lineEnd: 10,
				originalContent: "var x = 1;",
				suggestedContent: "const x = 1;",
				rationale: "Use const for variables that are not reassigned",
				confidence: 0.9,
				dependencies: [],
				dependents: [],
				status: "pending" as any,
				language: "typescript",
				category: "refactor" as EditCategory,
				priority: 1,
			}

			const modification = "let x = 1;"

			const result = await executor.applyEdit(edit, modification)

			expect(result.success).toBe(true)
			expect(result.action.appliedContent).toBe(modification)
		})

		it("should throw error for null edit", async () => {
			await expect(executor.applyEdit(null as any)).rejects.toThrow("Edit is required")
		})
	})

	describe("generateDiff", () => {
		it("should generate unified diff for an edit", () => {
			const edit: EditSuggestion = {
				id: "edit-1",
				sessionId: "session-1",
				filePath: "file:///test/workspace/src/test.ts",
				lineStart: 10,
				lineEnd: 10,
				originalContent: "var x = 1;",
				suggestedContent: "const x = 1;",
				rationale: "Use const for variables that are not reassigned",
				confidence: 0.9,
				dependencies: [],
				dependents: [],
				status: "pending" as any,
				language: "typescript",
				category: "refactor" as EditCategory,
				priority: 1,
			}

			const diff = executor.generateDiff(edit)

			expect(typeof diff).toBe("string")
			expect(diff).toContain("-")
			expect(diff).toContain("+")
			expect(diff).toContain("var x = 1;")
			expect(diff).toContain("const x = 1;")
		})

		it("should throw error for null edit", () => {
			expect(() => executor.generateDiff(null as any)).toThrow("Edit is required")
		})
	})

	describe("bulkApplyEdits", () => {
		it("should apply multiple edits in bulk", async () => {
			const edit1: EditSuggestion = {
				id: "edit-1",
				sessionId: "session-1",
				filePath: "file:///test/workspace/src/file1.ts",
				lineStart: 1,
				lineEnd: 1,
				originalContent: "var x = 1;",
				suggestedContent: "const x = 1;",
				rationale: "Use const",
				confidence: 0.9,
				dependencies: [],
				dependents: [],
				status: "pending" as any,
				language: "typescript",
				category: "refactor" as EditCategory,
				priority: 1,
			}

			const edit2: EditSuggestion = {
				id: "edit-2",
				sessionId: "session-1",
				filePath: "file:///test/workspace/src/file2.ts",
				lineStart: 1,
				lineEnd: 1,
				originalContent: "var y = 2;",
				suggestedContent: "const y = 2;",
				rationale: "Use const",
				confidence: 0.9,
				dependencies: [],
				dependents: [],
				status: "pending" as any,
				language: "typescript",
				category: "refactor" as EditCategory,
				priority: 1,
			}

			const result = await executor.bulkApplyEdits([edit1, edit2])

			expect(result).toHaveProperty("applied")
			expect(result).toHaveProperty("failed")
			expect(Array.isArray(result.applied)).toBe(true)
			expect(Array.isArray(result.failed)).toBe(true)
		})

		it("should return empty result for empty edits", async () => {
			const result = await executor.bulkApplyEdits([])

			expect(result.applied).toEqual([])
			expect(result.failed).toEqual([])
		})
	})

	describe("canUndo", () => {
		it("should return false for invalid session ID", () => {
			const result = executor.canUndo("")

			expect(result).toBe(false)
		})
	})

	describe("canRedo", () => {
		it("should return false for invalid session ID", () => {
			const result = executor.canRedo("")

			expect(result).toBe(false)
		})
	})

	describe("undoLastEdit", () => {
		it("should throw error for invalid session ID", async () => {
			await expect(executor.undoLastEdit("")).rejects.toThrow("Session ID is required")
		})

		it("should return null when undo stack is empty", async () => {
			const result = await executor.undoLastEdit("session-1")

			expect(result).toBeNull()
		})

		it("should undo single edit at edit level", async () => {
			const edit: EditSuggestion = {
				id: "edit-1",
				sessionId: "session-1",
				filePath: "file:///test/workspace/src/test.ts",
				lineStart: 10,
				lineEnd: 10,
				originalContent: "var x = 1;",
				suggestedContent: "const x = 1;",
				rationale: "Use const",
				confidence: 0.9,
				dependencies: [],
				dependents: [],
				status: "pending" as any,
				language: "typescript",
				category: "refactor" as EditCategory,
				priority: 1,
			}

			await executor.applyEdit(edit)
			const result = await executor.undoLastEdit("session-1", "edit")

			expect(result).not.toBeNull()
			expect(result).toHaveProperty("editId", "edit-1")
			expect(result).toHaveProperty("action", "accept")
		})

		it("should undo all edits for a file at file level", async () => {
			const edit1: EditSuggestion = {
				id: "edit-1",
				sessionId: "session-1",
				filePath: "file:///test/workspace/src/test.ts",
				lineStart: 10,
				lineEnd: 10,
				originalContent: "var x = 1;",
				suggestedContent: "const x = 1;",
				rationale: "Use const",
				confidence: 0.9,
				dependencies: [],
				dependents: [],
				status: "pending" as any,
				language: "typescript",
				category: "refactor" as EditCategory,
				priority: 1,
			}

			const edit2: EditSuggestion = {
				id: "edit-2",
				sessionId: "session-1",
				filePath: "file:///test/workspace/src/test.ts",
				lineStart: 20,
				lineEnd: 20,
				originalContent: "var y = 2;",
				suggestedContent: "const y = 2;",
				rationale: "Use const",
				confidence: 0.9,
				dependencies: [],
				dependents: [],
				status: "pending" as any,
				language: "typescript",
				category: "refactor" as EditCategory,
				priority: 1,
			}

			await executor.applyEdit(edit1)
			await executor.applyEdit(edit2)
			const result = await executor.undoLastEdit("session-1", "file")

			expect(result).not.toBeNull()
			expect(result).toHaveProperty("editId")
		})

		it("should undo all edits at all level", async () => {
			const edit1: EditSuggestion = {
				id: "edit-1",
				sessionId: "session-1",
				filePath: "file:///test/workspace/src/test.ts",
				lineStart: 10,
				lineEnd: 10,
				originalContent: "var x = 1;",
				suggestedContent: "const x = 1;",
				rationale: "Use const",
				confidence: 0.9,
				dependencies: [],
				dependents: [],
				status: "pending" as any,
				language: "typescript",
				category: "refactor" as EditCategory,
				priority: 1,
			}

			const edit2: EditSuggestion = {
				id: "edit-2",
				sessionId: "session-1",
				filePath: "file:///test/workspace/src/test2.ts",
				lineStart: 10,
				lineEnd: 10,
				originalContent: "var y = 2;",
				suggestedContent: "const y = 2;",
				rationale: "Use const",
				confidence: 0.9,
				dependencies: [],
				dependents: [],
				status: "pending" as any,
				language: "typescript",
				category: "refactor" as EditCategory,
				priority: 1,
			}

			await executor.applyEdit(edit1)
			await executor.applyEdit(edit2)
			const result = await executor.undoLastEdit("session-1", "all")

			expect(result).not.toBeNull()
			expect(executor.canUndo("session-1")).toBe(false)
		})
	})

	describe("redoLastEdit", () => {
		it("should throw error for invalid session ID", async () => {
			await expect(executor.redoLastEdit("")).rejects.toThrow("Session ID is required")
		})

		it("should return null when redo stack is empty", async () => {
			const result = await executor.redoLastEdit("session-1")

			expect(result).toBeNull()
		})

		it("should redo last undone edit", async () => {
			const edit: EditSuggestion = {
				id: "edit-1",
				sessionId: "session-1",
				filePath: "file:///test/workspace/src/test.ts",
				lineStart: 10,
				lineEnd: 10,
				originalContent: "var x = 1;",
				suggestedContent: "const x = 1;",
				rationale: "Use const",
				confidence: 0.9,
				dependencies: [],
				dependents: [],
				status: "pending" as any,
				language: "typescript",
				category: "refactor" as EditCategory,
				priority: 1,
			}

			await executor.applyEdit(edit)
			await executor.undoLastEdit("session-1")
			const result = await executor.redoLastEdit("session-1")

			expect(result).not.toBeNull()
			expect(result).toHaveProperty("editId", "edit-1")
			expect(result).toHaveProperty("action", "accept")
		})

		it("should clear redo stack after new edit", async () => {
			const edit1: EditSuggestion = {
				id: "edit-1",
				sessionId: "session-1",
				filePath: "file:///test/workspace/src/test.ts",
				lineStart: 10,
				lineEnd: 10,
				originalContent: "var x = 1;",
				suggestedContent: "const x = 1;",
				rationale: "Use const",
				confidence: 0.9,
				dependencies: [],
				dependents: [],
				status: "pending" as any,
				language: "typescript",
				category: "refactor" as EditCategory,
				priority: 1,
			}

			const edit2: EditSuggestion = {
				id: "edit-2",
				sessionId: "session-1",
				filePath: "file:///test/workspace/src/test2.ts",
				lineStart: 10,
				lineEnd: 10,
				originalContent: "var y = 2;",
				suggestedContent: "const y = 2;",
				rationale: "Use const",
				confidence: 0.9,
				dependencies: [],
				dependents: [],
				status: "pending" as any,
				language: "typescript",
				category: "refactor" as EditCategory,
				priority: 1,
			}

			await executor.applyEdit(edit1)
			await executor.undoLastEdit("session-1")
			await executor.applyEdit(edit2)

			expect(executor.canRedo("session-1")).toBe(false)
		})
	})

	describe("getGitDiff", () => {
		it("should throw error for null edit", async () => {
			await expect(executor.getGitDiff(null as any)).rejects.toThrow("Edit is required")
		})

		it("should generate git diff for an edit", async () => {
			const edit: EditSuggestion = {
				id: "edit-1",
				sessionId: "session-1",
				filePath: "file:///test/workspace/src/test.ts",
				lineStart: 10,
				lineEnd: 10,
				originalContent: "var x = 1;",
				suggestedContent: "const x = 1;",
				rationale: "Use const",
				confidence: 0.9,
				dependencies: [],
				dependents: [],
				status: "pending" as any,
				language: "typescript",
				category: "refactor" as EditCategory,
				priority: 1,
			}

			const diff = await executor.getGitDiff(edit)

			expect(typeof diff).toBe("string")
			expect(diff).toContain("---")
			expect(diff).toContain("+++")
			expect(diff).toContain("file:///test/workspace/src/test.ts")
		})
	})

	describe("previewAllChanges", () => {
		it("should throw error for invalid session ID", async () => {
			await expect(executor.previewAllChanges("")).rejects.toThrow("Session ID is required")
		})

		it("should return empty array for session with no changes", async () => {
			const result = await executor.previewAllChanges("session-1")

			expect(Array.isArray(result)).toBe(true)
			expect(result.length).toBe(0)
		})

		it("should preview all changes for a session", async () => {
			const edit1: EditSuggestion = {
				id: "edit-1",
				sessionId: "session-1",
				filePath: "file:///test/workspace/src/test.ts",
				lineStart: 10,
				lineEnd: 10,
				originalContent: "var x = 1;",
				suggestedContent: "const x = 1;",
				rationale: "Use const",
				confidence: 0.9,
				dependencies: [],
				dependents: [],
				status: "pending" as any,
				language: "typescript",
				category: "refactor" as EditCategory,
				priority: 1,
			}

			const edit2: EditSuggestion = {
				id: "edit-2",
				sessionId: "session-1",
				filePath: "file:///test/workspace/src/test2.ts",
				lineStart: 10,
				lineEnd: 10,
				originalContent: "var y = 2;",
				suggestedContent: "const y = 2;",
				rationale: "Use const",
				confidence: 0.9,
				dependencies: [],
				dependents: [],
				status: "pending" as any,
				language: "typescript",
				category: "refactor" as EditCategory,
				priority: 1,
			}

			await executor.applyEdit(edit1)
			await executor.applyEdit(edit2)
			const result = await executor.previewAllChanges("session-1")

			expect(Array.isArray(result)).toBe(true)
			expect(result.length).toBeGreaterThan(0)
			expect(result[0]).toHaveProperty("path")
			expect(result[0]).toHaveProperty("diff")
			expect(result[0]).toHaveProperty("status")
		})

		it("should aggregate changes by file", async () => {
			const edit1: EditSuggestion = {
				id: "edit-1",
				sessionId: "session-1",
				filePath: "file:///test/workspace/src/test.ts",
				lineStart: 10,
				lineEnd: 10,
				originalContent: "var x = 1;",
				suggestedContent: "const x = 1;",
				rationale: "Use const",
				confidence: 0.9,
				dependencies: [],
				dependents: [],
				status: "pending" as any,
				language: "typescript",
				category: "refactor" as EditCategory,
				priority: 1,
			}

			const edit2: EditSuggestion = {
				id: "edit-2",
				sessionId: "session-1",
				filePath: "file:///test/workspace/src/test.ts",
				lineStart: 20,
				lineEnd: 20,
				originalContent: "var y = 2;",
				suggestedContent: "const y = 2;",
				rationale: "Use const",
				confidence: 0.9,
				dependencies: [],
				dependents: [],
				status: "pending" as any,
				language: "typescript",
				category: "refactor" as EditCategory,
				priority: 1,
			}

			await executor.applyEdit(edit1)
			await executor.applyEdit(edit2)
			const result = await executor.previewAllChanges("session-1")

			// Should have only one entry for the single file
			expect(result.length).toBe(1)
			expect(result[0].path).toBe("file:///test/workspace/src/test.ts")
		})
	})
})
