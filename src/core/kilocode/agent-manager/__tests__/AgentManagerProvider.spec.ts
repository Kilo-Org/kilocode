import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest"
import { EventEmitter } from "node:events"
import * as path from "node:path"
import * as telemetry from "../telemetry"

const isWindows = process.platform === "win32"
const MOCK_CLI_PATH = isWindows ? "C:\\mock\\path\\to\\kilocode" : "/mock/path/to/kilocode"

// Mock the local telemetry module
vi.mock("../telemetry", () => ({
	getPlatformDiagnostics: vi.fn(() => ({ platform: "darwin", shell: "bash" })),
	captureAgentManagerOpened: vi.fn(),
	captureAgentManagerSessionStarted: vi.fn(),
	captureAgentManagerSessionCompleted: vi.fn(),
	captureAgentManagerSessionStopped: vi.fn(),
	captureAgentManagerSessionError: vi.fn(),
	captureAgentManagerLoginIssue: vi.fn(),
}))

// Mock CliPathResolver to return CliDiscoveryResult object
// Note: vi.mock is hoisted, so we inline the platform check instead of using MOCK_CLI_PATH
vi.mock("../CliPathResolver", () => ({
	findKilocodeCli: vi.fn().mockResolvedValue({
		cliPath: process.platform === "win32" ? "C:\\mock\\path\\to\\kilocode" : "/mock/path/to/kilocode",
		shellPath: undefined,
	}),
	findExecutable: vi.fn().mockResolvedValue(undefined),
}))

let AgentManagerProvider: typeof import("../AgentManagerProvider").AgentManagerProvider

describe("AgentManagerProvider CLI spawning", () => {
	let provider: InstanceType<typeof AgentManagerProvider>
	const mockContext = { extensionUri: {}, extensionPath: "", extensionMode: 1 /* Development */ } as any
	const mockOutputChannel = { appendLine: vi.fn() } as any
	let mockWindow: {
		showErrorMessage: Mock
		showWarningMessage: Mock
		ViewColumn: { One: number }
		onDidCloseTerminal: Mock
		createTerminal: Mock
	}

	beforeEach(async () => {
		vi.resetModules()

		const mockWorkspaceFolder = { uri: { fsPath: "/tmp/workspace" } }
		const mockProvider = {
			getState: vi.fn().mockResolvedValue({ apiConfiguration: { apiProvider: "kilocode" } }),
		}

		mockWindow = {
			showErrorMessage: vi.fn().mockResolvedValue(undefined),
			showWarningMessage: vi.fn().mockResolvedValue(undefined),
			ViewColumn: { One: 1 },
			onDidCloseTerminal: vi.fn().mockReturnValue({ dispose: vi.fn() }),
			createTerminal: vi.fn().mockReturnValue({ show: vi.fn(), sendText: vi.fn(), dispose: vi.fn() }),
		}

		vi.doMock("vscode", () => ({
			workspace: { workspaceFolders: [mockWorkspaceFolder] },
			window: mockWindow,
			env: { openExternal: vi.fn() },
			Uri: { parse: vi.fn(), joinPath: vi.fn() },
			ViewColumn: { One: 1 },
			ExtensionMode: { Development: 1, Production: 2, Test: 3 },
		}))

		// Mock CliInstaller so getLocalCliPath returns our mock path
		vi.doMock("../CliInstaller", () => ({
			getLocalCliPath: () => MOCK_CLI_PATH,
		}))

		// Mock fileExistsAtPath to return true only for MOCK_CLI_PATH
		// This ensures findKilocodeCli finds the CLI via local path check (works on all platforms)
		vi.doMock("../../../../utils/fs", () => ({
			fileExistsAtPath: vi.fn().mockImplementation((p: string) => Promise.resolve(p === MOCK_CLI_PATH)),
		}))

		// Mock getRemoteUrl for gitUrl support
		vi.doMock("../../../../services/code-index/managed/git-utils", () => ({
			getRemoteUrl: vi.fn().mockResolvedValue(undefined),
		}))

		class TestProc extends EventEmitter {
			stdout = new EventEmitter()
			stderr = new EventEmitter()
			kill = vi.fn()
			pid = 1234
		}

		const spawnMock = vi.fn(() => new TestProc())
		const execSyncMock = vi.fn(() => MOCK_CLI_PATH)

		vi.doMock("node:child_process", () => ({
			spawn: spawnMock,
			execSync: execSyncMock,
		}))

		const module = await import("../AgentManagerProvider")
		AgentManagerProvider = module.AgentManagerProvider
		provider = new AgentManagerProvider(mockContext, mockOutputChannel, mockProvider as any)
	})

	afterEach(() => {
		provider.dispose()
	})

	it("spawns kilocode without shell interpolation for prompt arguments", async () => {
		await (provider as any).startAgentSession('echo "$(whoami)"')

		const spawnMock = (await import("node:child_process")).spawn as unknown as Mock
		expect(spawnMock).toHaveBeenCalledTimes(1)
		const [cmd, args, options] = spawnMock.mock.calls[0] as unknown as [string, string[], Record<string, unknown>]
		expect(cmd).toBe(MOCK_CLI_PATH)
		expect(args[args.length - 1]).toBe('echo "$(whoami)"')
		expect(options?.shell).not.toBe(true)
	})

	// Windows-specific test - runs only on Windows CI
	// We don't simulate Windows on other platforms - let the actual Windows CI test it
	const windowsOnlyTest = isWindows ? it : it.skip

	windowsOnlyTest("spawns with shell: true when CLI path ends with .cmd", async () => {
		vi.resetModules()

		const testNpmDir = "C:\\npm"
		const testWorkspace = "C:\\tmp\\workspace"
		const cmdPath = path.join(testNpmDir, "kilocode") + ".CMD"

		const mockWorkspaceFolder = { uri: { fsPath: testWorkspace } }
		const mockProvider = {
			getState: vi.fn().mockResolvedValue({ apiConfiguration: { apiProvider: "kilocode" } }),
		}

		vi.doMock("vscode", () => ({
			workspace: { workspaceFolders: [mockWorkspaceFolder] },
			window: {
				showErrorMessage: vi.fn().mockResolvedValue(undefined),
				showWarningMessage: vi.fn().mockResolvedValue(undefined),
				ViewColumn: { One: 1 },
				onDidCloseTerminal: vi.fn().mockReturnValue({ dispose: vi.fn() }),
				createTerminal: vi.fn().mockReturnValue({ show: vi.fn(), sendText: vi.fn(), dispose: vi.fn() }),
			},
			env: { openExternal: vi.fn() },
			Uri: { parse: vi.fn(), joinPath: vi.fn() },
			ViewColumn: { One: 1 },
			ExtensionMode: { Development: 1, Production: 2, Test: 3 },
			ThemeIcon: vi.fn(),
		}))

		vi.doMock("../../../../utils/fs", () => ({
			fileExistsAtPath: vi.fn().mockResolvedValue(false),
		}))

		vi.doMock("../../../../services/code-index/managed/git-utils", () => ({
			getRemoteUrl: vi.fn().mockResolvedValue(undefined),
		}))

		// Mock CliPathResolver to return .cmd path for Windows test
		vi.doMock("../CliPathResolver", () => ({
			findKilocodeCli: vi.fn().mockResolvedValue({ cliPath: cmdPath, shellPath: undefined }),
			findExecutable: vi.fn().mockResolvedValue(cmdPath),
		}))

		vi.doMock("node:fs", () => ({
			existsSync: vi.fn().mockReturnValue(false),
			readdirSync: vi.fn().mockReturnValue([]),
			promises: {
				stat: vi.fn().mockImplementation((filePath: string) => {
					if (filePath === cmdPath) {
						return Promise.resolve({ isFile: () => true })
					}
					return Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }))
				}),
				lstat: vi.fn().mockImplementation((filePath: string) => {
					if (filePath === cmdPath) {
						return Promise.resolve({ isFile: () => true, isSymbolicLink: () => false })
					}
					return Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }))
				}),
			},
		}))

		class TestProc extends EventEmitter {
			stdout = new EventEmitter()
			stderr = new EventEmitter()
			kill = vi.fn()
			pid = 1234
		}

		const spawnMock = vi.fn(() => new TestProc())
		vi.doMock("node:child_process", () => ({
			spawn: spawnMock,
			execSync: vi.fn().mockImplementation(() => {
				throw new Error("not found")
			}),
		}))

		const originalPath = process.env.PATH
		process.env.PATH = testNpmDir

		try {
			const module = await import("../AgentManagerProvider")
			const windowsProvider = new module.AgentManagerProvider(mockContext, mockOutputChannel, mockProvider as any)

			await (windowsProvider as any).startAgentSession("test windows cmd")

			expect(spawnMock).toHaveBeenCalledTimes(1)
			const [cmd, , options] = spawnMock.mock.calls[0] as unknown as [string, string[], Record<string, unknown>]
			expect(cmd.toLowerCase()).toContain(".cmd")
			expect(options?.shell).toBe(true)

			windowsProvider.dispose()
		} finally {
			process.env.PATH = originalPath
		}
	})

	it("creates pending session and waits for session_created event", async () => {
		await (provider as any).startAgentSession("test pending")

		// Should have a pending session
		expect((provider as any).registry.pendingSession).not.toBeNull()
		expect((provider as any).registry.pendingSession.prompt).toBe("test pending")

		// No sessions created yet
		expect((provider as any).registry.getSessions()).toHaveLength(0)
	})

	it("creates session when session_created event is received", async () => {
		await (provider as any).startAgentSession("test session created")
		const spawnMock = (await import("node:child_process")).spawn as unknown as Mock
		const proc = spawnMock.mock.results[0].value as EventEmitter & { stdout: EventEmitter }

		// Emit session_created event
		const sessionCreatedEvent = '{"event":"session_created","sessionId":"cli-session-123","timestamp":1234567890}\n'
		proc.stdout.emit("data", Buffer.from(sessionCreatedEvent))

		// Pending session should be cleared
		expect((provider as any).registry.pendingSession).toBeNull()

		// Session should be created with CLI's sessionId
		const sessions = (provider as any).registry.getSessions()
		expect(sessions).toHaveLength(1)
		expect(sessions[0].sessionId).toBe("cli-session-123")
	})

	it("shows existing terminal when selecting a session", () => {
		const sessionId = "session-terminal"
		const registry = (provider as any).registry
		registry.createSession(sessionId, "prompt")
		;(provider as any).sessionMessages.set(sessionId, [])

		const showExistingTerminal = vi.spyOn((provider as any).terminalManager, "showExistingTerminal")

		;(provider as any).selectSession(sessionId)

		expect(showExistingTerminal).toHaveBeenCalledWith(sessionId)
	})

	it("adds metadata text for tool requests and skips non chat events", async () => {
		const registry = (provider as any).registry
		const sessionId = "test-session-meta"
		registry.createSession(sessionId, "meta")
		;(provider as any).sessionMessages.set(sessionId, [])

		// Non-chat event should be logged but not added
		;(provider as any).handleKilocodeEvent(sessionId, {
			streamEventType: "kilocode",
			payload: { event: "session_created" },
		})
		expect((provider as any).sessionMessages.get(sessionId)).toEqual([])

		// Tool ask with metadata should produce text
		;(provider as any).handleKilocodeEvent(sessionId, {
			streamEventType: "kilocode",
			payload: {
				timestamp: 1,
				type: "ask",
				ask: "tool",
				metadata: { tool: "codebaseSearch", query: "main" },
			},
		})

		const messages = (provider as any).sessionMessages.get(sessionId)
		expect(messages).toHaveLength(1)
		expect(messages?.[0].text).toBe("Tool: codebaseSearch (main)")
	})

	it("adds fallback text for checkpoint_saved", async () => {
		const registry = (provider as any).registry
		const sessionId = "test-session-checkpoint"
		registry.createSession(sessionId, "checkpoint")
		;(provider as any).sessionMessages.set(sessionId, [])
		;(provider as any).handleKilocodeEvent(sessionId, {
			streamEventType: "kilocode",
			payload: {
				timestamp: 2,
				type: "say",
				say: "checkpoint_saved",
				checkpoint: { to: "abc123" },
			},
		})

		const messages = (provider as any).sessionMessages.get(sessionId)
		expect(messages).toHaveLength(1)
		expect(messages?.[0].text).toBe("")
		expect(messages?.[0].checkpoint).toEqual({ to: "abc123" })
	})

	it("dedupes repeated events with same ts/type/say/ask", async () => {
		const registry = (provider as any).registry
		const sessionId = "test-session-dedupe"
		registry.createSession(sessionId, "dedupe")
		;(provider as any).sessionMessages.set(sessionId, [])

		// Enable text handling
		;(provider as any).handleKilocodeEvent(sessionId, {
			streamEventType: "kilocode",
			payload: { type: "say", say: "api_req_started" },
		})

		const payload = {
			timestamp: 10,
			type: "say",
			say: "text",
			content: "hello",
		}

		;(provider as any).handleKilocodeEvent(sessionId, { streamEventType: "kilocode", payload })
		;(provider as any).handleKilocodeEvent(sessionId, { streamEventType: "kilocode", payload })

		const messages = (provider as any).sessionMessages.get(sessionId)
		expect(messages).toHaveLength(1)
		expect(messages?.[0].text).toBe("hello")
	})

	it("skips user echo before api_req_started", async () => {
		const registry = (provider as any).registry
		const sessionId = "test-session-echo"
		registry.createSession(sessionId, "echo")
		;(provider as any).sessionMessages.set(sessionId, [])

		// say:text before api_req_started -> skipped
		;(provider as any).handleKilocodeEvent(sessionId, {
			streamEventType: "kilocode",
			payload: {
				type: "say",
				say: "text",
				content: "user prompt",
			},
		})

		// api_req_started toggles echo filter
		;(provider as any).handleKilocodeEvent(sessionId, {
			streamEventType: "kilocode",
			payload: {
				type: "say",
				say: "api_req_started",
			},
		})

		// Now allow text
		;(provider as any).handleKilocodeEvent(sessionId, {
			streamEventType: "kilocode",
			payload: {
				type: "say",
				say: "text",
				content: "assistant reply",
			},
		})

		const messages = (provider as any).sessionMessages.get(sessionId)
		expect(messages).toHaveLength(1)
		expect(messages?.[0].text).toBe("assistant reply")
	})

	it("drops empty partial messages and allows final to overwrite partial", async () => {
		const registry = (provider as any).registry
		const sessionId = "test-session-partial"
		registry.createSession(sessionId, "partial")
		;(provider as any).sessionMessages.set(sessionId, [])

		// Enable text handling
		;(provider as any).handleKilocodeEvent(sessionId, {
			streamEventType: "kilocode",
			payload: { type: "say", say: "api_req_started" },
		})

		// Empty partial is skipped
		;(provider as any).handleKilocodeEvent(sessionId, {
			streamEventType: "kilocode",
			payload: {
				type: "say",
				say: "text",
				partial: true,
			},
		})

		// Partial with content
		;(provider as any).handleKilocodeEvent(sessionId, {
			streamEventType: "kilocode",
			payload: {
				type: "say",
				say: "text",
				partial: true,
				content: "partial",
				timestamp: 999,
			},
		})

		// Final overwrites partial
		;(provider as any).handleKilocodeEvent(sessionId, {
			streamEventType: "kilocode",
			payload: {
				type: "say",
				say: "text",
				partial: false,
				content: "final",
				timestamp: 999,
			},
		})

		const messages = (provider as any).sessionMessages.get(sessionId)
		expect(messages).toHaveLength(1)
		expect(messages?.[0].text).toBe("final")
		expect(messages?.[0].partial).toBe(false)
	})

	it("dedupes auth start failures and reuses reminder text", async () => {
		const vscode = await import("vscode")
		const warningSpy = vscode.window.showWarningMessage as unknown as Mock

		const message = "Authentication failed: API request failed."
		;(provider as any).handleStartSessionApiFailure({ message, authError: true })
		;(provider as any).handleStartSessionApiFailure({ message, authError: true })

		expect(warningSpy).toHaveBeenCalledTimes(1)
		expect(warningSpy.mock.calls[0][0]).toContain(message)
	})

	it("shows auth popup again on a new start attempt", async () => {
		const vscode = await import("vscode")
		const warningSpy = vscode.window.showWarningMessage as unknown as Mock

		// Avoid the full CLI spawn flow; we only want to exercise per-attempt dedupe reset.
		;(provider as any).startAgentSession = vi.fn().mockResolvedValue(undefined)

		const message = "Authentication failed: Provider error: 401 No cookie auth credentials found"

		;(provider as any).handleStartSessionApiFailure({ message, authError: true })
		;(provider as any).handleStartSessionApiFailure({ message, authError: true })
		expect(warningSpy).toHaveBeenCalledTimes(1)

		// New attempt should reset dedupe state
		await (provider as any).handleStartSession({ prompt: "hi", parallelMode: false })
		;(provider as any).handleStartSessionApiFailure({ message, authError: true })
		expect(warningSpy).toHaveBeenCalledTimes(2)
	})

	it("builds payment required message with parsed title and link", async () => {
		const vscode = await import("vscode")
		const warningSpy = vscode.window.showWarningMessage as unknown as Mock
		const payload = {
			text: JSON.stringify({
				title: "Low credit",
				message: "Balance too low",
				buyCreditsUrl: "https://kilo.ai/billing",
			}),
		}

		;(provider as any).showPaymentRequiredPrompt(payload)

		expect(warningSpy).toHaveBeenCalledWith(
			expect.stringContaining("Low credit: Balance too low"),
			expect.stringContaining("Open billing"),
		)
	})

	describe("parsePaymentRequiredPayload", () => {
		it("parses valid JSON payload with all fields", () => {
			const payload = {
				text: JSON.stringify({
					title: "Payment Required",
					message: "Please add credits",
					buyCreditsUrl: "https://kilo.ai/billing",
				}),
			}
			const result = (provider as any).parsePaymentRequiredPayload(payload)
			expect(result.title).toBe("Payment Required")
			expect(result.message).toBe("Please add credits")
			expect(result.buyCreditsUrl).toBe("https://kilo.ai/billing")
		})

		it("uses fallback title when not provided in JSON", () => {
			const payload = {
				text: JSON.stringify({ message: "Please add credits" }),
			}
			const result = (provider as any).parsePaymentRequiredPayload(payload)
			expect(result.title).toBeTruthy()
			expect(result.message).toBe("Please add credits")
		})

		it("uses raw text as message when JSON has no message field", () => {
			const payload = { text: "Raw error text" }
			const result = (provider as any).parsePaymentRequiredPayload(payload)
			expect(result.message).toBe("Raw error text")
		})

		it("uses content field when text is not present", () => {
			const payload = { content: "Content field message" }
			const result = (provider as any).parsePaymentRequiredPayload(payload)
			expect(result.message).toBe("Content field message")
		})

		it("returns fallback values when payload is undefined", () => {
			const result = (provider as any).parsePaymentRequiredPayload(undefined)
			expect(result.title).toBeTruthy()
			expect(result.message).toBeTruthy()
			expect(result.buyCreditsUrl).toBeUndefined()
		})

		it("handles malformed JSON gracefully", () => {
			const payload = { text: "not valid json {" }
			const result = (provider as any).parsePaymentRequiredPayload(payload)
			expect(result.message).toBe("not valid json {")
		})
	})

	describe("dispose behavior", () => {
		it("kills pending process on dispose", async () => {
			await (provider as any).startAgentSession("pending session")

			const spawnMock = (await import("node:child_process")).spawn as unknown as Mock
			const proc = spawnMock.mock.results[0].value

			const processHandler = (provider as any).processHandler
			expect(processHandler.pendingProcess).not.toBeNull()

			provider.dispose()

			expect(proc.kill).toHaveBeenCalledWith("SIGTERM")
			expect(processHandler.pendingProcess).toBeNull()
		})

		it("kills all running processes on dispose", async () => {
			// Start two sessions and simulate session_created for both
			await (provider as any).startAgentSession("session 1")
			const spawnMock = (await import("node:child_process")).spawn as unknown as Mock
			const proc1 = spawnMock.mock.results[0].value as EventEmitter & { stdout: EventEmitter; kill: Mock }
			proc1.stdout.emit("data", Buffer.from('{"event":"session_created","sessionId":"session-1"}\n'))

			await (provider as any).startAgentSession("session 2")
			const proc2 = spawnMock.mock.results[1].value as EventEmitter & { stdout: EventEmitter; kill: Mock }
			proc2.stdout.emit("data", Buffer.from('{"event":"session_created","sessionId":"session-2"}\n'))

			const processHandler = (provider as any).processHandler
			expect(processHandler.activeSessions.size).toBe(2)

			provider.dispose()

			expect(proc1.kill).toHaveBeenCalledWith("SIGTERM")
			expect(proc2.kill).toHaveBeenCalledWith("SIGTERM")
			expect(processHandler.activeSessions.size).toBe(0)
		})

		it("clears all timeouts on dispose", async () => {
			await (provider as any).startAgentSession("session with timeout")
			const spawnMock = (await import("node:child_process")).spawn as unknown as Mock
			const proc = spawnMock.mock.results[0].value as EventEmitter & { stdout: EventEmitter }
			proc.stdout.emit("data", Buffer.from('{"event":"session_created","sessionId":"session-1"}\n'))

			const processHandler = (provider as any).processHandler
			expect(processHandler.activeSessions.size).toBe(1)

			provider.dispose()

			// All active sessions (including their timeouts) should be cleared
			expect(processHandler.activeSessions.size).toBe(0)
		})
	})

	describe("hasRunningSessions", () => {
		it("returns false when no sessions exist", () => {
			expect((provider as any).hasRunningSessions()).toBe(false)
		})

		it("returns true when a session is running", async () => {
			await (provider as any).startAgentSession("running")
			const spawnMock = (await import("node:child_process")).spawn as unknown as Mock
			const proc = spawnMock.mock.results[0].value as EventEmitter & { stdout: EventEmitter }
			proc.stdout.emit("data", Buffer.from('{"event":"session_created","sessionId":"session-1"}\n'))

			expect((provider as any).hasRunningSessions()).toBe(true)
		})

		it("returns count of running sessions", async () => {
			await (provider as any).startAgentSession("running 1")
			const spawnMock = (await import("node:child_process")).spawn as unknown as Mock
			const proc1 = spawnMock.mock.results[0].value as EventEmitter & { stdout: EventEmitter }
			proc1.stdout.emit("data", Buffer.from('{"event":"session_created","sessionId":"session-1"}\n'))

			await (provider as any).startAgentSession("running 2")
			const proc2 = spawnMock.mock.results[1].value as EventEmitter & { stdout: EventEmitter }
			proc2.stdout.emit("data", Buffer.from('{"event":"session_created","sessionId":"session-2"}\n'))

			expect((provider as any).getRunningSessionCount()).toBe(2)
		})
	})
})

describe("AgentManagerProvider gitUrl filtering", () => {
	let provider: InstanceType<typeof AgentManagerProvider>
	const mockContext = { extensionUri: {}, extensionPath: "", extensionMode: 1 /* Development */ } as any
	const mockOutputChannel = { appendLine: vi.fn() } as any
	let mockGetRemoteUrl: Mock

	beforeEach(async () => {
		vi.resetModules()

		const mockWorkspaceFolder = { uri: { fsPath: "/tmp/workspace" } }
		const mockWindow = {
			showErrorMessage: () => undefined,
			ViewColumn: { One: 1 },
			onDidCloseTerminal: vi.fn().mockReturnValue({ dispose: vi.fn() }),
			createTerminal: vi.fn().mockReturnValue({ show: vi.fn(), sendText: vi.fn(), dispose: vi.fn() }),
		}
		const mockProvider = {
			getState: vi.fn().mockResolvedValue({ apiConfiguration: { apiProvider: "kilocode" } }),
		}

		vi.doMock("vscode", () => ({
			workspace: { workspaceFolders: [mockWorkspaceFolder] },
			window: mockWindow,
			env: { openExternal: vi.fn() },
			Uri: { parse: vi.fn(), joinPath: vi.fn() },
			ViewColumn: { One: 1 },
			ExtensionMode: { Development: 1, Production: 2, Test: 3 },
		}))

		// Mock CliInstaller so getLocalCliPath returns our mock path
		vi.doMock("../CliInstaller", () => ({
			getLocalCliPath: () => MOCK_CLI_PATH,
		}))

		vi.doMock("../../../../utils/fs", () => ({
			fileExistsAtPath: vi.fn().mockImplementation((p: string) => Promise.resolve(p === MOCK_CLI_PATH)),
		}))

		mockGetRemoteUrl = vi.fn().mockResolvedValue("https://github.com/org/repo.git")
		vi.doMock("../../../../services/code-index/managed/git-utils", () => ({
			getRemoteUrl: mockGetRemoteUrl,
		}))

		class TestProc extends EventEmitter {
			stdout = new EventEmitter()
			stderr = new EventEmitter()
			kill = vi.fn()
			pid = 1234
		}

		const spawnMock = vi.fn(() => new TestProc())
		const execSyncMock = vi.fn(() => MOCK_CLI_PATH)

		vi.doMock("node:child_process", () => ({
			spawn: spawnMock,
			execSync: execSyncMock,
		}))

		const module = await import("../AgentManagerProvider")
		AgentManagerProvider = module.AgentManagerProvider
		provider = new AgentManagerProvider(mockContext, mockOutputChannel, mockProvider as any)
	})

	afterEach(() => {
		provider.dispose()
	})

	it("captures gitUrl from workspace when starting a session", async () => {
		await (provider as any).startAgentSession("test prompt")

		expect(mockGetRemoteUrl).toHaveBeenCalledWith("/tmp/workspace")
	})

	it("passes gitUrl to process handler when starting session", async () => {
		const spawnProcessSpy = vi.spyOn((provider as any).processHandler, "spawnProcess")

		await (provider as any).startAgentSession("test prompt")

		expect(spawnProcessSpy).toHaveBeenCalledWith(
			expect.any(String),
			"/tmp/workspace",
			"test prompt",
			expect.objectContaining({ gitUrl: "https://github.com/org/repo.git" }),
			expect.any(Function),
		)
	})

	it("handles git URL retrieval errors gracefully", async () => {
		mockGetRemoteUrl.mockRejectedValue(new Error("No remote configured"))
		const spawnProcessSpy = vi.spyOn((provider as any).processHandler, "spawnProcess")

		await (provider as any).startAgentSession("test prompt")

		// Should still spawn process without gitUrl
		expect(spawnProcessSpy).toHaveBeenCalledWith(
			expect.any(String),
			"/tmp/workspace",
			"test prompt",
			expect.objectContaining({ gitUrl: undefined }),
			expect.any(Function),
		)
	})

	it("stores gitUrl on created session", async () => {
		await (provider as any).startAgentSession("test prompt")
		const spawnMock = (await import("node:child_process")).spawn as unknown as Mock
		const proc = spawnMock.mock.results[0].value as EventEmitter & { stdout: EventEmitter }

		// Emit session_created event
		proc.stdout.emit("data", Buffer.from('{"event":"session_created","sessionId":"session-1"}\n'))

		const sessions = (provider as any).registry.getSessions()
		expect(sessions[0].gitUrl).toBe("https://github.com/org/repo.git")
	})

	it("sets currentGitUrl on provider initialization", async () => {
		// The provider should have set the current git URL
		expect((provider as any).currentGitUrl).toBe("https://github.com/org/repo.git")
	})

	it("filters sessions by currentGitUrl when broadcasting state", async () => {
		// Create sessions with different gitUrls
		const registry = (provider as any).registry
		registry.createSession("session-1", "prompt 1", undefined, {
			gitUrl: "https://github.com/org/repo.git",
		})
		registry.createSession("session-2", "prompt 2", undefined, {
			gitUrl: "https://github.com/org/other-repo.git",
		})
		registry.createSession("session-3", "prompt 3", undefined, {
			gitUrl: "https://github.com/org/repo.git",
		})

		// Get state (which should be filtered)
		const state = (provider as any).getFilteredState()

		// Should only include sessions matching currentGitUrl
		expect(state.sessions).toHaveLength(2)
		expect(state.sessions.map((s: any) => s.sessionId)).toContain("session-1")
		expect(state.sessions.map((s: any) => s.sessionId)).toContain("session-3")
		expect(state.sessions.map((s: any) => s.sessionId)).not.toContain("session-2")
	})

	it("excludes sessions without gitUrl when filtering by gitUrl", async () => {
		const registry = (provider as any).registry
		registry.createSession("session-1", "prompt 1", undefined, {
			gitUrl: "https://github.com/org/repo.git",
		})
		registry.createSession("session-2", "prompt 2") // no gitUrl
		registry.createSession("session-3", "prompt 3", undefined, {
			gitUrl: "https://github.com/org/other-repo.git",
		})

		const state = (provider as any).getFilteredState()

		// Should only include session-1 (matches exactly)
		expect(state.sessions).toHaveLength(1)
		expect(state.sessions[0].sessionId).toBe("session-1")
	})

	it("shows only sessions without gitUrl when currentGitUrl is not set", async () => {
		;(provider as any).currentGitUrl = undefined

		const registry = (provider as any).registry
		registry.createSession("session-1", "prompt 1", undefined, {
			gitUrl: "https://github.com/org/repo1.git",
		})
		registry.createSession("session-2", "prompt 2") // no gitUrl

		const state = (provider as any).getFilteredState()

		expect(state.sessions).toHaveLength(1)
		expect(state.sessions[0].sessionId).toBe("session-2")
	})

	describe("filterRemoteSessionsByGitUrl", () => {
		it("returns only sessions with matching git_url when currentGitUrl is set", () => {
			const remoteSessions = [
				{ session_id: "1", git_url: "https://github.com/org/repo.git" },
				{ session_id: "2", git_url: "https://github.com/org/other.git" },
				{ session_id: "3", git_url: "https://github.com/org/repo.git" },
			] as any[]

			const filtered = (provider as any).filterRemoteSessionsByGitUrl(remoteSessions)

			expect(filtered).toHaveLength(2)
			expect(filtered.map((s: any) => s.session_id)).toEqual(["1", "3"])
		})

		it("excludes sessions without git_url when currentGitUrl is set", () => {
			const remoteSessions = [
				{ session_id: "1", git_url: "https://github.com/org/repo.git" },
				{ session_id: "2", git_url: undefined },
				{ session_id: "3" }, // no git_url property
			] as any[]

			const filtered = (provider as any).filterRemoteSessionsByGitUrl(remoteSessions)

			expect(filtered).toHaveLength(1)
			expect(filtered[0].session_id).toBe("1")
		})

		it("returns only sessions without git_url when currentGitUrl is undefined", () => {
			;(provider as any).currentGitUrl = undefined

			const remoteSessions = [
				{ session_id: "1", git_url: "https://github.com/org/repo.git" },
				{ session_id: "2", git_url: undefined },
				{ session_id: "3" }, // no git_url property
			] as any[]

			const filtered = (provider as any).filterRemoteSessionsByGitUrl(remoteSessions)

			expect(filtered).toHaveLength(2)
			expect(filtered.map((s: any) => s.session_id)).toEqual(["2", "3"])
		})

		it("excludes sessions with git_url when currentGitUrl is undefined", () => {
			;(provider as any).currentGitUrl = undefined

			const remoteSessions = [
				{ session_id: "1", git_url: "https://github.com/org/repo.git" },
				{ session_id: "2", git_url: "https://github.com/org/other.git" },
			] as any[]

			const filtered = (provider as any).filterRemoteSessionsByGitUrl(remoteSessions)

			expect(filtered).toHaveLength(0)
		})
	})
})

describe("AgentManagerProvider telemetry", () => {
	let provider: InstanceType<typeof AgentManagerProvider>
	const mockContext = { extensionUri: {}, extensionPath: "", extensionMode: 1 /* Development */ } as any
	const mockOutputChannel = { appendLine: vi.fn() } as any

	beforeEach(async () => {
		vi.resetModules()
		vi.clearAllMocks()

		const mockWorkspaceFolder = { uri: { fsPath: "/tmp/workspace" } }
		const mockWindow = {
			showErrorMessage: () => undefined,
			ViewColumn: { One: 1 },
			onDidCloseTerminal: vi.fn().mockReturnValue({ dispose: vi.fn() }),
			createTerminal: vi.fn().mockReturnValue({ show: vi.fn(), sendText: vi.fn(), dispose: vi.fn() }),
		}
		const mockProvider = {
			getState: vi.fn().mockResolvedValue({ apiConfiguration: { apiProvider: "kilocode" } }),
		}

		vi.doMock("vscode", () => ({
			workspace: { workspaceFolders: [mockWorkspaceFolder] },
			window: mockWindow,
			env: { openExternal: vi.fn() },
			Uri: { parse: vi.fn(), joinPath: vi.fn() },
			ViewColumn: { One: 1 },
			ExtensionMode: { Development: 1, Production: 2, Test: 3 },
		}))

		// Mock CliInstaller so getLocalCliPath returns our mock path
		vi.doMock("../CliInstaller", () => ({
			getLocalCliPath: () => MOCK_CLI_PATH,
		}))

		vi.doMock("../../../../utils/fs", () => ({
			fileExistsAtPath: vi.fn().mockImplementation((p: string) => Promise.resolve(p === MOCK_CLI_PATH)),
		}))

		vi.doMock("../../../../services/code-index/managed/git-utils", () => ({
			getRemoteUrl: vi.fn().mockResolvedValue(undefined),
		}))

		class TestProc extends EventEmitter {
			stdout = new EventEmitter()
			stderr = new EventEmitter()
			kill = vi.fn()
			pid = 1234
		}

		const spawnMock = vi.fn(() => new TestProc())
		const execSyncMock = vi.fn(() => MOCK_CLI_PATH)

		vi.doMock("node:child_process", () => ({
			spawn: spawnMock,
			execSync: execSyncMock,
		}))

		const module = await import("../AgentManagerProvider")
		AgentManagerProvider = module.AgentManagerProvider
		provider = new AgentManagerProvider(mockContext, mockOutputChannel, mockProvider as any)
	})

	afterEach(() => {
		provider.dispose()
	})

	it("tracks session started telemetry when session_created event is received", async () => {
		await (provider as any).startAgentSession("test telemetry")
		const spawnMock = (await import("node:child_process")).spawn as unknown as Mock
		const proc = spawnMock.mock.results[0].value as EventEmitter & { stdout: EventEmitter }

		// Emit session_created event
		proc.stdout.emit("data", Buffer.from('{"event":"session_created","sessionId":"session-telemetry-1"}\n'))

		expect(telemetry.captureAgentManagerSessionStarted).toHaveBeenCalledWith(
			"session-telemetry-1",
			false, // useWorktree = false (no parallel mode)
		)
	})

	it("tracks session started with worktree flag for parallel mode sessions", async () => {
		await (provider as any).startAgentSession("test parallel", { parallelMode: true })
		const spawnMock = (await import("node:child_process")).spawn as unknown as Mock
		const proc = spawnMock.mock.results[0].value as EventEmitter & { stdout: EventEmitter }

		// Emit session_created event
		proc.stdout.emit("data", Buffer.from('{"event":"session_created","sessionId":"session-parallel-1"}\n'))

		expect(telemetry.captureAgentManagerSessionStarted).toHaveBeenCalledWith(
			"session-parallel-1",
			true, // useWorktree = true (parallel mode enabled)
		)
	})

	it("tracks session completed telemetry when complete event is received", async () => {
		// Create a session directly in the registry
		const registry = (provider as any).registry
		const sessionId = "session-complete-1"
		registry.createSession(sessionId, "test complete")
		;(provider as any).sessionMessages.set(sessionId, [])

		// Handle complete event
		;(provider as any).handleCliEvent(sessionId, {
			streamEventType: "complete",
			exitCode: 0,
		})

		expect(telemetry.captureAgentManagerSessionCompleted).toHaveBeenCalledWith(
			sessionId,
			false, // useWorktree = false
		)
	})

	it("tracks session stopped telemetry when user stops a session", async () => {
		// Create a session directly in the registry
		const registry = (provider as any).registry
		const sessionId = "session-stop-1"
		registry.createSession(sessionId, "test stop")
		registry.updateSessionStatus(sessionId, "running")

		// Stop the session
		;(provider as any).stopAgentSession(sessionId)

		expect(telemetry.captureAgentManagerSessionStopped).toHaveBeenCalledWith(
			sessionId,
			false, // useWorktree = false
		)
	})

	it("tracks session stopped telemetry when interrupted event is received", async () => {
		const registry = (provider as any).registry
		const sessionId = "session-interrupted-1"
		registry.createSession(sessionId, "test interrupted")
		;(provider as any).sessionMessages.set(sessionId, [])

		// Handle interrupted event
		;(provider as any).handleCliEvent(sessionId, {
			streamEventType: "interrupted",
			reason: "User cancelled",
		})

		expect(telemetry.captureAgentManagerSessionStopped).toHaveBeenCalledWith(
			sessionId,
			false, // useWorktree = false
		)
	})

	it("tracks session error telemetry when error event is received", async () => {
		const registry = (provider as any).registry
		const sessionId = "session-error-1"
		registry.createSession(sessionId, "test error")
		;(provider as any).sessionMessages.set(sessionId, [])

		// Handle error event
		;(provider as any).handleCliEvent(sessionId, {
			streamEventType: "error",
			error: "Something went wrong",
		})

		expect(telemetry.captureAgentManagerSessionError).toHaveBeenCalledWith(
			sessionId,
			false, // useWorktree = false
			"Something went wrong",
		)
	})

	it("tracks worktree flag correctly for parallel mode sessions in completion", async () => {
		const registry = (provider as any).registry
		const sessionId = "session-parallel-complete-1"
		registry.createSession(sessionId, "test parallel complete", undefined, { parallelMode: true })
		;(provider as any).sessionMessages.set(sessionId, [])

		// Handle complete event
		;(provider as any).handleCliEvent(sessionId, {
			streamEventType: "complete",
			exitCode: 0,
		})

		expect(telemetry.captureAgentManagerSessionCompleted).toHaveBeenCalledWith(
			sessionId,
			true, // useWorktree = true (parallel mode)
		)
	})

	describe("Regression Tests - finishWorktreeSession validation (P0)", () => {
		it("should not attempt to terminate non-running worktree sessions", async () => {
			const registry = (provider as any).registry
			const sessionId = "session-done-1"
			registry.createSession(sessionId, "test done session", undefined, { parallelMode: true })
			registry.updateSessionStatus(sessionId, "done")

			const processHandler = (provider as any).processHandler
			vi.spyOn(processHandler, "terminateProcess")

			// Call finishWorktreeSession on a done session
			;(provider as any).finishWorktreeSession(sessionId)

			// Should NOT call terminateProcess
			expect(processHandler.terminateProcess).not.toHaveBeenCalled()
		})

		it("should only allow finishing running worktree sessions", async () => {
			const registry = (provider as any).registry
			const sessionId = "session-running-1"
			registry.createSession(sessionId, "test running session", undefined, { parallelMode: true })
			registry.updateSessionStatus(sessionId, "running")
			;(provider as any).sessionMessages.set(sessionId, [])

			const processHandler = (provider as any).processHandler
			vi.spyOn(processHandler, "terminateProcess")

			// Call finishWorktreeSession on a running session
			;(provider as any).finishWorktreeSession(sessionId)

			// Should call terminateProcess
			expect(processHandler.terminateProcess).toHaveBeenCalledWith(sessionId, "SIGTERM")
		})
	})
})
