/**
 * Unit tests for EditSequencer service
 *
 * Tests for T015: EditSequencer edit ordering and dependency resolution
 */

import { describe, it, expect, beforeEach } from "vitest"
import { EditSequencer } from "@/services/next-edit/EditSequencer"
import type { EditSuggestion, EditCategory } from "@/services/next-edit/types"
import { createDependencyNotMetError } from "@/services/next-edit/errors"

describe("EditSequencer", () => {
	let sequencer: EditSequencer

	beforeEach(() => {
		sequencer = new EditSequencer()
	})

	describe("sequenceEdits", () => {
		it("should return empty result for empty edits", async () => {
			const result = await sequencer.sequenceEdits([])

			expect(result.orderedEditIds).toEqual([])
			expect(result.sequenceCount).toBe(0)
			expect(result.circularDependencies).toEqual([])
		})

		it("should order edits based on dependencies", async () => {
			const edit1: EditSuggestion = {
				id: "edit-1",
				sessionId: "session-1",
				filePath: "file:///test/workspace/src/types.ts",
				lineStart: 1,
				lineEnd: 10,
				originalContent: "type User = { name: string }",
				suggestedContent: "interface User { name: string }",
				rationale: "Use interface for type definition",
				confidence: 0.9,
				dependencies: [],
				dependents: ["edit-2"],
				status: "pending" as any,
				language: "typescript",
				category: "refactor" as EditCategory,
				priority: 1,
			}

			const edit2: EditSuggestion = {
				id: "edit-2",
				sessionId: "session-1",
				filePath: "file:///test/workspace/src/user.ts",
				lineStart: 1,
				lineEnd: 10,
				originalContent: 'const user: User = { name: "test" }',
				suggestedContent: 'const user: User = { name: "test" }',
				rationale: "Use User interface",
				confidence: 0.9,
				dependencies: ["edit-1"],
				dependents: [],
				status: "pending" as any,
				language: "typescript",
				category: "refactor" as EditCategory,
				priority: 1,
			}

			const result = await sequencer.sequenceEdits([edit2, edit1])

			expect(result.orderedEditIds).toEqual(["edit-1", "edit-2"])
		})

		it("should handle edits without dependencies", async () => {
			const edit1: EditSuggestion = {
				id: "edit-1",
				sessionId: "session-1",
				filePath: "file:///test/workspace/src/file1.ts",
				lineStart: 1,
				lineEnd: 1,
				originalContent: "var x = 1",
				suggestedContent: "const x = 1",
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
				originalContent: "var y = 2",
				suggestedContent: "const y = 2",
				rationale: "Use const",
				confidence: 0.9,
				dependencies: [],
				dependents: [],
				status: "pending" as any,
				language: "typescript",
				category: "refactor" as EditCategory,
				priority: 1,
			}

			const result = await sequencer.sequenceEdits([edit1, edit2])

			expect(result.orderedEditIds).toContain("edit-1")
			expect(result.orderedEditIds).toContain("edit-2")
			expect(result.orderedEditIds.length).toBe(2)
		})

		it("should detect circular dependencies", async () => {
			const edit1: EditSuggestion = {
				id: "edit-1",
				sessionId: "session-1",
				filePath: "file:///test/workspace/src/file1.ts",
				lineStart: 1,
				lineEnd: 1,
				originalContent: "var x = 1",
				suggestedContent: "const x = 1",
				rationale: "Use const",
				confidence: 0.9,
				dependencies: ["edit-2"],
				dependents: ["edit-2"],
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
				originalContent: "var y = 2",
				suggestedContent: "const y = 2",
				rationale: "Use const",
				confidence: 0.9,
				dependencies: ["edit-1"],
				dependents: ["edit-1"],
				status: "pending" as any,
				language: "typescript",
				category: "refactor" as EditCategory,
				priority: 1,
			}

			const result = await sequencer.sequenceEdits([edit1, edit2])

			expect(result.circularDependencies.length).toBeGreaterThan(0)
			expect(result.circularDependencies[0].editId).toBeDefined()
			expect(result.circularDependencies[0].dependencyCycle).toContain("edit-1")
			expect(result.circularDependencies[0].dependencyCycle).toContain("edit-2")
		})
	})

	describe("resolveDependencies", () => {
		it("should resolve dependencies between edits", async () => {
			const edit1: EditSuggestion = {
				id: "edit-1",
				sessionId: "session-1",
				filePath: "file:///test/workspace/src/types.ts",
				lineStart: 1,
				lineEnd: 10,
				originalContent: "type User = { name: string }",
				suggestedContent: "interface User { name: string }",
				rationale: "Use interface",
				confidence: 0.9,
				dependencies: [],
				dependents: ["edit-2"],
				status: "pending" as any,
				language: "typescript",
				category: "refactor" as EditCategory,
				priority: 1,
			}

			const edit2: EditSuggestion = {
				id: "edit-2",
				sessionId: "session-1",
				filePath: "file:///test/workspace/src/user.ts",
				lineStart: 1,
				lineEnd: 10,
				originalContent: 'const user: User = { name: "test" }',
				suggestedContent: 'const user: User = { name: "test" }',
				rationale: "Use User interface",
				confidence: 0.9,
				dependencies: ["edit-1"],
				dependents: [],
				status: "pending" as any,
				language: "typescript",
				category: "refactor" as EditCategory,
				priority: 1,
			}

			const dependencies = await sequencer.resolveDependencies([edit1, edit2])

			expect(dependencies).toBeInstanceOf(Map)
			expect(dependencies.get("edit-1")).toEqual([])
			expect(dependencies.get("edit-2")).toEqual(["edit-1"])
		})

		it("should return empty map for null input", async () => {
			const dependencies = await sequencer.resolveDependencies(null as any)

			expect(dependencies).toBeInstanceOf(Map)
			expect(dependencies.size).toBe(0)
		})
	})

	describe("detectCircularDependencies", () => {
		it("should detect circular dependencies", () => {
			const edit1: EditSuggestion = {
				id: "edit-1",
				sessionId: "session-1",
				filePath: "file:///test/workspace/src/file1.ts",
				lineStart: 1,
				lineEnd: 1,
				originalContent: "var x = 1",
				suggestedContent: "const x = 1",
				rationale: "Use const",
				confidence: 0.9,
				dependencies: ["edit-2"],
				dependents: ["edit-2"],
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
				originalContent: "var y = 2",
				suggestedContent: "const y = 2",
				rationale: "Use const",
				confidence: 0.9,
				dependencies: ["edit-1"],
				dependents: ["edit-1"],
				status: "pending" as any,
				language: "typescript",
				category: "refactor" as EditCategory,
				priority: 1,
			}

			const cycles = sequencer.detectCircularDependencies([edit1, edit2])

			expect(cycles.length).toBeGreaterThan(0)
			expect(cycles[0].editId).toBeDefined()
			expect(cycles[0].dependencyCycle).toContain("edit-1")
			expect(cycles[0].dependencyCycle).toContain("edit-2")
		})

		it("should return empty array for no circular dependencies", () => {
			const edit1: EditSuggestion = {
				id: "edit-1",
				sessionId: "session-1",
				filePath: "file:///test/workspace/src/file1.ts",
				lineStart: 1,
				lineEnd: 1,
				originalContent: "var x = 1",
				suggestedContent: "const x = 1",
				rationale: "Use const",
				confidence: 0.9,
				dependencies: [],
				dependents: ["edit-2"],
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
				originalContent: "var y = 2",
				suggestedContent: "const y = 2",
				rationale: "Use const",
				confidence: 0.9,
				dependencies: ["edit-1"],
				dependents: [],
				status: "pending" as any,
				language: "typescript",
				category: "refactor" as EditCategory,
				priority: 1,
			}

			const cycles = sequencer.detectCircularDependencies([edit1, edit2])

			expect(cycles).toEqual([])
		})

		it("should return empty array for empty input", () => {
			const cycles = sequencer.detectCircularDependencies([])

			expect(cycles).toEqual([])
		})
	})

	describe("validateDependenciesMet", () => {
		it("should return true when all dependencies are met", () => {
			const edit: EditSuggestion = {
				id: "edit-2",
				sessionId: "session-1",
				filePath: "file:///test/workspace/src/file2.ts",
				lineStart: 1,
				lineEnd: 1,
				originalContent: 'const user: User = { name: "test" }',
				suggestedContent: 'const user: User = { name: "test" }',
				rationale: "Use User interface",
				confidence: 0.9,
				dependencies: ["edit-1"],
				dependents: [],
				status: "pending" as any,
				language: "typescript",
				category: "refactor" as EditCategory,
				priority: 1,
			}

			const result = sequencer.validateDependenciesMet(edit, ["edit-1"])

			expect(result).toBe(true)
		})

		it("should return false when dependencies are not met", () => {
			const edit: EditSuggestion = {
				id: "edit-2",
				sessionId: "session-1",
				filePath: "file:///test/workspace/src/file2.ts",
				lineStart: 1,
				lineEnd: 1,
				originalContent: 'const user: User = { name: "test" }',
				suggestedContent: 'const user: User = { name: "test" }',
				rationale: "Use User interface",
				confidence: 0.9,
				dependencies: ["edit-1", "edit-3"],
				dependents: [],
				status: "pending" as any,
				language: "typescript",
				category: "refactor" as EditCategory,
				priority: 1,
			}

			const result = sequencer.validateDependenciesMet(edit, ["edit-1"])

			expect(result).toBe(false)
		})

		it("should return true for edit with no dependencies", () => {
			const edit: EditSuggestion = {
				id: "edit-1",
				sessionId: "session-1",
				filePath: "file:///test/workspace/src/file1.ts",
				lineStart: 1,
				lineEnd: 1,
				originalContent: "var x = 1",
				suggestedContent: "const x = 1",
				rationale: "Use const",
				confidence: 0.9,
				dependencies: [],
				dependents: [],
				status: "pending" as any,
				language: "typescript",
				category: "refactor" as EditCategory,
				priority: 1,
			}

			const result = sequencer.validateDependenciesMet(edit, [])

			expect(result).toBe(true)
		})

		it("should throw error for null edit", () => {
			expect(() => {
				sequencer.validateDependenciesMet(null as any, [])
			}).toThrow("Edit is required")
		})
	})
})
