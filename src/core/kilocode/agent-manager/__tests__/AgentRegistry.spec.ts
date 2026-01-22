import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { AgentRegistry } from "../AgentRegistry"
import type { ParallelModeInfo } from "../types"

describe("AgentRegistry", () => {
	let registry: AgentRegistry

	beforeEach(() => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date("2020-01-01T00:00:00.000Z"))
		registry = new AgentRegistry()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it("uses the selectedId accessor and validates unknown ids", () => {
		const first = registry.createSession("session-1", "first prompt")
		expect(registry.selectedId).toBe(first.sessionId)

		registry.selectedId = "missing"
		expect(registry.selectedId).toBeNull()

		const second = registry.createSession("session-2", "second prompt")
		registry.selectedId = first.sessionId
		expect(registry.selectedId).toBe(first.sessionId)

		// Setting a known id should stick; unknown should clear
		registry.selectedId = second.sessionId
		expect(registry.selectedId).toBe(second.sessionId)
	})

	it("sorts sessions by most recent start time", () => {
		const first = registry.createSession("session-1", "first")
		vi.advanceTimersByTime(1)
		const second = registry.createSession("session-2", "second")
		const sessions = registry.getSessions()

		expect(sessions.map((s) => s.sessionId)).toEqual([second.sessionId, first.sessionId])
	})

	it("caps logs to the max log count", () => {
		const { sessionId } = registry.createSession("session-1", "loggy")
		for (let i = 0; i < 105; i++) {
			registry.appendLog(sessionId, `log-${i}`)
		}

		const session = registry.getSession(sessionId)
		expect(session?.logs.length).toBe(100)
		expect(session?.logs[0]).toBe("log-5") // first five should be trimmed
		expect(session?.logs.at(-1)).toBe("log-104")
	})

	it("prunes oldest non-running sessions when over capacity", () => {
		// Fill up to the limit
		const created: string[] = []
		for (let i = 0; i < 10; i++) {
			vi.advanceTimersByTime(1)
			const session = registry.createSession(`session-${i}`, `session-${i}`)
			created.push(session.sessionId)
		}

		// Mark the earliest three as non-running so they are eligible for pruning
		registry.updateSessionStatus(created[0], "done")
		registry.updateSessionStatus(created[1], "done")
		registry.updateSessionStatus(created[2], "done")

		// Create one more to trigger pruning; should drop the oldest done session (created[0])
		const extra = registry.createSession("session-overflow", "overflow")

		const ids = registry.getSessions().map((s) => s.sessionId)
		expect(ids).toHaveLength(10)
		expect(ids).not.toContain(created[0])
		expect(ids).toContain(created[1])
		expect(ids).toContain(extra.sessionId)
	})

	it("getState returns the current sessions and selection", () => {
		const session = registry.createSession("session-1", "stateful")
		const state = registry.getState()

		expect(state.selectedId).toBe(session.sessionId)
		expect(state.sessions[0].sessionId).toBe(session.sessionId)
	})

	describe("pending session", () => {
		it("setPendingSession creates a pending session", () => {
			expect(registry.pendingSession).toBeNull()

			const pending = registry.setPendingSession("test prompt")

			expect(pending.prompt).toBe("test prompt")
			expect(pending.label).toBe("test prompt")
			expect(pending.startTime).toBeDefined()
			expect(registry.pendingSession).toBe(pending)
		})

		it("clearPendingSession clears the pending session", () => {
			registry.setPendingSession("test prompt")
			expect(registry.pendingSession).not.toBeNull()

			registry.clearPendingSession()

			expect(registry.pendingSession).toBeNull()
		})

		it("truncates long prompts in pending session label", () => {
			const longPrompt = "a".repeat(100)
			const pending = registry.setPendingSession(longPrompt)

			expect(pending.label.length).toBeLessThanOrEqual(40)
			expect(pending.label.endsWith("...")).toBe(true)
		})
	})

	describe("hasActiveProcess", () => {
		it("returns false for non-existent session", () => {
			expect(registry.hasActiveProcess("non-existent")).toBe(false)
		})

		it("returns false for running session without pid", () => {
			const session = registry.createSession("session-1", "test")
			expect(session.status).toBe("running")
			expect(session.pid).toBeUndefined()

			expect(registry.hasActiveProcess(session.sessionId)).toBe(false)
		})

		it("returns true for running session with pid", () => {
			const session = registry.createSession("session-1", "test")
			registry.setSessionPid(session.sessionId, 12345)

			expect(registry.hasActiveProcess(session.sessionId)).toBe(true)
		})

		it("returns false for completed session with pid", () => {
			const session = registry.createSession("session-1", "test")
			registry.setSessionPid(session.sessionId, 12345)
			registry.updateSessionStatus(session.sessionId, "done")

			expect(registry.hasActiveProcess(session.sessionId)).toBe(false)
		})

		it("returns false for error session with pid", () => {
			const session = registry.createSession("session-1", "test")
			registry.setSessionPid(session.sessionId, 12345)
			registry.updateSessionStatus(session.sessionId, "error")

			expect(registry.hasActiveProcess(session.sessionId)).toBe(false)
		})
	})

	describe("hasRunningSessions", () => {
		it("returns false when no sessions exist", () => {
			expect(registry.hasRunningSessions()).toBe(false)
		})

		it("returns true when a session is running", () => {
			registry.createSession("session-1", "running session")
			expect(registry.hasRunningSessions()).toBe(true)
		})

		it("returns false when all sessions are completed", () => {
			const session = registry.createSession("session-1", "done session")
			registry.updateSessionStatus(session.sessionId, "done")
			expect(registry.hasRunningSessions()).toBe(false)
		})

		it("returns false when all sessions have errors", () => {
			const session = registry.createSession("session-1", "error session")
			registry.updateSessionStatus(session.sessionId, "error")
			expect(registry.hasRunningSessions()).toBe(false)
		})

		it("returns false when all sessions are stopped", () => {
			const session = registry.createSession("session-1", "stopped session")
			registry.updateSessionStatus(session.sessionId, "stopped")
			expect(registry.hasRunningSessions()).toBe(false)
		})

		it("returns true when at least one session is running among others", () => {
			const s1 = registry.createSession("session-1", "done")
			registry.createSession("session-2", "running")
			const s3 = registry.createSession("session-3", "error")

			registry.updateSessionStatus(s1.sessionId, "done")
			registry.updateSessionStatus(s3.sessionId, "error")

			expect(registry.hasRunningSessions()).toBe(true)
		})

		it("returns the count of running sessions", () => {
			registry.createSession("session-1", "running 1")
			registry.createSession("session-2", "running 2")
			const s3 = registry.createSession("session-3", "done")

			registry.updateSessionStatus(s3.sessionId, "done")

			expect(registry.getRunningSessionCount()).toBe(2)
		})
	})

	describe("hasPendingOrRunningSessions", () => {
		it("returns false when no sessions or pending", () => {
			expect(registry.hasPendingOrRunningSessions()).toBe(false)
		})

		it("returns true when pending session exists", () => {
			registry.setPendingSession("test")
			expect(registry.hasPendingOrRunningSessions()).toBe(true)
		})

		it("returns true when running session exists", () => {
			registry.createSession("session-1", "test")
			expect(registry.hasPendingOrRunningSessions()).toBe(true)
		})

		it("returns false when only completed sessions exist", () => {
			const session = registry.createSession("session-1", "test")
			registry.updateSessionStatus(session.sessionId, "done")
			expect(registry.hasPendingOrRunningSessions()).toBe(false)
		})
	})

	describe("parallelMode", () => {
		it("creates session without parallelMode by default", () => {
			const session = registry.createSession("session-1", "no parallel")
			expect(session.parallelMode).toBeUndefined()
		})

		it("creates session with parallelMode enabled when option is provided", () => {
			const session = registry.createSession("session-1", "with parallel", undefined, { parallelMode: true })
			expect(session.parallelMode).toEqual({ enabled: true })
		})

		it("creates session with parallelMode disabled when option is false", () => {
			const session = registry.createSession("session-1", "without parallel", undefined, { parallelMode: false })
			expect(session.parallelMode).toBeUndefined()
		})

		it("updates parallelMode info with branch name", () => {
			const session = registry.createSession("session-1", "parallel session", undefined, { parallelMode: true })
			const updated = registry.updateParallelModeInfo(session.sessionId, {
				branch: "add-feature-1702734891234",
			})

			expect(updated?.parallelMode?.branch).toBe("add-feature-1702734891234")
			expect(updated?.parallelMode?.enabled).toBe(true)
		})

		it("updates parallelMode info with worktree path", () => {
			const session = registry.createSession("session-1", "parallel session", undefined, { parallelMode: true })
			const updated = registry.updateParallelModeInfo(session.sessionId, {
				worktreePath: "/tmp/kilocode-worktree-add-feature",
			})

			expect(updated?.parallelMode?.worktreePath).toBe("/tmp/kilocode-worktree-add-feature")
		})

		it("updates parallelMode info with completion message", () => {
			const session = registry.createSession("session-1", "parallel session", undefined, { parallelMode: true })
			const updated = registry.updateParallelModeInfo(session.sessionId, {
				completionMessage: "Changes committed to: add-feature\ngit merge add-feature",
			})

			expect(updated?.parallelMode?.completionMessage).toBe(
				"Changes committed to: add-feature\ngit merge add-feature",
			)
		})

		it("accumulates multiple parallelMode updates", () => {
			const session = registry.createSession("session-1", "parallel session", undefined, { parallelMode: true })

			registry.updateParallelModeInfo(session.sessionId, { branch: "my-branch" })
			registry.updateParallelModeInfo(session.sessionId, { worktreePath: "/tmp/worktree" })
			const final = registry.updateParallelModeInfo(session.sessionId, { completionMessage: "done" })

			expect(final?.parallelMode).toEqual({
				enabled: true,
				branch: "my-branch",
				worktreePath: "/tmp/worktree",
				completionMessage: "done",
			})
		})

		it("returns undefined when updating non-existent session", () => {
			const result = registry.updateParallelModeInfo("non-existent", { branch: "test" })
			expect(result).toBeUndefined()
		})

		it("enables parallelMode when updating a session without parallelMode", () => {
			const session = registry.createSession("session-1", "no parallel mode")
			const result = registry.updateParallelModeInfo(session.sessionId, { branch: "test" })
			expect(result?.parallelMode).toEqual({
				enabled: true,
				branch: "test",
			})
		})

		it("preserves parallelMode info in getState", () => {
			const session = registry.createSession("session-1", "parallel", undefined, { parallelMode: true })
			registry.updateParallelModeInfo(session.sessionId, { branch: "feature-branch" })

			const state = registry.getState()
			expect(state.sessions[0].parallelMode).toEqual({
				enabled: true,
				branch: "feature-branch",
			})
		})
	})

	describe("gitUrl support", () => {
		describe("createSession with gitUrl", () => {
			it("stores gitUrl when provided in options", () => {
				const session = registry.createSession("session-1", "test prompt", undefined, {
					gitUrl: "https://github.com/org/repo.git",
				})

				expect(session.gitUrl).toBe("https://github.com/org/repo.git")
			})

			it("creates session without gitUrl when not provided", () => {
				const session = registry.createSession("session-1", "test prompt")

				expect(session.gitUrl).toBeUndefined()
			})

			it("creates session without gitUrl when options is empty", () => {
				const session = registry.createSession("session-1", "test prompt", undefined, {})

				expect(session.gitUrl).toBeUndefined()
			})
		})

		describe("setPendingSession with gitUrl", () => {
			it("stores gitUrl in pending session when provided", () => {
				const pending = registry.setPendingSession("test prompt", {
					gitUrl: "https://github.com/org/repo.git",
				})

				expect(pending.gitUrl).toBe("https://github.com/org/repo.git")
				expect(registry.pendingSession?.gitUrl).toBe("https://github.com/org/repo.git")
			})

			it("creates pending session without gitUrl when not provided", () => {
				const pending = registry.setPendingSession("test prompt")

				expect(pending.gitUrl).toBeUndefined()
			})
		})

		describe("getState includes gitUrl", () => {
			it("includes gitUrl in session state", () => {
				registry.createSession("session-1", "test prompt", undefined, {
					gitUrl: "https://github.com/org/repo.git",
				})

				const state = registry.getState()

				expect(state.sessions[0].gitUrl).toBe("https://github.com/org/repo.git")
			})
		})

		describe("getSessionsForGitUrl", () => {
			it("returns only sessions without gitUrl when filter is undefined", () => {
				registry.createSession("session-1", "prompt 1", undefined, {
					gitUrl: "https://github.com/org/repo1.git",
				})
				registry.createSession("session-2", "prompt 2", undefined, {
					gitUrl: "https://github.com/org/repo2.git",
				})
				registry.createSession("session-3", "prompt 3") // no gitUrl

				const sessions = registry.getSessionsForGitUrl(undefined)

				expect(sessions).toHaveLength(1)
				expect(sessions[0].sessionId).toBe("session-3")
			})

			it("returns only sessions matching the gitUrl exactly", () => {
				registry.createSession("session-1", "prompt 1", undefined, {
					gitUrl: "https://github.com/org/repo1.git",
				})
				vi.advanceTimersByTime(1)
				registry.createSession("session-2", "prompt 2", undefined, {
					gitUrl: "https://github.com/org/repo2.git",
				})
				vi.advanceTimersByTime(1)
				registry.createSession("session-3", "prompt 3", undefined, {
					gitUrl: "https://github.com/org/repo1.git",
				})

				const sessions = registry.getSessionsForGitUrl("https://github.com/org/repo1.git")

				expect(sessions).toHaveLength(2)
				expect(sessions.map((s) => s.sessionId)).toEqual(["session-3", "session-1"])
			})

			it("excludes sessions without gitUrl when filtering by gitUrl", () => {
				registry.createSession("session-1", "prompt 1", undefined, {
					gitUrl: "https://github.com/org/repo1.git",
				})
				vi.advanceTimersByTime(1)
				registry.createSession("session-2", "prompt 2") // no gitUrl
				vi.advanceTimersByTime(1)
				registry.createSession("session-3", "prompt 3", undefined, {
					gitUrl: "https://github.com/org/repo2.git",
				})

				const sessions = registry.getSessionsForGitUrl("https://github.com/org/repo1.git")

				expect(sessions).toHaveLength(1)
				expect(sessions[0].sessionId).toBe("session-1")
			})

			it("returns sessions sorted by most recent start time", () => {
				registry.createSession("session-1", "prompt 1", undefined, {
					gitUrl: "https://github.com/org/repo.git",
				})
				vi.advanceTimersByTime(1)
				registry.createSession("session-2", "prompt 2", undefined, {
					gitUrl: "https://github.com/org/repo.git",
				})
				vi.advanceTimersByTime(1)
				registry.createSession("session-3", "prompt 3", undefined, {
					gitUrl: "https://github.com/org/repo.git",
				})

				const sessions = registry.getSessionsForGitUrl("https://github.com/org/repo.git")

				expect(sessions.map((s) => s.sessionId)).toEqual(["session-3", "session-2", "session-1"])
			})

			it("returns empty array when no sessions match gitUrl", () => {
				registry.createSession("session-1", "prompt 1", undefined, {
					gitUrl: "https://github.com/org/repo1.git",
				})

				const sessions = registry.getSessionsForGitUrl("https://github.com/org/other-repo.git")

				expect(sessions).toHaveLength(0)
			})
		})

		describe("getStateForGitUrl", () => {
			it("returns state filtered by gitUrl", () => {
				registry.createSession("session-1", "prompt 1", undefined, {
					gitUrl: "https://github.com/org/repo1.git",
				})
				vi.advanceTimersByTime(1)
				registry.createSession("session-2", "prompt 2", undefined, {
					gitUrl: "https://github.com/org/repo2.git",
				})

				const state = registry.getStateForGitUrl("https://github.com/org/repo1.git")

				expect(state.sessions).toHaveLength(1)
				expect(state.sessions[0].sessionId).toBe("session-1")
			})

			it("preserves selectedId if session is in filtered results", () => {
				const session1 = registry.createSession("session-1", "prompt 1", undefined, {
					gitUrl: "https://github.com/org/repo1.git",
				})
				registry.selectedId = session1.sessionId

				const state = registry.getStateForGitUrl("https://github.com/org/repo1.git")

				expect(state.selectedId).toBe("session-1")
			})

			it("clears selectedId if session is not in filtered results", () => {
				registry.createSession("session-1", "prompt 1", undefined, {
					gitUrl: "https://github.com/org/repo1.git",
				})
				vi.advanceTimersByTime(1)
				const session2 = registry.createSession("session-2", "prompt 2", undefined, {
					gitUrl: "https://github.com/org/repo2.git",
				})
				registry.selectedId = session2.sessionId

				const state = registry.getStateForGitUrl("https://github.com/org/repo1.git")

				expect(state.selectedId).toBeNull()
			})
		})
	})
})
