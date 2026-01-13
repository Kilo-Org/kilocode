import { SessionPersistenceManager } from "../SessionPersistenceManager"
import { SessionStateManager } from "../../core/SessionStateManager"
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs"
import type { IPathProvider } from "../../types/IPathProvider"

vi.mock("fs", () => ({
	readFileSync: vi.fn(),
	writeFileSync: vi.fn(),
	mkdirSync: vi.fn(),
	existsSync: vi.fn(),
}))

vi.mock("path", async () => {
	const actual = await vi.importActual("path")
	return {
		...actual,
		default: {
			...actual,
			dirname: vi.fn((p: string) => p.split("/").slice(0, -1).join("/")),
		},
	}
})

describe("SessionPersistenceManager", () => {
	let manager: SessionPersistenceManager
	let mockPathProvider: IPathProvider
	let stateManager: SessionStateManager

	beforeEach(() => {
		vi.clearAllMocks()

		mockPathProvider = {
			getTasksDir: vi.fn().mockReturnValue("/home/user/.kilocode/tasks"),
			getSessionFilePath: vi
				.fn()
				.mockImplementation((workspaceDir: string) => `${workspaceDir}/.kilocode/session.json`),
		}

		stateManager = new SessionStateManager()
		manager = new SessionPersistenceManager(mockPathProvider, stateManager)
	})

	describe("getLastSession", () => {
		it("should return undefined when workspace directory is not set", () => {
			const result = manager.getLastSession()

			expect(result).toBeUndefined()
		})

		it("should return undefined when session file does not exist", () => {
			stateManager.setWorkspaceDir("/workspace")
			vi.mocked(existsSync).mockReturnValue(false)

			const result = manager.getLastSession()

			expect(result).toBeUndefined()
		})

		it("should return last session when it exists", () => {
			stateManager.setWorkspaceDir("/workspace")
			vi.mocked(existsSync).mockReturnValue(true)
			vi.mocked(readFileSync).mockReturnValue(
				JSON.stringify({
					lastSession: { sessionId: "session-123", timestamp: 1234567890 },
					taskSessionMap: {},
				}),
			)

			const result = manager.getLastSession()

			expect(result).toEqual({ sessionId: "session-123", timestamp: 1234567890 })
		})

		it("should return undefined when lastSession is not set in state", () => {
			stateManager.setWorkspaceDir("/workspace")
			vi.mocked(existsSync).mockReturnValue(true)
			vi.mocked(readFileSync).mockReturnValue(
				JSON.stringify({
					taskSessionMap: {},
				}),
			)

			const result = manager.getLastSession()

			expect(result).toBeUndefined()
		})
	})

	describe("setLastSession", () => {
		it("should not write when workspace directory is not set", () => {
			manager.setLastSession("session-123")

			expect(writeFileSync).not.toHaveBeenCalled()
		})

		it("should write last session to file", () => {
			stateManager.setWorkspaceDir("/workspace")
			vi.mocked(existsSync).mockReturnValue(true)
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ taskSessionMap: {} }))

			manager.setLastSession("session-456")

			expect(mkdirSync).toHaveBeenCalledWith("/workspace/.kilocode", { recursive: true })
			expect(writeFileSync).toHaveBeenCalledWith(
				"/workspace/.kilocode/session.json",
				expect.stringContaining('"sessionId": "session-456"'),
			)
		})

		it("should preserve existing taskSessionMap when setting last session", () => {
			stateManager.setWorkspaceDir("/workspace")
			vi.mocked(existsSync).mockReturnValue(true)
			vi.mocked(readFileSync).mockReturnValue(
				JSON.stringify({
					taskSessionMap: { "task-1": "session-1" },
				}),
			)

			manager.setLastSession("session-456")

			const writtenData = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string)
			expect(writtenData.taskSessionMap).toEqual({ "task-1": "session-1" })
			expect(writtenData.lastSession).toEqual({ sessionId: "session-456", timestamp: expect.any(Number) })
		})
	})

	describe("getTaskSessionMap", () => {
		it("should return empty object when workspace directory is not set", () => {
			const result = manager.getTaskSessionMap()

			expect(result).toEqual({})
		})

		it("should return empty object when session file does not exist", () => {
			stateManager.setWorkspaceDir("/workspace")
			vi.mocked(existsSync).mockReturnValue(false)

			const result = manager.getTaskSessionMap()

			expect(result).toEqual({})
		})

		it("should return task session map when it exists", () => {
			stateManager.setWorkspaceDir("/workspace")
			vi.mocked(existsSync).mockReturnValue(true)
			vi.mocked(readFileSync).mockReturnValue(
				JSON.stringify({
					taskSessionMap: {
						"task-1": "session-1",
						"task-2": "session-2",
					},
				}),
			)

			const result = manager.getTaskSessionMap()

			expect(result).toEqual({
				"task-1": "session-1",
				"task-2": "session-2",
			})
		})
	})

	describe("setTaskSessionMap", () => {
		it("should not write when workspace directory is not set", () => {
			manager.setTaskSessionMap({ "task-1": "session-1" })

			expect(writeFileSync).not.toHaveBeenCalled()
		})

		it("should write task session map to file", () => {
			stateManager.setWorkspaceDir("/workspace")
			vi.mocked(existsSync).mockReturnValue(true)
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ taskSessionMap: {} }))

			manager.setTaskSessionMap({ "task-1": "session-1", "task-2": "session-2" })

			const writtenData = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string)
			expect(writtenData.taskSessionMap).toEqual({
				"task-1": "session-1",
				"task-2": "session-2",
			})
		})

		it("should preserve existing lastSession when setting task session map", () => {
			stateManager.setWorkspaceDir("/workspace")
			vi.mocked(existsSync).mockReturnValue(true)
			vi.mocked(readFileSync).mockReturnValue(
				JSON.stringify({
					lastSession: { sessionId: "session-old", timestamp: 111 },
					taskSessionMap: {},
				}),
			)

			manager.setTaskSessionMap({ "task-1": "session-1" })

			const writtenData = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string)
			expect(writtenData.lastSession).toEqual({ sessionId: "session-old", timestamp: 111 })
		})
	})

	describe("getSessionForTask", () => {
		it("should return undefined when task is not mapped in either state manager or persistence", () => {
			stateManager.setWorkspaceDir("/workspace")
			vi.mocked(existsSync).mockReturnValue(true)
			vi.mocked(readFileSync).mockReturnValue(
				JSON.stringify({
					taskSessionMap: { "task-1": "session-1" },
				}),
			)

			const result = manager.getSessionForTask("task-unknown")

			expect(result).toBeUndefined()
		})

		it("should return session ID from persisted taskSessionMap when not in state manager", () => {
			stateManager.setWorkspaceDir("/workspace")
			vi.mocked(existsSync).mockReturnValue(true)
			vi.mocked(readFileSync).mockReturnValue(
				JSON.stringify({
					taskSessionMap: { "task-1": "session-1" },
				}),
			)

			const result = manager.getSessionForTask("task-1")

			expect(result).toBe("session-1")
		})

		it("should return session ID from state manager when available", () => {
			stateManager.setWorkspaceDir("/workspace")
			stateManager.setSessionForTask("task-1", "session-from-state-manager")
			vi.mocked(existsSync).mockReturnValue(true)
			vi.mocked(readFileSync).mockReturnValue(
				JSON.stringify({
					taskSessionMap: { "task-1": "session-from-persistence" },
				}),
			)

			const result = manager.getSessionForTask("task-1")

			expect(result).toBe("session-from-state-manager")
		})

		it("should prioritize state manager over persisted taskSessionMap", () => {
			stateManager.setWorkspaceDir("/workspace")
			stateManager.setSessionForTask("task-1", "state-manager-session")
			vi.mocked(existsSync).mockReturnValue(true)
			vi.mocked(readFileSync).mockReturnValue(
				JSON.stringify({
					taskSessionMap: { "task-1": "persisted-session" },
				}),
			)

			const result = manager.getSessionForTask("task-1")

			expect(result).toBe("state-manager-session")
		})

		it("should fall back to persisted taskSessionMap when state manager returns undefined", () => {
			stateManager.setWorkspaceDir("/workspace")
			// Don't set anything in state manager
			vi.mocked(existsSync).mockReturnValue(true)
			vi.mocked(readFileSync).mockReturnValue(
				JSON.stringify({
					taskSessionMap: { "task-1": "persisted-session" },
				}),
			)

			const result = manager.getSessionForTask("task-1")

			expect(result).toBe("persisted-session")
		})
	})

	describe("setSessionForTask", () => {
		it("should add task-session mapping to existing map", () => {
			stateManager.setWorkspaceDir("/workspace")
			vi.mocked(existsSync).mockReturnValue(true)
			vi.mocked(readFileSync).mockReturnValue(
				JSON.stringify({
					taskSessionMap: { "task-1": "session-1" },
				}),
			)

			manager.setSessionForTask("task-2", "session-2")

			const writtenData = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string)
			expect(writtenData.taskSessionMap).toEqual({
				"task-1": "session-1",
				"task-2": "session-2",
			})
		})

		it("should update existing task-session mapping", () => {
			stateManager.setWorkspaceDir("/workspace")
			vi.mocked(existsSync).mockReturnValue(true)
			vi.mocked(readFileSync).mockReturnValue(
				JSON.stringify({
					taskSessionMap: { "task-1": "session-old" },
				}),
			)

			manager.setSessionForTask("task-1", "session-new")

			const writtenData = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string)
			expect(writtenData.taskSessionMap["task-1"]).toBe("session-new")
		})

		it("should create taskSessionMap when it does not exist", () => {
			stateManager.setWorkspaceDir("/workspace")
			vi.mocked(existsSync).mockReturnValue(false)

			manager.setSessionForTask("task-1", "session-1")

			const writtenData = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string)
			expect(writtenData.taskSessionMap).toEqual({ "task-1": "session-1" })
		})

		it("should also update the state manager when setting session for task", () => {
			stateManager.setWorkspaceDir("/workspace")
			vi.mocked(existsSync).mockReturnValue(true)
			vi.mocked(readFileSync).mockReturnValue(
				JSON.stringify({
					taskSessionMap: {},
				}),
			)

			manager.setSessionForTask("task-1", "session-1")

			expect(stateManager.getSessionForTask("task-1")).toBe("session-1")
		})

		it("should update both state manager and persistence when setting session for task", () => {
			stateManager.setWorkspaceDir("/workspace")
			vi.mocked(existsSync).mockReturnValue(true)
			vi.mocked(readFileSync).mockReturnValue(
				JSON.stringify({
					taskSessionMap: {},
				}),
			)

			manager.setSessionForTask("task-1", "session-1")

			// Verify state manager was updated
			expect(stateManager.getSessionForTask("task-1")).toBe("session-1")

			// Verify persistence was updated
			const writtenData = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string)
			expect(writtenData.taskSessionMap["task-1"]).toBe("session-1")
		})
	})

	describe("edge cases", () => {
		it("should handle malformed JSON gracefully by allowing the error to propagate", () => {
			stateManager.setWorkspaceDir("/workspace")
			vi.mocked(existsSync).mockReturnValue(true)
			vi.mocked(readFileSync).mockReturnValue("invalid json")

			expect(() => manager.getLastSession()).toThrow()
		})

		it("should handle empty taskSessionMap in JSON", () => {
			stateManager.setWorkspaceDir("/workspace")
			vi.mocked(existsSync).mockReturnValue(true)
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify({}))

			const result = manager.getTaskSessionMap()

			expect(result).toEqual({})
		})
	})

	describe("taskSessionMap duplicate values", () => {
		it("should deduplicate session IDs keeping only the last entry for each duplicate value", () => {
			stateManager.setWorkspaceDir("/workspace")
			vi.mocked(existsSync).mockReturnValue(true)
			vi.mocked(readFileSync).mockReturnValue(
				JSON.stringify({
					taskSessionMap: {
						"task-1": "session-1",
						"task-2": "session-2",
						"task-3": "session-1",
					},
				}),
			)

			const taskSessionMap = manager.getTaskSessionMap()
			const sessionIds = Object.values(taskSessionMap)
			const uniqueSessionIds = new Set(sessionIds)

			expect(sessionIds.length).toBe(uniqueSessionIds.size)
			expect(taskSessionMap).toEqual({
				"task-2": "session-2",
				"task-3": "session-1",
			})
		})
	})
})
