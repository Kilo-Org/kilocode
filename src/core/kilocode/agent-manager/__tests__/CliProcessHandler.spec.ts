import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { EventEmitter } from "node:events"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
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
	onPaymentRequiredPrompt: ReturnType<typeof vi.fn>
	onSessionRenamed: ReturnType<typeof vi.fn>
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
		onPaymentRequiredPrompt: vi.fn(),
		onSessionRenamed: vi.fn(),
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
		it("spawns a CLI process with correct arguments (yolo mode for testing)", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			expect(spawnMock).toHaveBeenCalledWith(
				"/path/to/kilocode",
				["--json-io", "--yolo", "--workspace=/workspace", "test prompt"],
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

		it("sets KILO_PLATFORM environment variable to agent-manager", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			expect(spawnMock).toHaveBeenCalledWith(
				expect.any(String),
				expect.any(Array),
				expect.objectContaining({
					env: expect.objectContaining({
						KILO_PLATFORM: "agent-manager",
					}),
				}),
			)
		})

		it("injects kilocode provider configuration into env", () => {
			process.env.EXISTING_VAR = "keep-me"
			const previousHome = process.env.HOME
			const previousTmpDir = process.env.TMPDIR
			const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cli-process-handler-home-"))
			process.env.HOME = tempHome
			delete process.env.TMPDIR
			const onCliEvent = vi.fn()

			handler.spawnProcess(
				"/path/to/kilocode",
				"/workspace",
				"test prompt",
				{
					apiConfiguration: {
						apiProvider: "kilocode",
						kilocodeToken: "abc123",
						kilocodeModel: "claude-sonnet-4-20250514",
					},
				},
				onCliEvent,
			)

			const env = (spawnMock.mock.calls[0] as unknown as [string, string[], Record<string, any>])[2].env
			expect(env.KILO_PROVIDER).toBe("default")
			expect(env.KILO_PROVIDER_TYPE).toBe("kilocode")
			expect(env.KILOCODE_TOKEN).toBe("abc123")
			expect(env.KILOCODE_MODEL).toBe("claude-sonnet-4-20250514")
			expect(env.KILO_PLATFORM).toBe("agent-manager")
			expect(env.EXISTING_VAR).toBe("keep-me")

			fs.rmSync(tempHome, { recursive: true, force: true })
			if (previousHome === undefined) delete process.env.HOME
			else process.env.HOME = previousHome
			if (previousTmpDir === undefined) delete process.env.TMPDIR
			else process.env.TMPDIR = previousTmpDir
			delete process.env.EXISTING_VAR
		})

		it("overrides HOME when user CLI config lacks a kilocode provider", () => {
			const previousHome = process.env.HOME
			const previousTmpDir = process.env.TMPDIR

			const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cli-process-handler-config-home-"))
			const tempTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-process-handler-tmp-"))
			process.env.HOME = tempHome
			process.env.TMPDIR = tempTmpDir

			const configPath = path.join(tempHome, ".kilocode", "cli", "config.json")
			fs.mkdirSync(path.dirname(configPath), { recursive: true })
			fs.writeFileSync(
				configPath,
				JSON.stringify({
					version: "1.0.0",
					provider: "default",
					providers: [{ id: "default", provider: "anthropic", apiKey: "x", apiModelId: "y" }],
				}),
			)

			const onCliEvent = vi.fn()

			handler.spawnProcess(
				"/path/to/kilocode",
				"/workspace",
				"test prompt",
				{
					apiConfiguration: {
						apiProvider: "kilocode",
						kilocodeToken: "abc123",
						kilocodeModel: "claude-sonnet-4-20250514",
					},
				},
				onCliEvent,
			)

			const env = (spawnMock.mock.calls[0] as unknown as [string, string[], Record<string, any>])[2].env
			expect(env.HOME).toBe(path.join(tempTmpDir, "kilocode-agent-manager-home"))
			expect(env.USERPROFILE).toBe(path.join(tempTmpDir, "kilocode-agent-manager-home"))
			expect(env.KILO_PROVIDER_TYPE).toBe("kilocode")
			expect(env.KILOCODE_TOKEN).toBe("abc123")
			expect(env.KILOCODE_MODEL).toBe("claude-sonnet-4-20250514")

			fs.rmSync(tempHome, { recursive: true, force: true })
			fs.rmSync(tempTmpDir, { recursive: true, force: true })
			if (previousHome === undefined) delete process.env.HOME
			else process.env.HOME = previousHome
			if (previousTmpDir === undefined) delete process.env.TMPDIR
			else process.env.TMPDIR = previousTmpDir
		})

		it("does not inject BYOK provider settings", () => {
			const onCliEvent = vi.fn()

			handler.spawnProcess(
				"/path/to/kilocode",
				"/workspace",
				"test prompt",
				{
					apiConfiguration: {
						apiProvider: "openrouter",
						openRouterApiKey: "or-key",
						openRouterModelId: "openai/gpt-4",
						openRouterBaseUrl: "https://openrouter.ai",
					},
				},
				onCliEvent,
			)

			const env = (spawnMock.mock.calls[0] as unknown as [string, string[], Record<string, any>])[2].env
			expect(env.KILO_OPENROUTER_API_KEY).toBeUndefined()
			expect(env.KILO_OPENROUTER_MODEL_ID).toBeUndefined()
			expect(env.KILO_OPENROUTER_BASE_URL).toBeUndefined()
		})

		it("does not inject anthropic BYOK settings", () => {
			process.env.KILO_API_KEY = "user-api-key"
			const previousProviderType = process.env.KILO_PROVIDER_TYPE
			delete process.env.KILO_PROVIDER_TYPE
			const onCliEvent = vi.fn()

			handler.spawnProcess(
				"/path/to/kilocode",
				"/workspace",
				"test prompt",
				{
					apiConfiguration: {
						apiProvider: "anthropic",
						apiModelId: "claude-3-sonnet",
					},
				},
				onCliEvent,
			)

			const env = (spawnMock.mock.calls[0] as unknown as [string, string[], Record<string, any>])[2].env
			// Leave any existing user env intact, but do not inject provider selection/fields.
			expect(env.KILO_PROVIDER_TYPE).toBeUndefined()
			expect(env.KILO_API_MODEL_ID).toBeUndefined()
			expect(env.KILO_API_KEY).toBe("user-api-key")

			delete process.env.KILO_API_KEY
			if (previousProviderType === undefined) delete process.env.KILO_PROVIDER_TYPE
			else process.env.KILO_PROVIDER_TYPE = previousProviderType
		})

		describe("Windows .cmd file handling", () => {
			it("uses shell: true for .cmd files on Windows", () => {
				const originalPlatform = process.platform
				Object.defineProperty(process, "platform", { value: "win32", configurable: true })

				try {
					const onCliEvent = vi.fn()
					handler.spawnProcess(
						"C:\\Users\\test\\.kilocode\\cli\\pkg\\node_modules\\.bin\\kilocode.cmd",
						"/workspace",
						"test prompt",
						undefined,
						onCliEvent,
					)

					expect(spawnMock).toHaveBeenCalledWith(
						"C:\\Users\\test\\.kilocode\\cli\\pkg\\node_modules\\.bin\\kilocode.cmd",
						expect.any(Array),
						expect.objectContaining({ shell: true }),
					)
				} finally {
					Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true })
				}
			})

			it("uses shell: true for .CMD files (case insensitive) on Windows", () => {
				const originalPlatform = process.platform
				Object.defineProperty(process, "platform", { value: "win32", configurable: true })

				try {
					const onCliEvent = vi.fn()
					handler.spawnProcess(
						"C:\\Users\\test\\kilocode.CMD",
						"/workspace",
						"test prompt",
						undefined,
						onCliEvent,
					)

					expect(spawnMock).toHaveBeenCalledWith(
						"C:\\Users\\test\\kilocode.CMD",
						expect.any(Array),
						expect.objectContaining({ shell: true }),
					)
				} finally {
					Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true })
				}
			})

			it("uses shell: false for non-.cmd executables on Windows", () => {
				const originalPlatform = process.platform
				Object.defineProperty(process, "platform", { value: "win32", configurable: true })

				try {
					const onCliEvent = vi.fn()
					handler.spawnProcess(
						"C:\\Users\\test\\kilocode.exe",
						"/workspace",
						"test prompt",
						undefined,
						onCliEvent,
					)

					expect(spawnMock).toHaveBeenCalledWith(
						"C:\\Users\\test\\kilocode.exe",
						expect.any(Array),
						expect.objectContaining({ shell: false }),
					)
				} finally {
					Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true })
				}
			})

			it("uses shell: false on macOS regardless of extension", () => {
				const originalPlatform = process.platform
				Object.defineProperty(process, "platform", { value: "darwin", configurable: true })

				try {
					const onCliEvent = vi.fn()
					handler.spawnProcess("/usr/local/bin/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

					expect(spawnMock).toHaveBeenCalledWith(
						"/usr/local/bin/kilocode",
						expect.any(Array),
						expect.objectContaining({ shell: false }),
					)
				} finally {
					Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true })
				}
			})

			it("uses shell: false on Linux regardless of extension", () => {
				const originalPlatform = process.platform
				Object.defineProperty(process, "platform", { value: "linux", configurable: true })

				try {
					const onCliEvent = vi.fn()
					handler.spawnProcess("/usr/bin/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

					expect(spawnMock).toHaveBeenCalledWith(
						"/usr/bin/kilocode",
						expect.any(Array),
						expect.objectContaining({ shell: false }),
					)
				} finally {
					Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true })
				}
			})
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

		it("handles payment_required_prompt before session_created", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			const payEvent = JSON.stringify({
				streamEventType: "kilocode",
				payload: {
					type: "ask",
					ask: "payment_required_prompt",
					text: JSON.stringify({ message: "Need billing" }),
				},
			})
			mockProcess.stdout.emit("data", Buffer.from(payEvent + "\n"))

			expect(callbacks.onStartSessionFailed).toHaveBeenCalledWith({
				type: "payment_required",
				message: "Need billing",
				payload: expect.objectContaining({ ask: "payment_required_prompt" }),
			})
			expect(callbacks.onPaymentRequiredPrompt).not.toHaveBeenCalled()
			expect(registry.pendingSession).toBeNull()
			expect(mockProcess.kill).toHaveBeenCalledWith("SIGTERM")
		})

		it("handles api_req_failed before session_created", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			const failEvent = JSON.stringify({
				streamEventType: "kilocode",
				payload: { type: "ask", ask: "api_req_failed", text: "Auth failed" },
			})
			mockProcess.stdout.emit("data", Buffer.from(failEvent + "\n"))

			expect(callbacks.onStartSessionFailed).toHaveBeenCalledWith({
				type: "api_req_failed",
				message: "Auth failed",
				authError: false,
				payload: expect.objectContaining({ ask: "api_req_failed" }),
			})
			expect(registry.pendingSession).toBeNull()
			expect(mockProcess.kill).toHaveBeenCalledWith("SIGTERM")
		})

		it("parses api_req_failed payload JSON and marks auth error", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			const failEvent = JSON.stringify({
				streamEventType: "kilocode",
				payload: {
					type: "ask",
					ask: "api_req_failed",
					content:
						'401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_123"}',
				},
			})
			mockProcess.stdout.emit("data", Buffer.from(failEvent + "\n"))

			expect(callbacks.onStartSessionFailed).toHaveBeenCalledWith({
				type: "api_req_failed",
				message: "Authentication failed: API request failed.",
				authError: true,
				payload: expect.objectContaining({ ask: "api_req_failed" }),
			})
		})

		it("marks auth error when api_req_failed includes provider prefix", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			const failEvent = JSON.stringify({
				streamEventType: "kilocode",
				payload: {
					type: "ask",
					ask: "api_req_failed",
					text: "Provider error: 401 No cookie auth credentials found",
				},
			})
			mockProcess.stdout.emit("data", Buffer.from(failEvent + "\n"))

			expect(callbacks.onStartSessionFailed).toHaveBeenCalledWith({
				type: "api_req_failed",
				message: "Authentication failed: Provider error: 401 No cookie auth credentials found",
				authError: true,
				payload: expect.objectContaining({ ask: "api_req_failed" }),
			})
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

		it("handles exit with signal (null code)", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)
			mockProcess.stdout.emit("data", Buffer.from('{"event":"session_created","sessionId":"session-1"}\n'))

			mockProcess.emit("exit", null, "SIGTERM")

			const session = registry.getSession("session-1")
			expect(session?.status).toBe("error")
			expect(callbacks.onSessionLog).toHaveBeenCalledWith("session-1", expect.stringContaining("signal SIGTERM"))
		})

		it("handles timeout exit (code 124)", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)
			mockProcess.stdout.emit("data", Buffer.from('{"event":"session_created","sessionId":"session-1"}\n'))

			mockProcess.emit("exit", 124, null)

			const session = registry.getSession("session-1")
			expect(session?.status).toBe("error")
			expect(session?.exitCode).toBe(124)
			expect(session?.error).toBe("CLI timeout exceeded")
			expect(callbacks.onSessionLog).toHaveBeenCalledWith("session-1", "Agent timed out")
		})

		it("handles SIGINT interrupted exit (code 130)", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)
			mockProcess.stdout.emit("data", Buffer.from('{"event":"session_created","sessionId":"session-1"}\n'))

			mockProcess.emit("exit", 130, null)

			const session = registry.getSession("session-1")
			expect(session?.status).toBe("stopped")
			expect(session?.exitCode).toBe(130)
			expect(callbacks.onSessionLog).toHaveBeenCalledWith("session-1", "Agent was interrupted")
		})

		it("handles SIGKILL interrupted exit (code 137)", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)
			mockProcess.stdout.emit("data", Buffer.from('{"event":"session_created","sessionId":"session-1"}\n'))

			mockProcess.emit("exit", 137, null)

			const session = registry.getSession("session-1")
			expect(session?.status).toBe("stopped")
			expect(session?.exitCode).toBe(137)
			expect(callbacks.onSessionLog).toHaveBeenCalledWith("session-1", "Agent was interrupted")
		})

		it("handles SIGTERM interrupted exit (code 143)", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)
			mockProcess.stdout.emit("data", Buffer.from('{"event":"session_created","sessionId":"session-1"}\n'))

			mockProcess.emit("exit", 143, null)

			const session = registry.getSession("session-1")
			expect(session?.status).toBe("stopped")
			expect(session?.exitCode).toBe(143)
			expect(callbacks.onSessionLog).toHaveBeenCalledWith("session-1", "Agent was interrupted")
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

		it("handles pending process exit with success (no session created) - shows generic error", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			// Exit with code 0 before session_created (unusual but possible)
			mockProcess.emit("exit", 0, null)

			expect(registry.pendingSession).toBeNull()
			// Generic fallback ensures user never gets "nothing happened"
			expect(callbacks.onStartSessionFailed).toHaveBeenCalledWith({
				type: "unknown",
				message: "CLI exited before creating a session",
			})
		})

		it("handles CLI configuration error from welcome event instructions", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			// Emit welcome event with configuration error instructions (like misconfigured CLI)
			const welcomeEvent =
				'{"type":"welcome","metadata":{"welcomeOptions":{"instructions":["Configuration Error: config.json is incomplete","kilocodeToken is required"]}}}\n'
			mockProcess.stdout.emit("data", Buffer.from(welcomeEvent))

			// Exit with code 0 (CLI exits normally after showing configuration error)
			mockProcess.emit("exit", 0, null)

			expect(registry.pendingSession).toBeNull()
			expect(callbacks.onStartSessionFailed).toHaveBeenCalledWith({
				type: "cli_configuration_error",
				message: "Configuration Error: config.json is incomplete\nkilocodeToken is required",
			})
		})

		it("reports generic error when no instructions present but exits before session created", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			// Emit normal welcome event without instructions
			const welcomeEvent = '{"type":"welcome","metadata":{"welcomeOptions":{}}}\n'
			mockProcess.stdout.emit("data", Buffer.from(welcomeEvent))

			// Exit with code 0
			mockProcess.emit("exit", 0, null)

			expect(registry.pendingSession).toBeNull()
			// Generic fallback - not a configuration error, but still an error
			expect(callbacks.onStartSessionFailed).toHaveBeenCalledWith({
				type: "unknown",
				message: "CLI exited before creating a session",
			})
		})

		it("handles CLI configuration error when welcome event JSON is split across chunks", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			// Emit welcome event split across multiple chunks (simulating real CLI behavior)
			// First chunk contains partial JSON
			const chunk1 =
				'{"type":"welcome","metadata":{"welcomeOptions":{"instructions":["Configuration Error: config.json is incomplete",'
			mockProcess.stdout.emit("data", Buffer.from(chunk1))

			// Second chunk contains the rest of the JSON with newline
			const chunk2 = '"kilocodeToken is required"]}}}\n'
			mockProcess.stdout.emit("data", Buffer.from(chunk2))

			// Exit with code 0 (CLI exits normally after showing configuration error)
			mockProcess.emit("exit", 0, null)

			expect(registry.pendingSession).toBeNull()
			expect(callbacks.onStartSessionFailed).toHaveBeenCalledWith({
				type: "cli_configuration_error",
				message: "Configuration Error: config.json is incomplete\nkilocodeToken is required",
			})
		})

		it("handles CLI configuration error when welcome event is flushed on process exit", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			// Emit welcome event WITHOUT trailing newline (will be buffered)
			const welcomeEvent =
				'{"type":"welcome","metadata":{"welcomeOptions":{"instructions":["Configuration Error: missing token"]}}}'
			mockProcess.stdout.emit("data", Buffer.from(welcomeEvent))

			// Exit with code 0 - parser should flush and capture the configuration error
			mockProcess.emit("exit", 0, null)

			expect(registry.pendingSession).toBeNull()
			expect(callbacks.onStartSessionFailed).toHaveBeenCalledWith({
				type: "cli_configuration_error",
				message: "Configuration Error: missing token",
			})
		})

		it("handles CLI configuration error from truncated JSON using raw output fallback", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			// Emit truncated JSON (simulating CLI exiting before sending complete JSON)
			// This is the real-world scenario where the CLI sends partial output
			const truncatedJson = '{"type":"welcome","metadata":{"welcomeOptions":{"instructions":["Configuration Error'
			mockProcess.stdout.emit("data", Buffer.from(truncatedJson))

			// Exit with code 0 - JSON can't be parsed, but raw output should be checked
			mockProcess.emit("exit", 0, null)

			expect(registry.pendingSession).toBeNull()
			expect(callbacks.onStartSessionFailed).toHaveBeenCalledWith({
				type: "cli_configuration_error",
				message:
					"CLI configuration is incomplete or invalid. Please run 'kilocode config' or 'kilocode auth' to configure.",
			})
		})

		it("handles CLI configuration error when raw output contains kilocodeToken error", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			// Emit output containing the specific error message
			const output = "Some output... kilocodeToken is required and cannot be empty... more output"
			mockProcess.stdout.emit("data", Buffer.from(output))

			mockProcess.emit("exit", 0, null)

			expect(callbacks.onStartSessionFailed).toHaveBeenCalledWith({
				type: "cli_configuration_error",
				message:
					"CLI configuration is incomplete or invalid. Please run 'kilocode config' or 'kilocode auth' to configure.",
			})
		})

		it("caps stdout buffer to prevent memory issues with large output", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			// Send a lot of data to the stdout buffer (more than 64KB)
			const largeChunk = "x".repeat(32 * 1024) // 32KB chunks
			mockProcess.stdout.emit("data", Buffer.from(largeChunk))
			mockProcess.stdout.emit("data", Buffer.from(largeChunk))
			mockProcess.stdout.emit("data", Buffer.from(largeChunk)) // 96KB total

			// Access the private pendingProcess to check buffer size
			const pendingProcess = (handler as any).pendingProcess
			const bufferSize = pendingProcess.stdoutBuffer.reduce((sum: number, chunk: string) => sum + chunk.length, 0)

			// Buffer should be capped at 64KB
			expect(bufferSize).toBeLessThanOrEqual(64 * 1024)
		})

		it("preserves most recent data when capping buffer", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			// Send chunks with identifiable content
			const oldData = "OLD_DATA_".repeat(8 * 1024) // ~80KB of old data
			const newData = "kilocodeToken is required" // This should be preserved

			mockProcess.stdout.emit("data", Buffer.from(oldData))
			mockProcess.stdout.emit("data", Buffer.from(newData))

			// Exit with code 0 - should detect config error from preserved recent data
			mockProcess.emit("exit", 0, null)

			expect(callbacks.onStartSessionFailed).toHaveBeenCalledWith({
				type: "cli_configuration_error",
				message:
					"CLI configuration is incomplete or invalid. Please run 'kilocode config' or 'kilocode auth' to configure.",
			})
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

	describe("provisional session handling", () => {
		it("creates provisional session when kilocode event arrives before session_created", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			// Emit a kilocode event before session_created (e.g., user_feedback with the prompt)
			const kilocodeEvent = JSON.stringify({
				streamEventType: "kilocode",
				payload: { type: "say", say: "user_feedback", content: "test prompt" },
			})
			mockProcess.stdout.emit("data", Buffer.from(kilocodeEvent + "\n"))

			// A provisional session should be created
			const sessions = registry.getSessions()
			expect(sessions).toHaveLength(1)
			expect(sessions[0].sessionId).toMatch(/^provisional-/)
			expect(sessions[0].status).toBe("running")
		})

		it("forwards events to provisional session before session_created", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			// Emit a kilocode event before session_created
			const kilocodeEvent = JSON.stringify({
				streamEventType: "kilocode",
				payload: { type: "say", say: "user_feedback", content: "test prompt" },
			})
			mockProcess.stdout.emit("data", Buffer.from(kilocodeEvent + "\n"))

			// Event should be forwarded with provisional session ID
			expect(onCliEvent).toHaveBeenCalledWith(
				expect.stringMatching(/^provisional-/),
				expect.objectContaining({
					streamEventType: "kilocode",
					payload: expect.objectContaining({
						type: "say",
						say: "user_feedback",
					}),
				}),
			)
		})

		it("renames provisional session to real session ID when session_created arrives", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			// Emit a kilocode event before session_created to create provisional session
			const kilocodeEvent = JSON.stringify({
				streamEventType: "kilocode",
				payload: { type: "say", say: "user_feedback", content: "test prompt" },
			})
			mockProcess.stdout.emit("data", Buffer.from(kilocodeEvent + "\n"))

			// Get the provisional session ID
			const provisionalId = registry.getSessions()[0].sessionId
			expect(provisionalId).toMatch(/^provisional-/)

			// Now emit session_created with real session ID
			mockProcess.stdout.emit("data", Buffer.from('{"event":"session_created","sessionId":"real-session-123"}\n'))

			// Session should be renamed
			const sessions = registry.getSessions()
			expect(sessions).toHaveLength(1)
			expect(sessions[0].sessionId).toBe("real-session-123")
			expect(registry.getSession(provisionalId)).toBeUndefined()
			expect(registry.getSession("real-session-123")).toBeDefined()
		})

		it("calls onSessionRenamed callback when provisional session is upgraded", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			// Emit a kilocode event before session_created to create provisional session
			const kilocodeEvent = JSON.stringify({
				streamEventType: "kilocode",
				payload: { type: "say", say: "user_feedback", content: "test prompt" },
			})
			mockProcess.stdout.emit("data", Buffer.from(kilocodeEvent + "\n"))

			// Get the provisional session ID
			const provisionalId = registry.getSessions()[0].sessionId

			// Now emit session_created with real session ID
			mockProcess.stdout.emit("data", Buffer.from('{"event":"session_created","sessionId":"real-session-123"}\n'))

			// onSessionRenamed should be called with old and new IDs
			expect(callbacks.onSessionRenamed).toHaveBeenCalledWith(provisionalId, "real-session-123")
		})

		it("continues forwarding events to new session ID after rename", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			// Emit a kilocode event before session_created to create provisional session
			const kilocodeEvent1 = JSON.stringify({
				streamEventType: "kilocode",
				payload: { type: "say", say: "user_feedback", content: "test prompt" },
			})
			mockProcess.stdout.emit("data", Buffer.from(kilocodeEvent1 + "\n"))

			// Now emit session_created with real session ID
			mockProcess.stdout.emit("data", Buffer.from('{"event":"session_created","sessionId":"real-session-123"}\n'))

			// Clear previous calls
			onCliEvent.mockClear()

			// Emit another kilocode event after session_created
			const kilocodeEvent2 = JSON.stringify({
				streamEventType: "kilocode",
				payload: { type: "say", say: "text", content: "Hello world" },
			})
			mockProcess.stdout.emit("data", Buffer.from(kilocodeEvent2 + "\n"))

			// Event should be forwarded with the real session ID
			expect(onCliEvent).toHaveBeenCalledWith(
				"real-session-123",
				expect.objectContaining({
					streamEventType: "kilocode",
					payload: expect.objectContaining({
						type: "say",
						say: "text",
						content: "Hello world",
					}),
				}),
			)
		})

		it("does not call onSessionRenamed when no provisional session exists", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			// Emit session_created directly without any kilocode events first
			mockProcess.stdout.emit("data", Buffer.from('{"event":"session_created","sessionId":"session-1"}\n'))

			// onSessionRenamed should NOT be called
			expect(callbacks.onSessionRenamed).not.toHaveBeenCalled()
		})

		it("creates provisional session for api_req_started events", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			// Emit api_req_started before session_created - this SHOULD create provisional session
			const apiStartedEvent = JSON.stringify({
				streamEventType: "kilocode",
				payload: { say: "api_req_started" },
			})
			mockProcess.stdout.emit("data", Buffer.from(apiStartedEvent + "\n"))

			// Provisional session should be created
			const sessions = registry.getSessions()
			expect(sessions).toHaveLength(1)
			expect(sessions[0].sessionId).toMatch(/^provisional-/)
		})

		it("creates provisional session for user_feedback events (user prompt echo)", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			// Emit user_feedback event - this SHOULD create provisional session
			const userFeedbackEvent = JSON.stringify({
				streamEventType: "kilocode",
				payload: { type: "say", say: "user_feedback", content: "test prompt" },
			})
			mockProcess.stdout.emit("data", Buffer.from(userFeedbackEvent + "\n"))

			// Provisional session should be created
			const sessions = registry.getSessions()
			expect(sessions).toHaveLength(1)
			expect(sessions[0].sessionId).toMatch(/^provisional-/)
		})

		it("creates provisional session for text events (streaming content)", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			// Emit text event - this SHOULD create provisional session
			const textEvent = JSON.stringify({
				streamEventType: "kilocode",
				payload: { type: "say", say: "text", content: "Hello" },
			})
			mockProcess.stdout.emit("data", Buffer.from(textEvent + "\n"))

			// Provisional session should be created
			const sessions = registry.getSessions()
			expect(sessions).toHaveLength(1)
			expect(sessions[0].sessionId).toMatch(/^provisional-/)
		})

		it("preserves session data when renaming provisional session", () => {
			const onCliEvent = vi.fn()
			handler.spawnProcess("/path/to/kilocode", "/workspace", "test prompt", undefined, onCliEvent)

			// Emit a kilocode event before session_created to create provisional session
			const kilocodeEvent = JSON.stringify({
				streamEventType: "kilocode",
				payload: { type: "say", say: "user_feedback", content: "test prompt" },
			})
			mockProcess.stdout.emit("data", Buffer.from(kilocodeEvent + "\n"))

			// Get the provisional session
			const provisionalSession = registry.getSessions()[0]
			expect(provisionalSession.prompt).toBe("test prompt")
			expect(provisionalSession.status).toBe("running")

			// Now emit session_created with real session ID
			mockProcess.stdout.emit("data", Buffer.from('{"event":"session_created","sessionId":"real-session-123"}\n'))

			// Session should be renamed but preserve data
			const renamedSession = registry.getSession("real-session-123")
			expect(renamedSession).toBeDefined()
			expect(renamedSession?.prompt).toBe("test prompt")
			expect(renamedSession?.status).toBe("running")
			expect(renamedSession?.pid).toBe(12345)
		})
	})
})
