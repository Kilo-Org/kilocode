import { describe, it, expect, vi, beforeEach } from "vitest"
import { KiloCodeAgent, createKiloCodeAgent } from "../agent.js"
import type { AgentSideConnection, InitializeRequest, NewSessionRequest, PromptRequest } from "@agentclientprotocol/sdk"
import type { ExtensionService } from "../../services/extension.js"
import { EventEmitter } from "events"

// Mock AgentSideConnection
function createMockConnection(): AgentSideConnection {
	return {
		sessionUpdate: vi.fn().mockResolvedValue(undefined),
		requestPermission: vi.fn().mockResolvedValue({
			outcome: { outcome: "selected", optionId: "allow" },
		}),
		readTextFile: vi.fn(),
		writeTextFile: vi.fn(),
		createTerminal: vi.fn(),
		extMethod: vi.fn(),
		extNotification: vi.fn(),
		signal: new AbortController().signal,
		closed: new Promise(() => {}), // Never resolves in tests
	} as unknown as AgentSideConnection
}

// Mock ExtensionService
function createMockExtensionService(): ExtensionService & { _emitter: EventEmitter } {
	const emitter = new EventEmitter()
	const mockExtensionHost = {
		sendWebviewMessage: vi.fn().mockResolvedValue(undefined),
	}
	const service = {
		on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
			emitter.on(event, handler)
			return service
		}),
		off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
			emitter.off(event, handler)
			return service
		}),
		emit: vi.fn((event: string, ...args: unknown[]) => emitter.emit(event, ...args)),
		sendWebviewMessage: vi.fn().mockResolvedValue(undefined),
		initialize: vi.fn().mockResolvedValue(undefined),
		dispose: vi.fn().mockResolvedValue(undefined),
		getState: vi.fn(() => null),
		isReady: vi.fn(() => true),
		getExtensionHost: vi.fn(() => mockExtensionHost),
		// Expose emitter for testing
		_emitter: emitter,
	}
	return service as unknown as ExtensionService & { _emitter: EventEmitter }
}

// Helper to create valid NewSessionRequest
function createNewSessionRequest(overrides: Partial<NewSessionRequest> = {}): NewSessionRequest {
	return {
		cwd: "/test/workspace",
		mcpServers: [],
		...overrides,
	}
}

describe("KiloCodeAgent", () => {
	let agent: KiloCodeAgent
	let mockConnection: AgentSideConnection
	let mockExtensionService: ExtensionService & { _emitter: EventEmitter }
	let createExtensionService: (workspace: string) => Promise<ExtensionService>

	beforeEach(() => {
		mockConnection = createMockConnection()
		mockExtensionService = createMockExtensionService()
		createExtensionService = vi.fn().mockResolvedValue(mockExtensionService)
		agent = new KiloCodeAgent(mockConnection, createExtensionService, "/test/workspace")
	})

	describe("initialize", () => {
		it("should return protocol version and agent info", async () => {
			const params: InitializeRequest = {
				protocolVersion: 1,
				clientInfo: {
					name: "Test Client",
					version: "1.0.0",
				},
			}

			const response = await agent.initialize(params)

			expect(response.protocolVersion).toBe(1)
			expect(response.agentInfo).toEqual({
				name: "Kilo Code",
				version: "1.0.0",
			})
			expect(response.agentCapabilities).toEqual({
				promptCapabilities: {
					image: false,
					embeddedContext: true,
				},
			})
		})
	})

	describe("newSession", () => {
		it("should create a new session with a unique ID", async () => {
			const params = createNewSessionRequest()

			const response = await agent.newSession(params)

			expect(response.sessionId).toMatch(/^kilo-\d+-[a-z0-9]+$/)
			expect(createExtensionService).toHaveBeenCalledWith("/test/workspace")
		})

		it("should create different session IDs for each call", async () => {
			const response1 = await agent.newSession(createNewSessionRequest())
			const response2 = await agent.newSession(createNewSessionRequest())

			expect(response1.sessionId).not.toBe(response2.sessionId)
		})
	})

	describe("prompt", () => {
		it("should throw error for unknown session", async () => {
			const params: PromptRequest = {
				sessionId: "unknown-session",
				prompt: [{ type: "text", text: "Hello" }],
			}

			await expect(agent.prompt(params)).rejects.toThrow("Session not found: unknown-session")
		})

		it("should extract text from prompt content blocks", async () => {
			const { sessionId } = await agent.newSession(createNewSessionRequest())

			// Start the prompt (but don't await it yet)
			const promptPromise = agent.prompt({
				sessionId,
				prompt: [
					{ type: "text", text: "Hello " },
					{ type: "text", text: "World" },
				],
			})

			// Simulate task completion
			mockExtensionService._emitter.emit("message", {
				say: "completion_result",
			})

			const response = await promptPromise

			expect(mockExtensionService.sendWebviewMessage).toHaveBeenCalledWith({
				type: "newTask",
				text: "Hello \nWorld",
			})
			expect(response.stopReason).toBe("end_turn")
		})

		it("should return cancelled stop reason when session is cancelled", async () => {
			const { sessionId } = await agent.newSession(createNewSessionRequest())

			// Start prompt
			const promptPromise = agent.prompt({
				sessionId,
				prompt: [{ type: "text", text: "Test" }],
			})

			// Cancel the session
			await agent.cancel({ sessionId })

			const response = await promptPromise

			expect(response.stopReason).toBe("cancelled")
		})
	})

	describe("cancel", () => {
		it("should cancel an active session", async () => {
			const { sessionId } = await agent.newSession(createNewSessionRequest())

			// Should not throw
			await expect(agent.cancel({ sessionId })).resolves.not.toThrow()
		})

		it("should handle cancelling unknown session gracefully", async () => {
			// Should not throw even for unknown session
			await expect(agent.cancel({ sessionId: "unknown" })).resolves.not.toThrow()
		})
	})

	describe("authenticate", () => {
		it("should return empty response (no-op)", async () => {
			const response = await agent.authenticate({ methodId: "test" })
			expect(response).toEqual({})
		})
	})

	describe("setSessionMode", () => {
		it("should send mode change message to extension", async () => {
			const { sessionId } = await agent.newSession(createNewSessionRequest())

			await agent.setSessionMode({ sessionId, modeId: "architect" })

			expect(mockExtensionService.sendWebviewMessage).toHaveBeenCalledWith({
				type: "mode",
				text: "architect",
			})
		})

		it("should throw for unknown session", async () => {
			await expect(agent.setSessionMode({ sessionId: "unknown", modeId: "code" })).rejects.toThrow(
				"Session not found: unknown",
			)
		})
	})
})

describe("createKiloCodeAgent", () => {
	it("should return a factory function", () => {
		const createExtensionService = vi.fn()
		const factory = createKiloCodeAgent(createExtensionService, "/test/workspace")

		expect(typeof factory).toBe("function")
	})

	it("should create a KiloCodeAgent when factory is called", () => {
		const createExtensionService = vi.fn()
		const factory = createKiloCodeAgent(createExtensionService, "/test/workspace")
		const mockConnection = createMockConnection()

		const agent = factory(mockConnection)

		expect(agent).toBeInstanceOf(KiloCodeAgent)
	})
})
