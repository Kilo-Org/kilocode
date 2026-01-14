/**
 * Unit tests for SessionStorage service
 *
 * Tests for T013: SessionStorage save/load/delete operations
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { SessionStorage } from "@/services/next-edit/SessionStorage"
import type { EditSession, SessionStatus } from "@/services/next-edit/types"
import { createSessionNotFoundError, createInvalidSessionIdError } from "@/services/next-edit/errors"

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

describe("SessionStorage", () => {
	let storage: SessionStorage
	let mockContext: any

	beforeEach(() => {
		mockContext = createMockContext()
		storage = new SessionStorage(mockContext)
	})

	describe("saveSession", () => {
		it("should save a session to workspace storage", async () => {
			const session: EditSession = {
				id: "session-1",
				workspaceUri: "file:///test/workspace",
				createdAt: new Date("2024-01-01"),
				updatedAt: new Date("2024-01-01"),
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

			await storage.saveSession(session)

			expect(mockContext.workspaceState.update).toHaveBeenCalledWith(
				"nextEditWorkspaceState",
				expect.objectContaining({
					sessions: expect.objectContaining({
						"session-1": session,
					}),
				}),
			)
		})

		it("should update existing session", async () => {
			const existingSession: EditSession = {
				id: "session-1",
				workspaceUri: "file:///test/workspace",
				createdAt: new Date("2024-01-01"),
				updatedAt: new Date("2024-01-01"),
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

			// First save
			await storage.saveSession(existingSession)

			// Update session
			const updatedSession = {
				...existingSession,
				updatedAt: new Date("2024-01-02"),
				currentEditIndex: 1,
			}

			await storage.saveSession(updatedSession)

			expect(mockContext.workspaceState.update).toHaveBeenCalledTimes(2)
		})
	})

	describe("loadSession", () => {
		it("should load a session by ID", async () => {
			const session: EditSession = {
				id: "session-1",
				workspaceUri: "file:///test/workspace",
				createdAt: new Date("2024-01-01"),
				updatedAt: new Date("2024-01-01"),
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

			// Setup state
			mockContext.workspaceState.get.mockReturnValue({
				sessions: {
					"session-1": session,
				},
			})

			const loaded = await storage.loadSession("session-1")

			expect(loaded).toEqual(session)
		})

		it("should return null for non-existent session", async () => {
			mockContext.workspaceState.get.mockReturnValue({
				sessions: {},
			})

			const loaded = await storage.loadSession("non-existent")

			expect(loaded).toBeNull()
		})

		it("should throw error for invalid session ID", async () => {
			await expect(storage.loadSession("")).rejects.toThrow(createInvalidSessionIdError(""))
		})
	})

	describe("deleteSession", () => {
		it("should delete a session from storage", async () => {
			const session: EditSession = {
				id: "session-1",
				workspaceUri: "file:///test/workspace",
				createdAt: new Date("2024-01-01"),
				updatedAt: new Date("2024-01-01"),
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

			// Setup state
			mockContext.workspaceState.get.mockReturnValue({
				sessions: {
					"session-1": session,
				},
			})

			await storage.deleteSession("session-1")

			expect(mockContext.workspaceState.update).toHaveBeenCalledWith(
				"nextEditWorkspaceState",
				expect.objectContaining({
					sessions: expect.not.objectContaining({
						"session-1": expect.anything(),
					}),
				}),
			)
		})

		it("should throw error for invalid session ID", async () => {
			await expect(storage.deleteSession("")).rejects.toThrow(createInvalidSessionIdError(""))
		})
	})

	describe("getActiveSessionId", () => {
		it("should return active session ID", async () => {
			mockContext.workspaceState.get.mockReturnValue({
				sessions: {},
				activeSessionId: "session-1",
			})

			const activeId = await storage.getActiveSessionId()

			expect(activeId).toBe("session-1")
		})

		it("should return null when no active session", async () => {
			mockContext.workspaceState.get.mockReturnValue({
				sessions: {},
			})

			const activeId = await storage.getActiveSessionId()

			expect(activeId).toBeNull()
		})
	})

	describe("setActiveSessionId", () => {
		it("should set active session ID", async () => {
			mockContext.workspaceState.get.mockReturnValue({
				sessions: {},
			})

			await storage.setActiveSessionId("session-1")

			expect(mockContext.workspaceState.update).toHaveBeenCalledWith(
				"nextEditWorkspaceState",
				expect.objectContaining({
					activeSessionId: "session-1",
				}),
			)
		})
	})

	describe("clearActiveSessionId", () => {
		it("should clear active session ID", async () => {
			mockContext.workspaceState.get.mockReturnValue({
				sessions: {},
				activeSessionId: "session-1",
			})

			await storage.clearActiveSessionId()

			expect(mockContext.workspaceState.update).toHaveBeenCalledWith(
				"nextEditWorkspaceState",
				expect.objectContaining({
					activeSessionId: undefined,
				}),
			)
		})
	})

	describe("listSessions", () => {
		it("should return all session IDs", async () => {
			mockContext.workspaceState.get.mockReturnValue({
				sessions: {
					"session-1": {},
					"session-2": {},
					"session-3": {},
				},
			})

			const sessionIds = await storage.listSessions()

			expect(sessionIds).toEqual(["session-1", "session-2", "session-3"])
		})

		it("should return empty array when no sessions", async () => {
			mockContext.workspaceState.get.mockReturnValue({
				sessions: {},
			})

			const sessionIds = await storage.listSessions()

			expect(sessionIds).toEqual([])
		})
	})

	describe("getLastSessionId", () => {
		it("should return last session ID", async () => {
			mockContext.workspaceState.get.mockReturnValue({
				sessions: {},
				lastSessionId: "session-1",
			})

			const lastId = await storage.getLastSessionId()

			expect(lastId).toBe("session-1")
		})

		it("should return null when no last session", async () => {
			mockContext.workspaceState.get.mockReturnValue({
				sessions: {},
			})

			const lastId = await storage.getLastSessionId()

			expect(lastId).toBeNull()
		})
	})

	describe("setLastSessionId", () => {
		it("should set last session ID", async () => {
			mockContext.workspaceState.get.mockReturnValue({
				sessions: {},
			})

			await storage.setLastSessionId("session-1")

			expect(mockContext.workspaceState.update).toHaveBeenCalledWith(
				"nextEditWorkspaceState",
				expect.objectContaining({
					lastSessionId: "session-1",
				}),
			)
		})
	})
})
