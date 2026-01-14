/**
 * Unit tests for EditAnalyzer service
 *
 * Tests for T014: EditAnalyzer code analysis and edit suggestion generation
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { EditAnalyzer } from "@/services/next-edit/EditAnalyzer"
import type { EditSuggestion, EditContext, EditCategory } from "@/services/next-edit/types"
import { createAnalysisFailedError } from "@/services/next-edit/errors"

// Mock VSCode ExtensionContext
const createMockContext = () => ({
	workspaceState: {
		get: vi.fn(),
		update: vi.fn(),
	},
})

describe("EditAnalyzer", () => {
	let analyzer: EditAnalyzer
	let mockContext: any

	beforeEach(() => {
		mockContext = createMockContext()
		analyzer = new EditAnalyzer(mockContext)
	})

	describe("analyzeCodebase", () => {
		it("should analyze codebase and return results", async () => {
			const result = await analyzer.analyzeCodebase(
				"file:///test/workspace",
				"Refactor code to use modern patterns",
			)

			expect(result).toHaveProperty("edits")
			expect(result).toHaveProperty("totalFiles")
			expect(result).toHaveProperty("estimatedTime")
			expect(Array.isArray(result.edits)).toBe(true)
			expect(typeof result.totalFiles).toBe("number")
			expect(typeof result.estimatedTime).toBe("number")
		})

		it("should throw error for empty workspace URI", async () => {
			await expect(analyzer.analyzeCodebase("", "Test goal")).rejects.toThrow("Workspace URI is required")
		})

		it("should throw error for empty goal", async () => {
			await expect(analyzer.analyzeCodebase("file:///test/workspace", "")).rejects.toThrow("Goal is required")
		})

		it("should respect include patterns", async () => {
			const result = await analyzer.analyzeCodebase("file:///test/workspace", "Test goal", {
				includePatterns: ["**/*.ts", "**/*.tsx"],
			})

			expect(result.edits).toBeDefined()
		})

		it("should respect exclude patterns", async () => {
			const result = await analyzer.analyzeCodebase("file:///test/workspace", "Test goal", {
				excludePatterns: ["**/*.test.ts", "**/node_modules/**"],
			})

			expect(result.edits).toBeDefined()
		})

		it("should respect max files limit", async () => {
			const result = await analyzer.analyzeCodebase("file:///test/workspace", "Test goal", {
				maxFiles: 100,
			})

			expect(result.totalFiles).toBeLessThanOrEqual(100)
		})
	})

	describe("generateEditSuggestions", () => {
		it("should generate edit suggestions from analysis data", async () => {
			const analysisData = {
				files: [
					{
						path: "file:///test/workspace/src/test.ts",
						issues: [
							{
								line: 10,
								type: "refactor",
								description: "Use const instead of var",
							},
						],
					},
				],
			}

			const suggestions = await analyzer.generateEditSuggestions(analysisData, "session-1")

			expect(Array.isArray(suggestions)).toBe(true)
			expect(suggestions.length).toBeGreaterThan(0)
			expect(suggestions[0]).toHaveProperty("id")
			expect(suggestions[0]).toHaveProperty("sessionId", "session-1")
			expect(suggestions[0]).toHaveProperty("filePath")
			expect(suggestions[0]).toHaveProperty("lineStart")
			expect(suggestions[0]).toHaveProperty("lineEnd")
			expect(suggestions[0]).toHaveProperty("originalContent")
			expect(suggestions[0]).toHaveProperty("suggestedContent")
			expect(suggestions[0]).toHaveProperty("rationale")
			expect(suggestions[0]).toHaveProperty("confidence")
			expect(suggestions[0]).toHaveProperty("status")
		})

		it("should throw error for empty session ID", async () => {
			await expect(analyzer.generateEditSuggestions({}, "")).rejects.toThrow("Session ID is required")
		})
	})

	describe("calculateConfidence", () => {
		it("should return confidence score between 0 and 1", () => {
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

			const confidence = analyzer.calculateConfidence(edit)

			expect(confidence).toBeGreaterThanOrEqual(0)
			expect(confidence).toBeLessThanOrEqual(1)
		})

		it("should calculate higher confidence for clear edits", () => {
			const clearEdit: EditSuggestion = {
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

			const ambiguousEdit: EditSuggestion = {
				id: "edit-2",
				sessionId: "session-1",
				filePath: "file:///test/workspace/src/test.ts",
				lineStart: 20,
				lineEnd: 20,
				originalContent: "x = 1;",
				suggestedContent: "const x = 1;",
				rationale: "Maybe use const?",
				confidence: 0.5,
				dependencies: [],
				dependents: [],
				status: "pending" as any,
				language: "typescript",
				category: "refactor" as EditCategory,
				priority: 1,
			}

			const clearConfidence = analyzer.calculateConfidence(clearEdit)
			const ambiguousConfidence = analyzer.calculateConfidence(ambiguousEdit)

			expect(clearConfidence).toBeGreaterThan(ambiguousConfidence)
		})
	})

	describe("generateContext", () => {
		it("should generate context for an edit", async () => {
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

			const fileContent = `
function test() {
	var x = 1;
	return x;
}
`

			const context = await analyzer.generateContext(edit, fileContent)

			expect(context).toHaveProperty("id")
			expect(context).toHaveProperty("editId", "edit-1")
			expect(context).toHaveProperty("surroundingLines")
			expect(context).toHaveProperty("imports")
			expect(context).toHaveProperty("exports")
			expect(context).toHaveProperty("analysisMethod")
			expect(context).toHaveProperty("semanticScore")
			expect(context).toHaveProperty("fileHash")
			expect(Array.isArray(context.surroundingLines)).toBe(true)
		})

		it("should throw error for missing edit", async () => {
			await expect(analyzer.generateContext(null as any, "content")).rejects.toThrow("Edit is required")
		})

		it("should throw error for missing file content", async () => {
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

			await expect(analyzer.generateContext(edit, "")).rejects.toThrow("File content is required")
		})
	})
})
