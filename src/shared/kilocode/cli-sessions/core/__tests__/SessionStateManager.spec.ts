import { SessionStateManager } from "../SessionStateManager"

describe("SessionStateManager", () => {
	let manager: SessionStateManager

	beforeEach(() => {
		manager = new SessionStateManager()
	})

	describe("Active Session Management", () => {
		it("getActiveSessionId returns null initially", () => {
			const result = manager.getActiveSessionId()

			expect(result).toBeNull()
		})

		it("setActiveSessionId stores session ID", () => {
			manager.setActiveSessionId("session-123")

			expect(manager.getActiveSessionId()).toBe("session-123")
		})

		it("setActiveSessionId with null clears session", () => {
			manager.setActiveSessionId("session-123")
			manager.setActiveSessionId(null)

			expect(manager.getActiveSessionId()).toBeNull()
		})
	})

	describe("Session Verification Cache", () => {
		it("isSessionVerified returns false for unknown session", () => {
			const result = manager.isSessionVerified("unknown-session")

			expect(result).toBe(false)
		})

		it("markSessionVerified adds session to verified set", () => {
			manager.markSessionVerified("session-123")

			expect(manager.isSessionVerified("session-123")).toBe(true)
		})

		it("clearSessionVerified removes session from verified set", () => {
			manager.markSessionVerified("session-123")
			manager.clearSessionVerified("session-123")

			expect(manager.isSessionVerified("session-123")).toBe(false)
		})

		it("multiple sessions can be verified independently", () => {
			manager.markSessionVerified("session-1")
			manager.markSessionVerified("session-2")

			expect(manager.isSessionVerified("session-1")).toBe(true)
			expect(manager.isSessionVerified("session-2")).toBe(true)
			expect(manager.isSessionVerified("session-3")).toBe(false)
		})
	})

	describe("Git State Tracking", () => {
		it("getGitUrl returns undefined for unknown task", () => {
			const result = manager.getGitUrl("unknown-task")

			expect(result).toBeUndefined()
		})

		it("setGitUrl stores URL for task", () => {
			manager.setGitUrl("task-123", "https://github.com/user/repo.git")

			expect(manager.getGitUrl("task-123")).toBe("https://github.com/user/repo.git")
		})

		it("getGitHash returns undefined for unknown task", () => {
			const result = manager.getGitHash("unknown-task")

			expect(result).toBeUndefined()
		})

		it("setGitHash stores hash for task", () => {
			manager.setGitHash("task-123", "abc123")

			expect(manager.getGitHash("task-123")).toBe("abc123")
		})

		it("git state is tracked per task independently", () => {
			manager.setGitUrl("task-1", "url-1")
			manager.setGitUrl("task-2", "url-2")
			manager.setGitHash("task-1", "hash-1")
			manager.setGitHash("task-2", "hash-2")

			expect(manager.getGitUrl("task-1")).toBe("url-1")
			expect(manager.getGitUrl("task-2")).toBe("url-2")
			expect(manager.getGitHash("task-1")).toBe("hash-1")
			expect(manager.getGitHash("task-2")).toBe("hash-2")
		})
	})

	describe("Session Title Management", () => {
		it("hasTitle returns false for unknown session", () => {
			const result = manager.hasTitle("unknown-session")

			expect(result).toBe(false)
		})

		it("setTitle stores title for session", () => {
			manager.setTitle("session-123", "My Session Title")

			expect(manager.getTitle("session-123")).toBe("My Session Title")
		})

		it("getTitle returns stored title", () => {
			manager.setTitle("session-123", "My Session Title")

			const result = manager.getTitle("session-123")

			expect(result).toBe("My Session Title")
		})

		it("hasTitle returns true after setTitle", () => {
			manager.setTitle("session-123", "My Session Title")

			expect(manager.hasTitle("session-123")).toBe(true)
		})
	})

	describe("Timestamp Tracking - High Water Mark", () => {
		it("getUpdatedAt returns undefined for unknown session", () => {
			const result = manager.getUpdatedAt("unknown-session")

			expect(result).toBeUndefined()
		})

		it("updateTimestamp stores timestamp", () => {
			manager.updateTimestamp("session-123", "2023-01-01T10:00:00Z")

			expect(manager.getUpdatedAt("session-123")).toBe("2023-01-01T10:00:00Z")
		})

		it("updateTimestamp only updates if new timestamp is greater", () => {
			manager.updateTimestamp("session-123", "2023-01-01T10:00:00Z")
			manager.updateTimestamp("session-123", "2023-01-01T09:00:00Z") // older timestamp

			expect(manager.getUpdatedAt("session-123")).toBe("2023-01-01T10:00:00Z")
		})

		it("updateTimestamp ignores older timestamps", () => {
			manager.updateTimestamp("session-123", "2023-01-01T09:00:00Z")
			manager.updateTimestamp("session-123", "2023-01-01T10:00:00Z") // newer timestamp

			expect(manager.getUpdatedAt("session-123")).toBe("2023-01-01T10:00:00Z")
		})
	})

	describe("Mode/Model Tracking", () => {
		it("getMode returns undefined for unknown session", () => {
			const result = manager.getMode("unknown-session")

			expect(result).toBeUndefined()
		})

		it("setMode stores mode for session", () => {
			manager.setMode("session-123", "code")

			expect(manager.getMode("session-123")).toBe("code")
		})

		it("getModel returns undefined for unknown session", () => {
			const result = manager.getModel("unknown-session")

			expect(result).toBeUndefined()
		})

		it("setModel stores model for session", () => {
			manager.setModel("session-123", "gpt-4")

			expect(manager.getModel("session-123")).toBe("gpt-4")
		})
	})

	describe("Token Validity Cache", () => {
		it("getTokenValidity returns undefined for unknown token", () => {
			const result = manager.getTokenValidity("unknown-token")

			expect(result).toBeUndefined()
		})

		it("setTokenValidity stores validity status", () => {
			manager.setTokenValidity("token-123", true)

			expect(manager.getTokenValidity("token-123")).toBe(true)
		})

		it("clearTokenValidity removes cached validity", () => {
			manager.setTokenValidity("token-123", true)
			manager.clearTokenValidity("token-123")

			expect(manager.getTokenValidity("token-123")).toBeUndefined()
		})
	})

	describe("Task Session (In-Memory Fallback)", () => {
		it("getSessionForTask returns undefined for unknown task", () => {
			const result = manager.getSessionForTask("unknown-task")

			expect(result).toBeUndefined()
		})

		it("setSessionForTask stores session ID", () => {
			manager.setSessionForTask("task-123", "session-456")

			expect(manager.getSessionForTask("task-123")).toBe("session-456")
		})

		it("getSessionForTask returns stored session ID", () => {
			manager.setSessionForTask("task-123", "session-456")

			expect(manager.getSessionForTask("task-123")).toBe("session-456")
		})

		it("multiple task sessions can be stored independently", () => {
			manager.setSessionForTask("task-1", "session-1")
			manager.setSessionForTask("task-2", "session-2")

			expect(manager.getSessionForTask("task-1")).toBe("session-1")
			expect(manager.getSessionForTask("task-2")).toBe("session-2")
			expect(manager.getSessionForTask("task-3")).toBeUndefined()
		})

		it("setSessionForTask overwrites existing value", () => {
			manager.setSessionForTask("task-123", "session-old")
			manager.setSessionForTask("task-123", "session-new")

			expect(manager.getSessionForTask("task-123")).toBe("session-new")
		})
	})

	describe("Workspace Directory", () => {
		it("getWorkspaceDir returns null initially", () => {
			const result = manager.getWorkspaceDir()

			expect(result).toBeNull()
		})

		it("setWorkspaceDir stores directory", () => {
			manager.setWorkspaceDir("/path/to/workspace")

			expect(manager.getWorkspaceDir()).toBe("/path/to/workspace")
		})
	})

	describe("Reset Functionality", () => {
		it("reset clears all state", () => {
			// Set up some state
			manager.setActiveSessionId("session-123")
			manager.setWorkspaceDir("/workspace")
			manager.markSessionVerified("session-123")
			manager.setGitUrl("task-1", "url")
			manager.setGitHash("task-1", "hash")
			manager.setTitle("session-123", "title")
			manager.updateTimestamp("session-123", "2023-01-01T10:00:00Z")
			manager.setMode("session-123", "code")
			manager.setModel("session-123", "gpt-4")
			manager.setTokenValidity("token", true)
			manager.setSessionForTask("task-1", "cached-session")

			// Reset
			manager.reset()

			// Verify all state is cleared
			expect(manager.getActiveSessionId()).toBeNull()
			expect(manager.getWorkspaceDir()).toBeNull()
			expect(manager.isSessionVerified("session-123")).toBe(false)
			expect(manager.getGitUrl("task-1")).toBeUndefined()
			expect(manager.getGitHash("task-1")).toBeUndefined()
			expect(manager.hasTitle("session-123")).toBe(false)
			expect(manager.getUpdatedAt("session-123")).toBeUndefined()
			expect(manager.getMode("session-123")).toBeUndefined()
			expect(manager.getModel("session-123")).toBeUndefined()
			expect(manager.getTokenValidity("token")).toBeUndefined()
			expect(manager.getSessionForTask("task-1")).toBeUndefined()
		})

		it("reset allows fresh state to be set", () => {
			// Set and reset
			manager.setActiveSessionId("old-session")
			manager.reset()

			// Set new state
			manager.setActiveSessionId("new-session")
			manager.setWorkspaceDir("/new-workspace")

			// Verify new state works
			expect(manager.getActiveSessionId()).toBe("new-session")
			expect(manager.getWorkspaceDir()).toBe("/new-workspace")
		})
	})
})
