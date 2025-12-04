import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest"
import { EventEmitter } from "node:events"

const MOCK_CLI_PATH = "/mock/path/to/kilocode"

let AgentManagerProvider: typeof import("../AgentManagerProvider").AgentManagerProvider

describe("AgentManagerProvider CLI spawning", () => {
	let provider: InstanceType<typeof AgentManagerProvider>
	const mockContext = { extensionUri: {}, extensionPath: "" } as any
	const mockOutputChannel = { appendLine: vi.fn() } as any

	beforeEach(async () => {
		vi.resetModules()

		const mockWorkspaceFolder = { uri: { fsPath: "/tmp/workspace" } }
		const mockWindow = { showErrorMessage: () => undefined, ViewColumn: { One: 1 } }

		vi.doMock("vscode", () => ({
			workspace: { workspaceFolders: [mockWorkspaceFolder] },
			window: mockWindow,
			env: { openExternal: vi.fn() },
			Uri: { parse: vi.fn(), joinPath: vi.fn() },
			ViewColumn: { One: 1 },
		}))

		vi.doMock("../../../../utils/fs", () => ({
			fileExistsAtPath: vi.fn().mockResolvedValue(false),
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
		provider = new AgentManagerProvider(mockContext, mockOutputChannel)
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

	it("flushes buffered CLI output on process exit", async () => {
		await (provider as any).startAgentSession("test flush")
		const spawnMock = (await import("node:child_process")).spawn as unknown as Mock
		const proc = spawnMock.mock.results[0].value as EventEmitter & { stdout: EventEmitter }

		// Enable text handling
		const sessionId = (provider as any).registry.getSessions()[0].id as string
		;(provider as any).handleKilocodeEvent(sessionId, {
			streamEventType: "kilocode",
			payload: { type: "say", say: "api_req_started" },
		})

		// Emit a JSON line without trailing newline to stay buffered
		const partial = '{"timestamp":1,"source":"extension","type":"say","say":"text","content":"hi"}'
		proc.stdout.emit("data", Buffer.from(partial))

		// No messages yet because the line lacked a newline
		expect((provider as any).sessionMessages.get(sessionId)).toEqual([])

		// Exit should flush the buffered line and deliver the message
		proc.emit("exit", 0, null)

		const messages = (provider as any).sessionMessages.get(sessionId)
		expect(messages).toHaveLength(1)
		expect(messages?.[0].text).toBe("hi")
	})

	it("adds metadata text for tool requests and skips non chat events", async () => {
		const registry = (provider as any).registry
		const sessionId = registry.createSession("meta").id
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
		const sessionId = registry.createSession("checkpoint").id
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
		const sessionId = registry.createSession("dedupe").id
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
		const sessionId = registry.createSession("echo").id
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
		const sessionId = registry.createSession("partial").id
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

	describe("dispose behavior", () => {
		it("kills all running processes on dispose", async () => {
			await (provider as any).startAgentSession("session 1")
			await (provider as any).startAgentSession("session 2")

			const spawnMock = (await import("node:child_process")).spawn as unknown as Mock
			const proc1 = spawnMock.mock.results[0].value
			const proc2 = spawnMock.mock.results[1].value

			expect((provider as any).processes.size).toBe(2)

			provider.dispose()

			expect(proc1.kill).toHaveBeenCalledWith("SIGTERM")
			expect(proc2.kill).toHaveBeenCalledWith("SIGTERM")
			expect((provider as any).processes.size).toBe(0)
		})

		it("clears all timeouts on dispose", async () => {
			await (provider as any).startAgentSession("session with timeout")

			expect((provider as any).timeouts.size).toBe(1)

			provider.dispose()

			expect((provider as any).timeouts.size).toBe(0)
		})
	})

	describe("hasRunningSessions", () => {
		it("returns false when no sessions exist", () => {
			expect((provider as any).hasRunningSessions()).toBe(false)
		})

		it("returns true when a session is running", async () => {
			await (provider as any).startAgentSession("running")
			expect((provider as any).hasRunningSessions()).toBe(true)
		})

		it("returns count of running sessions", async () => {
			await (provider as any).startAgentSession("running 1")
			await (provider as any).startAgentSession("running 2")
			expect((provider as any).getRunningSessionCount()).toBe(2)
		})
	})
})