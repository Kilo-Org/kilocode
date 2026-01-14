/**
 * Integration tests for Next Edit feature
 *
 * Tests for T018: Full session lifecycle integration
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { NextEditSession } from "@/services/next-edit/NextEditSession"
import { SessionStorage } from "@/services/next-edit/SessionStorage"
import { EditAnalyzer } from "@/services/next-edit/EditAnalyzer"
import { EditSequencer } from "@/services/next-edit/EditSequencer"
import { EditExecutor } from "@/services/next-edit/EditExecutor"
import type { EditSession, SessionStatus } from "@/services/next-edit/types"

// Mock VSCode ExtensionContext
const createMockContext = () => {
	const state = new Map<string, unknown>()
	return {
		workspaceState: {
			get: vi.fn((key: string) => state.get(key)),
			update: vi.fn((key: string, value: unknown) => {
				state.set(key, value)
				return Promise.resolve()
			}),
		},
	}
}

describe("Next Edit Integration Tests", () => {
	let mockContext: any
	let storage: SessionStorage
	let analyzer: EditAnalyzer
	let sequencer: EditSequencer
	let executor: EditExecutor
	let session: NextEditSession

	beforeEach(() => {
		mockContext = createMockContext()
		storage = new SessionStorage(mockContext)
		analyzer = new EditAnalyzer(mockContext)
		sequencer = new EditSequencer()
		executor = new EditExecutor(mockContext)
		session = new NextEditSession(mockContext, storage, analyzer, sequencer, executor)
	})

	describe("Full Session Lifecycle", () => {
		it("should complete a full session lifecycle", async () => {
			// Step 1: Start a session
			const startedSession = await session.start("file:///test/workspace", "Refactor code to use modern patterns")

			expect(startedSession.id).toBeDefined()
			expect(startedSession.status).toBe("active")
			expect(startedSession.edits).toBeDefined()

			// Step 2: Get next edit
			if (startedSession.edits.length > 0) {
				const { edit, context } = await session.getNextEdit(startedSession.id)

				expect(edit.id).toBeDefined()
				expect(context).toBeDefined()

				// Step 3: Apply edit
				const action = await session.applyEdit(startedSession.id, edit.id)

				expect(action.id).toBeDefined()
				expect(action.editId).toBe(edit.id)
				expect(action.action).toBe("accept")
			}

			// Step 4: Get progress
			const progress = await session.getProgress(startedSession.id)

			expect(progress).toHaveProperty("current")
			expect(progress).toHaveProperty("total")
			expect(progress).toHaveProperty("completed")
			expect(progress).toHaveProperty("skipped")
			expect(progress).toHaveProperty("remaining")

			// Step 5: Complete session
			const summary = await session.complete(startedSession.id)

			expect(summary.sessionId).toBe(startedSession.id)
			expect(summary.status).toBe("completed")
		})

		it("should handle pause and resume", async () => {
			// Start session
			const startedSession = await session.start("file:///test/workspace", "Test goal")

			// Pause session
			await session.pause(startedSession.id)

			const pausedSession = await storage.loadSession(startedSession.id)
			expect(pausedSession?.status).toBe("paused")

			// Resume session
			await session.resume(startedSession.id)

			const resumedSession = await storage.loadSession(startedSession.id)
			expect(resumedSession?.status).toBe("active")
		})

		it("should handle session cancellation", async () => {
			// Start session
			const startedSession = await session.start("file:///test/workspace", "Test goal")

			// Cancel session
			await session.cancel(startedSession.id, "User cancelled")

			const cancelledSession = await storage.loadSession(startedSession.id)
			expect(cancelledSession?.status).toBe("cancelled")
		})

		it("should skip edits correctly", async () => {
			// Start session
			const startedSession = await session.start("file:///test/workspace", "Test goal")

			// Get and skip edit
			if (startedSession.edits.length > 0) {
				const { edit } = await session.getNextEdit(startedSession.id)
				const action = await session.skipEdit(startedSession.id, edit.id, "Not needed")

				expect(action.action).toBe("skip")
				expect(action.userNotes).toBe("Not needed")

				const updatedSession = await storage.loadSession(startedSession.id)
				expect(updatedSession?.skippedEdits).toContain(edit.id)
			}
		})

		it("should persist session state", async () => {
			// Start session
			const startedSession = await session.start("file:///test/workspace", "Test goal")

			// Load session from storage
			const loadedSession = await storage.loadSession(startedSession.id)

			expect(loadedSession).toBeDefined()
			expect(loadedSession?.id).toBe(startedSession.id)
			expect(loadedSession?.goal).toBe(startedSession.goal)
			expect(loadedSession?.workspaceUri).toBe(startedSession.workspaceUri)
		})

		it("should track active session", async () => {
			// Start session
			const startedSession = await session.start("file:///test/workspace", "Test goal")

			// Get active session ID
			const activeId = await storage.getActiveSessionId()

			expect(activeId).toBe(startedSession.id)
		})

		it("should list all sessions", async () => {
			// Start multiple sessions
			const session1 = await session.start("file:///test/workspace1", "Goal 1")

			const session2 = await session.start("file:///test/workspace2", "Goal 2")

			// List sessions
			const sessions = await session.listSessions()

			expect(sessions.length).toBeGreaterThanOrEqual(2)
			expect(sessions.find((s) => s.id === session1.id)).toBeDefined()
			expect(sessions.find((s) => s.id === session2.id)).toBeDefined()
		})
	})

	describe("Error Handling", () => {
		it("should handle invalid session ID gracefully", async () => {
			await expect(session.getNextEdit("invalid-id")).rejects.toThrow()
			await expect(session.applyEdit("invalid-id", "edit-1")).rejects.toThrow()
			await expect(session.skipEdit("invalid-id", "edit-1")).rejects.toThrow()
			await expect(session.getProgress("invalid-id")).rejects.toThrow()
			await expect(session.pause("invalid-id")).rejects.toThrow()
			await expect(session.resume("invalid-id")).rejects.toThrow()
			await expect(session.cancel("invalid-id")).rejects.toThrow()
			await expect(session.complete("invalid-id")).rejects.toThrow()
		})

		it("should handle empty edits gracefully", async () => {
			const startedSession = await session.start("file:///test/workspace", "Test goal")

			if (startedSession.edits.length === 0) {
				const progress = await session.getProgress(startedSession.id)
				expect(progress.total).toBe(0)
			}
		})
	})

	describe("Progress Tracking", () => {
		it("should calculate correct progress percentage", async () => {
			const startedSession = await session.start("file:///test/workspace", "Test goal")

			const progress = await session.getProgress(startedSession.id)

			const expectedPercentage =
				progress.total > 0 ? Math.round(((progress.completed + progress.skipped) / progress.total) * 100) : 0

			expect(progress.percentage).toBe(expectedPercentage)
		})

		it("should update progress after applying edits", async () => {
			const startedSession = await session.start("file:///test/workspace", "Test goal")

			const progressBefore = await session.getProgress(startedSession.id)

			if (startedSession.edits.length > 0) {
				const { edit } = await session.getNextEdit(startedSession.id)
				await session.applyEdit(startedSession.id, edit.id)

				const progressAfter = await session.getProgress(startedSession.id)

				expect(progressAfter.completed).toBe(progressBefore.completed + 1)
			}
		})
	})
})
