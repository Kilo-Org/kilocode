import { SessionPersistenceManager } from "../SessionPersistenceManager"
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

	beforeEach(() => {
		vi.clearAllMocks()

		mockPathProvider = {
			getTasksDir: vi.fn().mockReturnValue("/home/user/.kilocode/tasks"),
			getSessionFilePath: vi
				.fn()
				.mockImplementation((workspaceDir: string) => `${workspaceDir}/.kilocode/session.json`),
		}

		manager = new SessionPersistenceManager(mockPathProvider)
	})

	describe("setWorkspaceDir", () => {
		it("should set the workspace directory", () => {
			manager.setWorkspaceDir("/workspace")

			expect(mockPathProvider.getSessionFilePath).not.toHaveBeenCalled()
		})
	})

	describe("getLastSession", () => {
		it("should return undefined when workspace directory is not set", () => {
			const result = manager.getLastSession()

			expect(result).toBeUndefined()
		})

		it("should return undefined when session file does not exist", () => {
			manager.setWorkspaceDir("/workspace")
			vi.mocked(existsSync).mockReturnValue(false)

			const result = manager.getLastSession()

			expect(result).toBeUndefined()
		})

		it("should return last session when it exists", () => {
			manager.setWorkspaceDir("/workspace")
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
			manager.setWorkspaceDir("/workspace")
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
			manager.setWorkspaceDir("/workspace")
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
			manager.setWorkspaceDir("/workspace")
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
			manager.setWorkspaceDir("/workspace")
			vi.mocked(existsSync).mockReturnValue(false)

			const result = manager.getTaskSessionMap()

			expect(result).toEqual({})
		})

		it("should return task session map when it exists", () => {
			manager.setWorkspaceDir("/workspace")
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
			manager.setWorkspaceDir("/workspace")
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
			manager.setWorkspaceDir("/workspace")
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
		it("should return undefined when task is not mapped", () => {
			manager.setWorkspaceDir("/workspace")
			vi.mocked(existsSync).mockReturnValue(true)
			vi.mocked(readFileSync).mockReturnValue(
				JSON.stringify({
					taskSessionMap: { "task-1": "session-1" },
				}),
			)

			const result = manager.getSessionForTask("task-unknown")

			expect(result).toBeUndefined()
		})

		it("should return session ID for mapped task", () => {
			manager.setWorkspaceDir("/workspace")
			vi.mocked(existsSync).mockReturnValue(true)
			vi.mocked(readFileSync).mockReturnValue(
				JSON.stringify({
					taskSessionMap: { "task-1": "session-1" },
				}),
			)

			const result = manager.getSessionForTask("task-1")

			expect(result).toBe("session-1")
		})
	})

	describe("setSessionForTask", () => {
		it("should add task-session mapping to existing map", () => {
			manager.setWorkspaceDir("/workspace")
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
			manager.setWorkspaceDir("/workspace")
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
			manager.setWorkspaceDir("/workspace")
			vi.mocked(existsSync).mockReturnValue(false)

			manager.setSessionForTask("task-1", "session-1")

			const writtenData = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string)
			expect(writtenData.taskSessionMap).toEqual({ "task-1": "session-1" })
		})
	})

	describe("edge cases", () => {
		it("should handle malformed JSON gracefully by allowing the error to propagate", () => {
			manager.setWorkspaceDir("/workspace")
			vi.mocked(existsSync).mockReturnValue(true)
			vi.mocked(readFileSync).mockReturnValue("invalid json")

			expect(() => manager.getLastSession()).toThrow()
		})

		it("should handle empty taskSessionMap in JSON", () => {
			manager.setWorkspaceDir("/workspace")
			vi.mocked(existsSync).mockReturnValue(true)
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify({}))

			const result = manager.getTaskSessionMap()

			expect(result).toEqual({})
		})
	})
})
