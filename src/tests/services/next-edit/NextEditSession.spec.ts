/**
 * Unit tests for NextEditSession service
 *
 * Tests for T017: NextEditSession full lifecycle management
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { NextEditSession } from "@/services/next-edit/NextEditSession"
import type { EditSession, EditSuggestion, SessionStatus } from "@/services/next-edit/types"
import { createSessionNotFoundError, createInvalidSessionIdError } from "@/services/next-edit/errors"

// Mock VSCode ExtensionContext
const createMockContext = () => ({
	workspaceState: {
		get: vi.fn(),
		update: vi.fn(),
	},
})

// Mock services
const createMockStorage = () => ({
	saveSession: vi.fn(),
	loadSession: vi.fn(),
	deleteSession: vi.fn(),
	getActiveSessionId: vi.fn(),
	setActiveSessionId: vi.fn(),
	clearActiveSessionId: vi.fn(),
	listSessions: vi.fn(),
	getLastSessionId: vi.fn(),
	setLastSessionId: vi.fn(),
})

const createMockAnalyzer = () => ({
	analyzeCodebase: vi.fn(),
	generateEditSuggestions: vi.fn(),
	calculateConfidence: vi.fn(),
	generateContext: vi.fn(),
})

const createMockSequencer = () => ({
	sequenceEdits: vi.fn(),
	resolveDependencies: vi.fn(),
	detectCircularDependencies: vi.fn(),
	generateSequences: vi.fn(),
	validateDependenciesMet: vi.fn(),
})

const createMockExecutor = () => ({
	applyEdit: vi.fn(),
	generateDiff: vi.fn(),
	bulkApplyEdits: vi.fn(),
	undoLastEdit: vi.fn(),
	redoLastEdit: vi.fn(),
	getGitDiff: vi.fn(),
	previewAllChanges: vi.fn(),
	canUndo: vi.fn(),
	canRedo: vi.fn(),
})

describe("NextEditSession", () => {
	let session: NextEditSession
	let mockContext: any
	let mockStorage: any
	let mockAnalyzer: any
	let mockSequencer: any
	let mockExecutor: any

	beforeEach(() => {
		mockContext = createMockContext()
		mockStorage = createMockStorage()
		mockAnalyzer = createMockAnalyzer()
		mockSequencer = createMockSequencer()
		mockExecutor = createMockExecutor()

		session = new NextEditSession(mockContext, mockStorage, mockAnalyzer, mockSequencer, mockExecutor)
	})

	describe("start", () => {
		it("should start a new session", async () => {
			const analysisResult = {
				edits: [],
				totalFiles: 10,
				estimatedTime: 60,
			}

			mockAnalyzer.analyzeCodebase.mockResolvedValue(analysisResult)
			mockSequencer.sequenceEdits.mockResolvedValue({
				orderedEditIds: [],
				sequenceCount: 0,
				circularDependencies: [],
			})
			mockStorage.saveSession.mockResolvedValue()
			mockStorage.setActiveSessionId.mockResolvedValue()
			mockStorage.setLastSessionId.mockResolvedValue()

			const result = await session.start("file:///test/workspace", "Refactor code to use modern patterns")

			expect(result).toHaveProperty("id")
			expect(result).toHaveProperty("workspaceUri", "file:///test/workspace")
			expect(result).toHaveProperty("status")
			expect(result).toHaveProperty("goal", "Refactor code to use modern patterns")
			expect(result).toHaveProperty("edits")
			expect(result).toHaveProperty("totalFiles", 10)
			expect(result).toHaveProperty("estimatedTime", 60)
			expect(mockAnalyzer.analyzeCodebase).toHaveBeenCalled()
			expect(mockStorage.saveSession).toHaveBeenCalled()
		})

		it("should throw error for empty workspace URI", async () => {
			await expect(session.start("", "Test goal")).rejects.toThrow("Workspace URI is required")
		})

		it("should throw error for empty goal", async () => {
			await expect(session.start("file:///test/workspace", "")).rejects.toThrow("Goal is required")
		})
	})

	describe("getNextEdit", () => {
		it("should get next edit in sequence", async () => {
			const mockSession: EditSession = {
				id: "session-1",
				workspaceUri: "file:///test/workspace",
				createdAt: new Date(),
				updatedAt: new Date(),
				status: "active" as SessionStatus,
				goal: "Test goal",
				edits: [
					{
						id: "edit-1",
						sessionId: "session-1",
						filePath: "file:///test/workspace/src/test.ts",
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
						category: "refactor" as any,
						priority: 1,
					},
				],
				currentEditIndex: 0,
				completedEdits: [],
				skippedEdits: [],
				undoStack: [],
				redoStack: [],
				totalFiles: 10,
				estimatedTime: 60,
			}

			mockStorage.loadSession.mockResolvedValue(mockSession)
			mockAnalyzer.generateContext.mockResolvedValue({
				id: "context-1",
				editId: "edit-1",
				surroundingLines: [],
				imports: [],
				exports: [],
				analysisMethod: "semantic" as any,
				semanticScore: 0.9,
				fileHash: "abc123",
			})

			const result = await session.getNextEdit("session-1")

			expect(result).toHaveProperty("edit")
			expect(result).toHaveProperty("context")
			expect(result.edit.id).toBe("edit-1")
		})

		it("should throw error for invalid session ID", async () => {
			await expect(session.getNextEdit("")).rejects.toThrow(createInvalidSessionIdError(""))
		})
	})

	describe("applyEdit", () => {
		it("should apply an edit", async () => {
			const mockSession: EditSession = {
				id: "session-1",
				workspaceUri: "file:///test/workspace",
				createdAt: new Date(),
				updatedAt: new Date(),
				status: "active" as SessionStatus,
				goal: "Test goal",
				edits: [
					{
						id: "edit-1",
						sessionId: "session-1",
						filePath: "file:///test/workspace/src/test.ts",
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
						category: "refactor" as any,
						priority: 1,
					},
				],
				currentEditIndex: 0,
				completedEdits: [],
				skippedEdits: [],
				undoStack: [],
				redoStack: [],
				totalFiles: 10,
				estimatedTime: 60,
			}

			mockStorage.loadSession.mockResolvedValue(mockSession)
			mockExecutor.applyEdit.mockResolvedValue({
				action: {
					id: "action-1",
					sessionId: "session-1",
					editId: "edit-1",
					action: "accept" as any,
					timestamp: new Date(),
					originalContent: "var x = 1;",
					appliedContent: "const x = 1;",
					duration: 1000,
				},
				success: true,
			})
			mockStorage.saveSession.mockResolvedValue()

			const result = await session.applyEdit("session-1", "edit-1")

			expect(result).toHaveProperty("id")
			expect(result).toHaveProperty("editId", "edit-1")
			expect(result).toHaveProperty("action", "accept")
			expect(mockExecutor.applyEdit).toHaveBeenCalled()
		})

		it("should throw error for invalid session ID", async () => {
			await expect(session.applyEdit("", "edit-1")).rejects.toThrow(createInvalidSessionIdError(""))
		})

		it("should throw error for empty edit ID", async () => {
			await expect(session.applyEdit("session-1", "")).rejects.toThrow("Edit ID is required")
		})
	})

	describe("skipEdit", () => {
		it("should skip an edit", async () => {
			const mockSession: EditSession = {
				id: "session-1",
				workspaceUri: "file:///test/workspace",
				createdAt: new Date(),
				updatedAt: new Date(),
				status: "active" as SessionStatus,
				goal: "Test goal",
				edits: [
					{
						id: "edit-1",
						sessionId: "session-1",
						filePath: "file:///test/workspace/src/test.ts",
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
						category: "refactor" as any,
						priority: 1,
					},
				],
				currentEditIndex: 0,
				completedEdits: [],
				skippedEdits: [],
				undoStack: [],
				redoStack: [],
				totalFiles: 10,
				estimatedTime: 60,
			}

			mockStorage.loadSession.mockResolvedValue(mockSession)
			mockStorage.saveSession.mockResolvedValue()

			const result = await session.skipEdit("session-1", "edit-1", "Not needed")

			expect(result).toHaveProperty("id")
			expect(result).toHaveProperty("editId", "edit-1")
			expect(result).toHaveProperty("action", "skip")
			expect(result.userNotes).toBe("Not needed")
		})

		it("should throw error for invalid session ID", async () => {
			await expect(session.skipEdit("", "edit-1")).rejects.toThrow(createInvalidSessionIdError(""))
		})

		it("should throw error for empty edit ID", async () => {
			await expect(session.skipEdit("session-1", "")).rejects.toThrow("Edit ID is required")
		})
	})

	describe("getProgress", () => {
		it("should get session progress", async () => {
			const mockSession: EditSession = {
				id: "session-1",
				workspaceUri: "file:///test/workspace",
				createdAt: new Date(),
				updatedAt: new Date(),
				status: "active" as SessionStatus,
				goal: "Test goal",
				edits: [
					{
						id: "edit-1",
						sessionId: "session-1",
						filePath: "file:///test/workspace/src/test.ts",
						lineStart: 1,
						lineEnd: 1,
						originalContent: "var x = 1;",
						suggestedContent: "const x = 1;",
						rationale: "Use const",
						confidence: 0.9,
						dependencies: [],
						dependents: [],
						status: "accepted" as any,
						language: "typescript",
						category: "refactor" as any,
						priority: 1,
					},
					{
						id: "edit-2",
						sessionId: "session-1",
						filePath: "file:///test/workspace/src/test2.ts",
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
						category: "refactor" as any,
						priority: 1,
					},
				],
				currentEditIndex: 1,
				completedEdits: ["edit-1"],
				skippedEdits: [],
				undoStack: [],
				redoStack: [],
				totalFiles: 10,
				estimatedTime: 60,
			}

			mockStorage.loadSession.mockResolvedValue(mockSession)

			const result = await session.getProgress("session-1")

			expect(result).toHaveProperty("current", 1)
			expect(result).toHaveProperty("total", 2)
			expect(result).toHaveProperty("completed", 1)
			expect(result).toHaveProperty("skipped", 0)
			expect(result).toHaveProperty("remaining", 1)
			expect(result).toHaveProperty("percentage", 50)
		})

		it("should throw error for invalid session ID", async () => {
			await expect(session.getProgress("")).rejects.toThrow(createInvalidSessionIdError(""))
		})
	})

	describe("complete", () => {
		it("should complete a session", async () => {
			const mockSession: EditSession = {
				id: "session-1",
				workspaceUri: "file:///test/workspace",
				createdAt: new Date(),
				updatedAt: new Date(),
				status: "active" as SessionStatus,
				goal: "Test goal",
				edits: [
					{
						id: "edit-1",
						sessionId: "session-1",
						filePath: "file:///test/workspace/src/test.ts",
						lineStart: 1,
						lineEnd: 1,
						originalContent: "var x = 1;",
						suggestedContent: "const x = 1;",
						rationale: "Use const",
						confidence: 0.9,
						dependencies: [],
						dependents: [],
						status: "accepted" as any,
						language: "typescript",
						category: "refactor" as any,
						priority: 1,
					},
				],
				currentEditIndex: 1,
				completedEdits: ["edit-1"],
				skippedEdits: [],
				undoStack: [],
				redoStack: [],
				totalFiles: 10,
				estimatedTime: 60,
			}

			mockStorage.loadSession.mockResolvedValue(mockSession)
			mockStorage.saveSession.mockResolvedValue()
			mockStorage.clearActiveSessionId.mockResolvedValue()

			const result = await session.complete("session-1")

			expect(result).toHaveProperty("sessionId", "session-1")
			expect(result).toHaveProperty("goal", "Test goal")
			expect(result).toHaveProperty("status", "completed")
			expect(result).toHaveProperty("totalEdits", 1)
			expect(result).toHaveProperty("completedEdits", 1)
			expect(result).toHaveProperty("skippedEdits", 0)
			expect(result).toHaveProperty("modifiedEdits", 0)
			expect(result).toHaveProperty("pendingEdits", 0)
		})

		it("should throw error for invalid session ID", async () => {
			await expect(session.complete("")).rejects.toThrow(createInvalidSessionIdError(""))
		})
	})

	describe("pause", () => {
		it("should pause a session", async () => {
			const mockSession: EditSession = {
				id: "session-1",
				workspaceUri: "file:///test/workspace",
				createdAt: new Date(),
				updatedAt: new Date(),
				status: "active" as SessionStatus,
				goal: "Test goal",
				edits: [],
				currentEditIndex: 0,
				completedEdits: [],
				skippedEdits: [],
				undoStack: [],
				redoStack: [],
				totalFiles: 10,
				estimatedTime: 60,
			}

			mockStorage.loadSession.mockResolvedValue(mockSession)
			mockStorage.saveSession.mockResolvedValue()

			await session.pause("session-1")

			expect(mockStorage.saveSession).toHaveBeenCalled()
		})

		it("should throw error for invalid session ID", async () => {
			await expect(session.pause("")).rejects.toThrow(createInvalidSessionIdError(""))
		})
	})

	describe("resume", () => {
		it("should resume a paused session", async () => {
			const mockSession: EditSession = {
				id: "session-1",
				workspaceUri: "file:///test/workspace",
				createdAt: new Date(),
				updatedAt: new Date(),
				status: "paused" as SessionStatus,
				goal: "Test goal",
				edits: [],
				currentEditIndex: 0,
				completedEdits: [],
				skippedEdits: [],
				undoStack: [],
				redoStack: [],
				totalFiles: 10,
				estimatedTime: 60,
			}

			mockStorage.loadSession.mockResolvedValue(mockSession)
			mockStorage.saveSession.mockResolvedValue()

			await session.resume("session-1")

			expect(mockStorage.saveSession).toHaveBeenCalled()
		})

		it("should throw error for invalid session ID", async () => {
			await expect(session.resume("")).rejects.toThrow(createInvalidSessionIdError(""))
		})
	})

	describe("cancel", () => {
		it("should cancel a session", async () => {
			const mockSession: EditSession = {
				id: "session-1",
				workspaceUri: "file:///test/workspace",
				createdAt: new Date(),
				updatedAt: new Date(),
				status: "active" as SessionStatus,
				goal: "Test goal",
				edits: [],
				currentEditIndex: 0,
				completedEdits: [],
				skippedEdits: [],
				undoStack: [],
				redoStack: [],
				totalFiles: 10,
				estimatedTime: 60,
			}

			mockStorage.loadSession.mockResolvedValue(mockSession)
			mockStorage.saveSession.mockResolvedValue()
			mockStorage.clearActiveSessionId.mockResolvedValue()

			await session.cancel("session-1", "User cancelled")

			expect(mockStorage.saveSession).toHaveBeenCalled()
		})

		it("should throw error for invalid session ID", async () => {
			await expect(session.cancel("")).rejects.toThrow(createInvalidSessionIdError(""))
		})
	})

	describe("getSummary", () => {
		it("should get session summary with completed and pending edits", async () => {
			const mockSession: EditSession = {
				id: "session-1",
				workspaceUri: "file:///test/workspace",
				createdAt: new Date(),
				updatedAt: new Date(),
				status: "active" as SessionStatus,
				goal: "Refactor code to use modern patterns",
				edits: [
					{
						id: "edit-1",
						sessionId: "session-1",
						filePath: "file:///test/workspace/src/test.ts",
						lineStart: 1,
						lineEnd: 1,
						originalContent: "var x = 1;",
						suggestedContent: "const x = 1;",
						rationale: "Use const",
						confidence: 0.9,
						dependencies: [],
						dependents: [],
						status: "accepted" as any,
						language: "typescript",
						category: "refactor" as any,
						priority: 1,
					},
					{
						id: "edit-2",
						sessionId: "session-1",
						filePath: "file:///test/workspace/src/test2.ts",
						lineStart: 1,
						lineEnd: 1,
						originalContent: "var y = 2;",
						suggestedContent: "let y = 2;",
						rationale: "Use let",
						confidence: 0.8,
						dependencies: [],
						dependents: [],
						status: "accepted" as any,
						language: "typescript",
						category: "refactor" as any,
						priority: 1,
						userModification: "let y = 2;",
					},
					{
						id: "edit-3",
						sessionId: "session-1",
						filePath: "file:///test/workspace/src/test3.ts",
						lineStart: 1,
						lineEnd: 1,
						originalContent: "var z = 3;",
						suggestedContent: "const z = 3;",
						rationale: "Use const",
						confidence: 0.9,
						dependencies: [],
						dependents: [],
						status: "pending" as any,
						language: "typescript",
						category: "refactor" as any,
						priority: 1,
					},
				],
				currentEditIndex: 2,
				completedEdits: ["edit-1", "edit-2"],
				skippedEdits: [],
				undoStack: [],
				redoStack: [],
				totalFiles: 10,
				estimatedTime: 60,
			}

			mockStorage.loadSession.mockResolvedValue(mockSession)

			const result = await session.getSummary("session-1")

			expect(result).toHaveProperty("sessionId", "session-1")
			expect(result).toHaveProperty("goal", "Refactor code to use modern patterns")
			expect(result).toHaveProperty("status", "active")
			expect(result).toHaveProperty("totalEdits", 3)
			expect(result).toHaveProperty("completedEdits", 2)
			expect(result).toHaveProperty("skippedEdits", 0)
			expect(result).toHaveProperty("modifiedEdits", 1)
			expect(result).toHaveProperty("pendingEdits", 1)
			expect(result).toHaveProperty("errors", 0)
			expect(result).toHaveProperty("filesChanged")
			expect(Array.isArray(result.filesChanged)).toBe(true)
			expect(result.filesChanged).toContain("file:///test/workspace/src/test.ts")
			expect(result.filesChanged).toContain("file:///test/workspace/src/test2.ts")
			expect(result).toHaveProperty("estimatedTimeRemaining")
		})

		it("should get summary for completed session", async () => {
			const mockSession: EditSession = {
				id: "session-1",
				workspaceUri: "file:///test/workspace",
				createdAt: new Date(),
				updatedAt: new Date(),
				status: "completed" as SessionStatus,
				goal: "Test goal",
				edits: [
					{
						id: "edit-1",
						sessionId: "session-1",
						filePath: "file:///test/workspace/src/test.ts",
						lineStart: 1,
						lineEnd: 1,
						originalContent: "var x = 1;",
						suggestedContent: "const x = 1;",
						rationale: "Use const",
						confidence: 0.9,
						dependencies: [],
						dependents: [],
						status: "accepted" as any,
						language: "typescript",
						category: "refactor" as any,
						priority: 1,
					},
				],
				currentEditIndex: 1,
				completedEdits: ["edit-1"],
				skippedEdits: [],
				undoStack: [],
				redoStack: [],
				totalFiles: 10,
				estimatedTime: 60,
			}

			mockStorage.loadSession.mockResolvedValue(mockSession)

			const result = await session.getSummary("session-1")

			expect(result.status).toBe("completed")
			expect(result.totalEdits).toBe(1)
			expect(result.completedEdits).toBe(1)
			expect(result.estimatedTimeRemaining).toBe(0)
		})

		it("should throw error for invalid session ID", async () => {
			await expect(session.getSummary("")).rejects.toThrow(createInvalidSessionIdError(""))
		})
	})

	describe("undoLastEdit", () => {
		it("should throw error for invalid session ID", async () => {
			await expect(session.undoLastEdit("")).rejects.toThrow(createInvalidSessionIdError(""))
		})

		it("should undo last edit in session", async () => {
			const mockSession: EditSession = {
				id: "session-1",
				workspaceUri: "file:///test/workspace",
				createdAt: new Date(),
				updatedAt: new Date(),
				status: "active" as SessionStatus,
				goal: "Test goal",
				edits: [
					{
						id: "edit-1",
						sessionId: "session-1",
						filePath: "file:///test/workspace/src/test.ts",
						lineStart: 1,
						lineEnd: 1,
						originalContent: "var x = 1;",
						suggestedContent: "const x = 1;",
						rationale: "Use const",
						confidence: 0.9,
						dependencies: [],
						dependents: [],
						status: "accepted" as any,
						language: "typescript",
						category: "refactor" as any,
						priority: 1,
					},
				],
				currentEditIndex: 1,
				completedEdits: ["edit-1"],
				skippedEdits: [],
				undoStack: [],
				redoStack: [],
				totalFiles: 10,
				estimatedTime: 60,
			}

			mockStorage.loadSession.mockResolvedValue(mockSession)
			mockExecutor.undoLastEdit.mockResolvedValue({
				id: "action-1",
				sessionId: "session-1",
				editId: "edit-1",
				action: "accept" as any,
				timestamp: new Date(),
				originalContent: "var x = 1;",
				appliedContent: "const x = 1;",
				duration: 1000,
			})
			mockStorage.saveSession.mockResolvedValue()

			const result = await session.undoLastEdit("session-1")

			expect(result).not.toBeNull()
			expect(result).toHaveProperty("editId", "edit-1")
			expect(mockExecutor.undoLastEdit).toHaveBeenCalledWith("session-1")
			expect(mockStorage.saveSession).toHaveBeenCalled()
		})

		it("should return null when executor returns null", async () => {
			const mockSession: EditSession = {
				id: "session-1",
				workspaceUri: "file:///test/workspace",
				createdAt: new Date(),
				updatedAt: new Date(),
				status: "active" as SessionStatus,
				goal: "Test goal",
				edits: [],
				currentEditIndex: 0,
				completedEdits: [],
				skippedEdits: [],
				undoStack: [],
				redoStack: [],
				totalFiles: 10,
				estimatedTime: 60,
			}

			mockStorage.loadSession.mockResolvedValue(mockSession)
			mockExecutor.undoLastEdit.mockResolvedValue(null)

			const result = await session.undoLastEdit("session-1")

			expect(result).toBeNull()
		})

		it("should update session state after undo", async () => {
			const mockSession: EditSession = {
				id: "session-1",
				workspaceUri: "file:///test/workspace",
				createdAt: new Date(),
				updatedAt: new Date(),
				status: "active" as SessionStatus,
				goal: "Test goal",
				edits: [
					{
						id: "edit-1",
						sessionId: "session-1",
						filePath: "file:///test/workspace/src/test.ts",
						lineStart: 1,
						lineEnd: 1,
						originalContent: "var x = 1;",
						suggestedContent: "const x = 1;",
						rationale: "Use const",
						confidence: 0.9,
						dependencies: [],
						dependents: [],
						status: "accepted" as any,
						language: "typescript",
						category: "refactor" as any,
						priority: 1,
					},
				],
				currentEditIndex: 1,
				completedEdits: ["edit-1"],
				skippedEdits: [],
				undoStack: [],
				redoStack: [],
				totalFiles: 10,
				estimatedTime: 60,
			}

			mockStorage.loadSession.mockResolvedValue(mockSession)
			mockExecutor.undoLastEdit.mockResolvedValue({
				id: "action-1",
				sessionId: "session-1",
				editId: "edit-1",
				action: "accept" as any,
				timestamp: new Date(),
				originalContent: "var x = 1;",
				appliedContent: "const x = 1;",
				duration: 1000,
			})
			mockStorage.saveSession.mockResolvedValue()

			await session.undoLastEdit("session-1")

			const savedSession = mockStorage.saveSession.mock.calls[0][0]
			expect(savedSession.completedEdits).not.toContain("edit-1")
			expect(savedSession.currentEditIndex).toBe(0)
			expect(savedSession.redoStack.length).toBeGreaterThan(0)
		})
	})

	describe("redoLastEdit", () => {
		it("should throw error for invalid session ID", async () => {
			await expect(session.redoLastEdit("")).rejects.toThrow(createInvalidSessionIdError(""))
		})

		it("should redo last undone edit in session", async () => {
			const mockSession: EditSession = {
				id: "session-1",
				workspaceUri: "file:///test/workspace",
				createdAt: new Date(),
				updatedAt: new Date(),
				status: "active" as SessionStatus,
				goal: "Test goal",
				edits: [
					{
						id: "edit-1",
						sessionId: "session-1",
						filePath: "file:///test/workspace/src/test.ts",
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
						category: "refactor" as any,
						priority: 1,
					},
				],
				currentEditIndex: 0,
				completedEdits: [],
				skippedEdits: [],
				undoStack: [],
				redoStack: [],
				totalFiles: 10,
				estimatedTime: 60,
			}

			mockStorage.loadSession.mockResolvedValue(mockSession)
			mockExecutor.redoLastEdit.mockResolvedValue({
				id: "action-1",
				sessionId: "session-1",
				editId: "edit-1",
				action: "accept" as any,
				timestamp: new Date(),
				originalContent: "var x = 1;",
				appliedContent: "const x = 1;",
				duration: 1000,
			})
			mockStorage.saveSession.mockResolvedValue()

			const result = await session.redoLastEdit("session-1")

			expect(result).not.toBeNull()
			expect(result).toHaveProperty("editId", "edit-1")
			expect(mockExecutor.redoLastEdit).toHaveBeenCalledWith("session-1")
			expect(mockStorage.saveSession).toHaveBeenCalled()
		})

		it("should return null when executor returns null", async () => {
			const mockSession: EditSession = {
				id: "session-1",
				workspaceUri: "file:///test/workspace",
				createdAt: new Date(),
				updatedAt: new Date(),
				status: "active" as SessionStatus,
				goal: "Test goal",
				edits: [],
				currentEditIndex: 0,
				completedEdits: [],
				skippedEdits: [],
				undoStack: [],
				redoStack: [],
				totalFiles: 10,
				estimatedTime: 60,
			}

			mockStorage.loadSession.mockResolvedValue(mockSession)
			mockExecutor.redoLastEdit.mockResolvedValue(null)

			const result = await session.redoLastEdit("session-1")

			expect(result).toBeNull()
		})

		it("should update session state after redo", async () => {
			const mockSession: EditSession = {
				id: "session-1",
				workspaceUri: "file:///test/workspace",
				createdAt: new Date(),
				updatedAt: new Date(),
				status: "active" as SessionStatus,
				goal: "Test goal",
				edits: [
					{
						id: "edit-1",
						sessionId: "session-1",
						filePath: "file:///test/workspace/src/test.ts",
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
						category: "refactor" as any,
						priority: 1,
					},
				],
				currentEditIndex: 0,
				completedEdits: [],
				skippedEdits: [],
				undoStack: [],
				redoStack: [],
				totalFiles: 10,
				estimatedTime: 60,
			}

			mockStorage.loadSession.mockResolvedValue(mockSession)
			mockExecutor.redoLastEdit.mockResolvedValue({
				id: "action-1",
				sessionId: "session-1",
				editId: "edit-1",
				action: "accept" as any,
				timestamp: new Date(),
				originalContent: "var x = 1;",
				appliedContent: "const x = 1;",
				duration: 1000,
			})
			mockStorage.saveSession.mockResolvedValue()

			await session.redoLastEdit("session-1")

			const savedSession = mockStorage.saveSession.mock.calls[0][0]
			expect(savedSession.completedEdits).toContain("edit-1")
			expect(savedSession.currentEditIndex).toBe(1)
			expect(savedSession.undoStack.length).toBeGreaterThan(0)
		})
	})
})
