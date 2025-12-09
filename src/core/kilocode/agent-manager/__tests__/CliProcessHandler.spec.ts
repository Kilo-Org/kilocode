import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { EventEmitter } from "node:events"
import type { ChildProcess } from "node:child_process"
import { CliProcessHandler, type CliProcessHandlerCallbacks } from "../CliProcessHandler"
import { AgentRegistry } from "../AgentRegistry"

// Mock child_process module
vi.mock("node:child_process", () => ({
	spawn: vi.fn(),
}))

/**
 * Creates a mock ChildProcess with EventEmitter capabilities
 */
function createMockProcess() {
	const proc = new EventEmitter() as any
	proc.stdout = new EventEmitter()
	proc.stderr = new EventEmitter()
	proc.kill = vi.fn()
	proc.pid = 12345
	return proc as EventEmitter & {
		stdout: EventEmitter
		stderr: EventEmitter
		kill: ReturnType<typeof vi.fn>
		pid: number
	}
}

/**
 * Creates mock callbacks for testing
 */
function createMockCallbacks(): CliProcessHandlerCallbacks & {
	onLog: ReturnType<typeof vi.fn>
	onDebugLog: ReturnType<typeof vi.fn>
	onSessionLog: ReturnType<typeof vi.fn>
	onStateChanged: ReturnType<typeof vi.fn>
	onPendingSessionChanged: ReturnType<typeof vi.fn>
	onStartSessionFailed: ReturnType<typeof vi.fn>
	onChatMessages: ReturnType<typeof vi.fn>
	onSessionCreated: ReturnType<typeof vi.fn>
} {
	return {
		onLog: vi.fn(),
		onDebugLog: vi.fn(),
		onSessionLog: vi.fn(),
		onStateChanged: vi.fn(),
		onPendingSessionChanged: vi.fn(),
		onStartSessionFailed: vi.fn(),
		onChatMessages: vi.fn(),
		onSessionCreated: vi.fn(),
	}
}

describe("CliProcessHandler", () => {
	let registry: AgentRegistry
	let callbacks: ReturnType<typeof createMockCallbacks>
	let handler: CliProcessHandler
	let mockProcess: ReturnType<typeof createMockProcess>
	let spawnMock: ReturnType<typeof vi.fn>

	beforeEach(async () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"))

		registry = new AgentRegistry()
		callbacks = createMockCallbacks()
		handler = new CliProcessHandler(registry, callbacks)

		mockProcess = createMockProcess()
		const childProcess = await import("node:child_process")
		spawnMock = childProcess.spawn as ReturnType<typeof vi.fn>
		spawnMock.mockReturnValue(mockProcess)
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.clearAllMocks()
	})

	describe("spawnProcess", () => {
		it("spawns a CLI process with correct arguments", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			expect(spawnMock).toHaveBeenCalledWith(
				"/path/to/kilocode",
				["--json-io", "--workspace=/workspace", "test prompt"],
				expect.objectContaining({
					cwd: "/workspace",
					stdio: ["pipe", "pipe", "pipe"],
					shell: false,
				}),
			)
		})

		it("sets pending session in registry", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			expect(registry.pendingSession).not.toBeNull()
			expect(registry.pendingSession?.prompt).toBe("test prompt")
		})

		it("notifies callbacks about pending session", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			expect(callbacks.onPendingSessionChanged).toHaveBeenCalledWith(
				expect.objectContaining({
					prompt: "test prompt",
					label: "test prompt",
				}),
			)
		})

		it("logs spawn information to debug log", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			expect(callbacks.onDebugLog).toHaveBeenCalledWith(expect.stringContaining("Command:"))
			expect(callbacks.onDebugLog).toHaveBeenCalledWith(expect.stringContaining("Working dir:"))
			expect(callbacks.onDebugLog).toHaveBeenCalledWith(expect.stringContaining("Process PID:"))
		})

		it("resumes session with provided sessionId and marks running", () => {
			const onCliEvent = vi.fn()

			handler.spawnProcess(
				"/path/to/kilocode",
				"/workspace",
				"resume prompt",
				{ sessionId: "sess-1" },
				onCliEvent,
			)

			expect(registry.getSession("sess-1")?.status).toBe("running")
			expect(callbacks.onStateChanged).toHaveBeenCalled()
		})

		it("sets environment variables to disable colors", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			expect(spawnMock).toHaveBeenCalledWith(
				expect.any(String),
				expect.any(Array),
				expect.objectContaining({
					env: expect.objectContaining({
						NO_COLOR: "1",
						FORCE_COLOR: "0",
					}),
				}),
			)
		})
	})

	describe("session_created event handling", () => {
		it("creates session when session_created event is received", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			// Emit session_created event
			const sessionCreatedEvent =
				'{"event":"session_created","sessionId":"cli-session-123","timestamp":1234567890}\n'
			mockProcess.stdout.emit("data", Buffer.from(sessionCreatedEvent))

			// Pending session should be cleared
			expect(registry.pendingSession).toBeNull()

			// Session should be created with CLI's sessionId
			const sessions = registry.getSessions()
			expect(sessions).toHaveLength(1)
			expect(sessions[0].sessionId).toBe("cli-session-123")
			expect(sessions[0].status).toBe("running")
		})

		it("clears pending session and notifies callbacks", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			const sessionCreatedEvent = '{"event":"session_created","sessionId":"cli-session-123"}\n'
			mockProcess.stdout.emit("data", Buffer.from(sessionCreatedEvent))

			expect(callbacks.onPendingSessionChanged).toHaveBeenLastCalledWith(null)
			expect(callbacks.onSessionCreated).toHaveBeenCalled()
			expect(callbacks.onStateChanged).toHaveBeenCalled()
		})

		it("captures api_req_started before session_created and forwards flag", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			const apiStartedChunk = JSON.stringify({ streamEventType: "kilocode", payload: { say: "api_req_started" } })
			mockProcess.stdout.emit("data", Buffer.from(apiStartedChunk + "\n"))

			const sessionCreated = '{"event":"session_created","sessionId":"session-1"}\n'
			mockProcess.stdout.emit("data", Buffer.from(sessionCreated))

			expect(callbacks.onSessionCreated).toHaveBeenCalledWith(true)
		})

		it("sets session PID from process", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			const sessionCreatedEvent = '{"event":"session_created","sessionId":"cli-session-123"}\n'
			mockProcess.stdout.emit("data", Buffer.from(sessionCreatedEvent))

			const session = registry.getSession("cli-session-123")
			expect(session?.pid).toBe(12345)
		})

		it("ignores session_created when no pending process", () => {
			// Directly call the handler without spawning
			const onCliEvent = vi.fn()

			// This should not throw and should log a warning
			// We need to simulate receiving the event without a pending process
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			// Clear the pending process manually to simulate edge case
			;(handler as any).pendingProcess = null

			// Now emit session_created - should be ignored
			const sessionCreatedEvent = '{"event":"session_created","sessionId":"cli-session-123"}\n'
			mockProcess.stdout.emit("data", Buffer.from(sessionCreatedEvent))

			expect(registry.getSessions()).toHaveLength(0)
		})

		it("captures worktree branch from welcome event and applies it on session creation", () => {
			const onCliEvent = vi.fn()
			// Start in parallel mode
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", { parallelMode: true }, onCliEvent)

			// First, emit welcome event with worktree branch (this arrives before session_created)
			const welcomeEvent =
				'{"type":"welcome","metadata":{"welcomeOptions":{"worktreeBranch":"feature/test-branch"}}}\n'
			mockProcess.stdout.emit("data", Buffer.from(welcomeEvent))

			// Verify branch was captured in pending process
			expect((handler as any).pendingProcess.worktreeBranch).toBe("feature/test-branch")

			// Then emit session_created
			mockProcess.stdout.emit("data", Buffer.from('{"event":"session_created","sessionId":"session-1"}\n'))

			// Verify session was created with the branch info
			const session = registry.getSession("session-1")
			expect(session?.parallelMode?.enabled).toBe(true)
			expect(session?.parallelMode?.branch).toBe("feature/test-branch")
		})

		it("does not apply worktree branch when not in parallel mode", () => {
			const onCliEvent = vi.fn()
			// Start without parallel mode
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			// Emit welcome event with worktree branch
			const welcomeEvent =
				'{"type":"welcome","metadata":{"welcomeOptions":{"worktreeBranch":"feature/test-branch"}}}\n'
			mockProcess.stdout.emit("data", Buffer.from(welcomeEvent))

			// Then emit session_created
			mockProcess.stdout.emit("data", Buffer.from('{"event":"session_created","sessionId":"session-1"}\n'))

			// Session should not have parallelMode info
			const session = registry.getSession("session-1")
			expect(session?.parallelMode).toBeUndefined()
		})
	})

	describe("event forwarding to active sessions", () => {
		it("forwards kilocode events to onCliEvent callback", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			// First, create the session
			mockProcess.stdout.emit("data", Buffer.from('{"event":"session_created","sessionId":"session-1"}\n'))

			// Then emit a kilocode event
			mockProcess.stdout.emit("data", Buffer.from('{"type":"say","say":"text","content":"Hello"}\n'))

			expect(onCliEvent).toHaveBeenCalledWith(
				"session-1",
				expect.objectContaining({
					streamEventType: "kilocode",
					payload: expect.objectContaining({
						type: "say",
						say: "text",
						content: "Hello",
					}),
				}),
			)
		})

		it("logs status events for pending sessions", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			// Emit status event before session_created
			mockProcess.stdout.emit("data", Buffer.from('{"streamEventType":"status","message":"Initializing..."}\n'))

			expect(callbacks.onDebugLog).toHaveBeenCalledWith("Pending session status: Initializing...")
		})
	})

	describe("stopProcess", () => {
		it("kills the process for a given session", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			// Create the session
			mockProcess.stdout.emit("data", Buffer.from('{"event":"session_created","sessionId":"session-1"}\n'))

			handler.stopProcess("session-1")

			expect(mockProcess.kill).toHaveBeenCalledWith("SIGTERM")
		})

		it("removes session from active sessions", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			mockProcess.stdout.emit("data", Buffer.from('{"event":"session_created","sessionId":"session-1"}\n'))

			expect(handler.hasProcess("session-1")).toBe(true)

			handler.stopProcess("session-1")

			expect(handler.hasProcess("session-1")).toBe(false)
		})

		it("does nothing for non-existent session", () => {
			handler.stopProcess("non-existent")
			// Should not throw
		})
	})

	describe("stopAllProcesses", () => {
		it("kills pending process if exists", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			handler.stopAllProcesses()

			expect(mockProcess.kill).toHaveBeenCalledWith("SIGTERM")
			expect(registry.pendingSession).toBeNull()
		})

		it("kills all active session processes", async () => {
			const onCliEvent = vi.fn()

			// Start first session
			handler.spawnProcess("/path/to/kilocode", "/workspace", "prompt 1", undefined, onCliEvent)
			const proc1 = mockProcess
			mockProcess.stdout.emit("data", Buffer.from('{"event":"session_created","sessionId":"session-1"}\n'))

			// Start second session
			const proc2 = createMockProcess()
			spawnMock.mockReturnValue(proc2)
			handler.spawnProcess("/path/to/kilocode", "/workspace", "prompt 2", undefined, onCliEvent)
			proc2.stdout.emit("data", Buffer.from('{"event":"session_created","sessionId":"session-2"}\n'))

			handler.stopAllProcesses()

			expect(proc1.kill).toHaveBeenCalledWith("SIGTERM")
			expect(proc2.kill).toHaveBeenCalledWith("SIGTERM")
		})

		it("clears all active sessions", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)
			mockProcess.stdout.emit("data", Buffer.from('{"event":"session_created","sessionId":"session-1"}\n'))

			expect(handler.hasProcess("session-1")).toBe(true)

			handler.stopAllProcesses()

			expect(handler.hasProcess("session-1")).toBe(false)
		})
	})

	describe("hasProcess", () => {
		it("returns false for non-existent session", () => {
			expect(handler.hasProcess("non-existent")).toBe(false)
		})

		it("returns true for active session", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)
			mockProcess.stdout.emit("data", Buffer.from('{"event":"session_created","sessionId":"session-1"}\n'))

			expect(handler.hasProcess("session-1")).toBe(true)
		})
	})

	describe("process exit handling", () => {
		it("handles successful exit (code 0)", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)
			mockProcess.stdout.emit("data", Buffer.from('{"event":"session_created","sessionId":"session-1"}\n'))

			mockProcess.emit("exit", 0, null)

			const session = registry.getSession("session-1")
			expect(session?.status).toBe("done")
			expect(session?.exitCode).toBe(0)
			expect(callbacks.onSessionLog).toHaveBeenCalledWith("session-1", "Agent completed")
		})

		it("handles error exit (non-zero code)", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)
			mockProcess.stdout.emit("data", Buffer.from('{"event":"session_created","sessionId":"session-1"}\n'))

			mockProcess.emit("exit", 1, null)

			const session = registry.getSession("session-1")
			expect(session?.status).toBe("error")
			expect(session?.exitCode).toBe(1)
			expect(callbacks.onSessionLog).toHaveBeenCalledWith(
				"session-1",
				expect.stringContaining("exited with code 1"),
			)
		})

		it("handles exit with signal", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)
			mockProcess.stdout.emit("data", Buffer.from('{"event":"session_created","sessionId":"session-1"}\n'))

			mockProcess.emit("exit", null, "SIGTERM")

			const session = registry.getSession("session-1")
			expect(session?.status).toBe("error")
			expect(callbacks.onSessionLog).toHaveBeenCalledWith("session-1", expect.stringContaining("signal SIGTERM"))
		})

		it("flushes parser buffer on exit", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)
			mockProcess.stdout.emit("data", Buffer.from('{"event":"session_created","sessionId":"session-1"}\n'))

			// Send partial data without newline
			mockProcess.stdout.emit("data", Buffer.from('{"type":"say","say":"text","content":"partial"}'))

			// Exit should flush the buffer
			mockProcess.emit("exit", 0, null)

			expect(onCliEvent).toHaveBeenCalledWith(
				"session-1",
				expect.objectContaining({
					streamEventType: "kilocode",
				}),
			)
		})

		it("handles pending process exit with error", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			// Exit before session_created
			mockProcess.emit("exit", 1, null)

			expect(registry.pendingSession).toBeNull()
			expect(callbacks.onPendingSessionChanged).toHaveBeenLastCalledWith(null)
			expect(callbacks.onStartSessionFailed).toHaveBeenCalled()
		})

		it("handles pending process exit with success (no session created)", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			// Exit with code 0 before session_created (unusual but possible)
			mockProcess.emit("exit", 0, null)

			expect(registry.pendingSession).toBeNull()
			expect(callbacks.onStartSessionFailed).not.toHaveBeenCalled()
		})
	})

	describe("process error handling", () => {
		it("handles spawn error for pending process", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			mockProcess.emit("error", new Error("spawn ENOENT"))

			expect(registry.pendingSession).toBeNull()
			expect(callbacks.onPendingSessionChanged).toHaveBeenLastCalledWith(null)
			expect(callbacks.onStartSessionFailed).toHaveBeenCalled()
		})

		it("handles error for active session", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)
			mockProcess.stdout.emit("data", Buffer.from('{"event":"session_created","sessionId":"session-1"}\n'))

			mockProcess.emit("error", new Error("connection reset"))

			const session = registry.getSession("session-1")
			expect(session?.status).toBe("error")
			expect(session?.error).toBe("connection reset")
			expect(callbacks.onSessionLog).toHaveBeenCalledWith("session-1", "Process error: connection reset")
		})
	})

	describe("stderr handling", () => {
		it("logs stderr output to debug log", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			mockProcess.stderr.emit("data", Buffer.from("Warning: something happened"))

			expect(callbacks.onDebugLog).toHaveBeenCalledWith("stderr: Warning: something happened")
		})
	})

	describe("dispose", () => {
		it("stops all processes on dispose", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)
			mockProcess.stdout.emit("data", Buffer.from('{"event":"session_created","sessionId":"session-1"}\n'))

			handler.dispose()

			expect(mockProcess.kill).toHaveBeenCalledWith("SIGTERM")
			expect(handler.hasProcess("session-1")).toBe(false)
		})
	})

	describe("multiple concurrent sessions", () => {
		it("handles multiple sessions independently", () => {
			const onCliEvent = vi.fn()

			// Start first session
			handler.spawnProcess("/path/to/kilocode", "/workspace", "prompt 1", undefined, onCliEvent)
			const proc1 = mockProcess
			proc1.stdout.emit("data", Buffer.from('{"event":"session_created","sessionId":"session-1"}\n'))

			// Start second session
			const proc2 = createMockProcess()
			;(proc2 as any).pid = 54321
			spawnMock.mockReturnValue(proc2)
			handler.spawnProcess("/path/to/kilocode", "/workspace", "prompt 2", undefined, onCliEvent)
			proc2.stdout.emit("data", Buffer.from('{"event":"session_created","sessionId":"session-2"}\n'))

			expect(handler.hasProcess("session-1")).toBe(true)
			expect(handler.hasProcess("session-2")).toBe(true)

			// Stop only first session
			handler.stopProcess("session-1")

			expect(handler.hasProcess("session-1")).toBe(false)
			expect(handler.hasProcess("session-2")).toBe(true)
		})

		it("routes events to correct session", () => {
			const onCliEvent = vi.fn()

			// Start first session
			handler.spawnProcess("/path/to/kilocode", "/workspace", "prompt 1", undefined, onCliEvent)
			const proc1 = mockProcess
			proc1.stdout.emit("data", Buffer.from('{"event":"session_created","sessionId":"session-1"}\n'))

			// Start second session
			const proc2 = createMockProcess()
			spawnMock.mockReturnValue(proc2)
			handler.spawnProcess("/path/to/kilocode", "/workspace", "prompt 2", undefined, onCliEvent)
			proc2.stdout.emit("data", Buffer.from('{"event":"session_created","sessionId":"session-2"}\n'))

			// Emit event from first process
			proc1.stdout.emit("data", Buffer.from('{"type":"say","say":"text","content":"from session 1"}\n'))

			// Emit event from second process
			proc2.stdout.emit("data", Buffer.from('{"type":"say","say":"text","content":"from session 2"}\n'))

			expect(onCliEvent).toHaveBeenCalledWith(
				"session-1",
				expect.objectContaining({
					payload: expect.objectContaining({ content: "from session 1" }),
				}),
			)
			expect(onCliEvent).toHaveBeenCalledWith(
				"session-2",
				expect.objectContaining({
					payload: expect.objectContaining({ content: "from session 2" }),
				}),
			)
		})
	})

	describe("pending session timeout", () => {
		it("times out pending session after 30 seconds if no session_created event", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			expect(registry.pendingSession).not.toBeNull()

			// Advance time by 30 seconds
			vi.advanceTimersByTime(30_000)

			// Pending session should be cleared
			expect(registry.pendingSession).toBeNull()
			expect(callbacks.onPendingSessionChanged).toHaveBeenLastCalledWith(null)
			expect(callbacks.onStartSessionFailed).toHaveBeenCalledWith({
				type: "unknown",
				message: "Session creation timed out - CLI did not respond",
			})
			expect(mockProcess.kill).toHaveBeenCalledWith("SIGTERM")
		})

		it("includes stderr output in timeout error message", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			// Emit some stderr output before timeout
			mockProcess.stderr.emit("data", Buffer.from("Some error output"))

			// Advance time by 30 seconds
			vi.advanceTimersByTime(30_000)

			expect(callbacks.onStartSessionFailed).toHaveBeenCalledWith({
				type: "unknown",
				message: "Some error output",
			})
		})

		it("does not timeout if session_created event arrives in time", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			// Advance time by 15 seconds (half the timeout)
			vi.advanceTimersByTime(15_000)

			// Emit session_created event
			mockProcess.stdout.emit("data", Buffer.from('{"event":"session_created","sessionId":"session-1"}\n'))

			// Advance time past the original timeout
			vi.advanceTimersByTime(20_000)

			// Session should still exist and not be timed out
			expect(registry.getSession("session-1")).toBeDefined()
			expect(registry.getSession("session-1")?.status).toBe("running")
			expect(callbacks.onStartSessionFailed).not.toHaveBeenCalled()
		})

		it("clears timeout when process exits before timeout", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			// Process exits with error before timeout
			mockProcess.emit("exit", 1, null)

			// Advance time past the timeout
			vi.advanceTimersByTime(35_000)

			// onStartSessionFailed should only have been called once (from exit, not timeout)
			expect(callbacks.onStartSessionFailed).toHaveBeenCalledTimes(1)
		})

		it("clears timeout when process errors before timeout", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			// Process errors before timeout
			mockProcess.emit("error", new Error("spawn ENOENT"))

			// Advance time past the timeout
			vi.advanceTimersByTime(35_000)

			// onStartSessionFailed should only have been called once (from error, not timeout)
			expect(callbacks.onStartSessionFailed).toHaveBeenCalledTimes(1)
		})

		it("clears timeout when stopAllProcesses is called", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			handler.stopAllProcesses()

			// Advance time past the timeout
			vi.advanceTimersByTime(35_000)

			// onStartSessionFailed should not have been called (stopAllProcesses doesn't call it)
			expect(callbacks.onStartSessionFailed).not.toHaveBeenCalled()
		})
	})

	describe("cancelPendingSession", () => {
		it("cancels a pending session and kills the process", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			expect(registry.pendingSession).not.toBeNull()

			handler.cancelPendingSession()

			expect(registry.pendingSession).toBeNull()
			expect(mockProcess.kill).toHaveBeenCalledWith("SIGTERM")
			expect(callbacks.onPendingSessionChanged).toHaveBeenLastCalledWith(null)
			expect(callbacks.onStateChanged).toHaveBeenCalled()
		})

		it("does nothing when no pending session exists", () => {
			handler.cancelPendingSession()

			expect(mockProcess.kill).not.toHaveBeenCalled()
			expect(callbacks.onPendingSessionChanged).not.toHaveBeenCalled()
		})

		it("clears the timeout when canceling", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			handler.cancelPendingSession()

			// Advance time past the timeout
			vi.advanceTimersByTime(35_000)

			// onStartSessionFailed should not have been called (cancel doesn't trigger failure)
			expect(callbacks.onStartSessionFailed).not.toHaveBeenCalled()
		})
	})

	describe("gitUrl support", () => {
		it("passes gitUrl to registry when creating pending session", () => {
			const onCliEvent = vi.fn()
			const setPendingSessionSpy = vi.spyOn(registry, "setPendingSession")

			handler.spawnProcess(
				"/path/to/kilocode",
				"/workspace",
				"test prompt",
				{ gitUrl: "https://github.com/org/repo.git" },
				onCliEvent,
			)

			expect(setPendingSessionSpy).toHaveBeenCalledWith(
				"test prompt",
				expect.objectContaining({
					gitUrl: "https://github.com/org/repo.git",
				}),
			)
		})

		it("passes gitUrl to registry when session is created", () => {
			const onCliEvent = vi.fn()
			const createSessionSpy = vi.spyOn(registry, "createSession")

			handler.spawnProcess(
				"/path/to/kilocode",
				"/workspace",
				"test prompt",
				{ gitUrl: "https://github.com/org/repo.git" },
				onCliEvent,
			)

			// Emit session_created event
			mockProcess.stdout.emit("data", Buffer.from('{"event":"session_created","sessionId":"session-1"}\n'))

			expect(createSessionSpy).toHaveBeenCalledWith(
				"session-1",
				"test prompt",
				expect.any(Number),
				expect.objectContaining({
					gitUrl: "https://github.com/org/repo.git",
				}),
			)
		})

		it("includes gitUrl in pending session notification", () => {
			const onCliEvent = vi.fn()

			handler.spawnProcess(
				"/path/to/kilocode",
				"/workspace",
				"test prompt",
				{ gitUrl: "https://github.com/org/repo.git" },
				onCliEvent,
			)

			expect(callbacks.onPendingSessionChanged).toHaveBeenCalledWith(
				expect.objectContaining({
					prompt: "test prompt",
					gitUrl: "https://github.com/org/repo.git",
				}),
			)
		})

		it("spawns process without gitUrl when not provided", () => {
			const onCliEvent = vi.fn()
			const setPendingSessionSpy = vi.spyOn(registry, "setPendingSession")

			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			expect(setPendingSessionSpy).toHaveBeenCalledWith("test prompt", expect.objectContaining({}))
		})

		it("creates session without gitUrl when not provided", () => {
			const onCliEvent = vi.fn()
			const createSessionSpy = vi.spyOn(registry, "createSession")

			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			mockProcess.stdout.emit("data", Buffer.from('{"event":"session_created","sessionId":"session-1"}\n'))

			expect(createSessionSpy).toHaveBeenCalledWith(
				"session-1",
				"test prompt",
				expect.any(Number),
				expect.objectContaining({
					gitUrl: undefined,
				}),
			)
		})
	})
})
