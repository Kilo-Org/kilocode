import { describe, it, expect, vi } from "vitest"
import type { ChildProcess } from "node:child_process"
import { RuntimeProcessHandler, type RuntimeProcessHandlerCallbacks } from "../RuntimeProcessHandler"
import { AgentRegistry } from "../AgentRegistry"
import type { StreamEvent } from "../CliOutputParser"

type TestableRuntimeProcessHandler = {
	activeSessions: Map<string, { process: ChildProcess; sessionId: string }>
	handleExtensionMessage: (
		proc: ChildProcess,
		payload: unknown,
		onEvent: (sessionId: string, event: StreamEvent) => void,
	) => void
}

function createCallbacks(): RuntimeProcessHandlerCallbacks {
	return {
		onLog: vi.fn(),
		onSessionLog: vi.fn(),
		onStateChanged: vi.fn(),
		onPendingSessionChanged: vi.fn(),
		onStartSessionFailed: vi.fn(),
		onChatMessages: vi.fn(),
		onSessionCreated: vi.fn(),
	}
}

describe("RuntimeProcessHandler completion state emission", () => {
	it("emits synthetic completion state event from extension state messages", () => {
		const registry = new AgentRegistry()
		const callbacks = createCallbacks()
		const handler = new RuntimeProcessHandler(registry, callbacks)
		const testableHandler = handler as unknown as TestableRuntimeProcessHandler
		const sessionId = "session-complete"
		const proc = {} as ChildProcess
		const onEvent = vi.fn<(sessionId: string, event: StreamEvent) => void>()

		registry.createSession(sessionId, "prompt")
		testableHandler.activeSessions.set(sessionId, { process: proc, sessionId })
		testableHandler.handleExtensionMessage(
			proc,
			{
				type: "state",
				state: {
					clineMessages: [
						{ ts: 1000, type: "say", say: "text", text: "Working" },
						{ ts: 1001, type: "ask", ask: "completion_result", text: "Done" },
					],
				},
			},
			onEvent,
		)

		expect(onEvent).toHaveBeenCalledWith(
			sessionId,
			expect.objectContaining({
				streamEventType: "kilocode",
				payload: expect.objectContaining({
					type: "ask",
					ask: "completion_result",
				}),
			}),
		)
		expect(callbacks.onChatMessages).toHaveBeenCalledWith(sessionId, [
			expect.objectContaining({ ts: 1000, type: "say", say: "text" }),
		])
	})

	it("does not emit duplicate completion event for unchanged state snapshots", () => {
		const registry = new AgentRegistry()
		const callbacks = createCallbacks()
		const handler = new RuntimeProcessHandler(registry, callbacks)
		const testableHandler = handler as unknown as TestableRuntimeProcessHandler
		const sessionId = "session-complete-dup"
		const proc = {} as ChildProcess
		const onEvent = vi.fn<(sessionId: string, event: StreamEvent) => void>()

		registry.createSession(sessionId, "prompt")
		testableHandler.activeSessions.set(sessionId, { process: proc, sessionId })

		const stateMessage = {
			type: "state",
			state: {
				clineMessages: [
					{ ts: 1000, type: "say", say: "text", text: "Working" },
					{ ts: 1001, type: "say", say: "completion_result", text: "Done" },
				],
			},
		}

		testableHandler.handleExtensionMessage(proc, stateMessage, onEvent)
		testableHandler.handleExtensionMessage(proc, stateMessage, onEvent)

		const completionCalls = onEvent.mock.calls.filter(
			([, event]) =>
				event.streamEventType === "kilocode" &&
				(event as { payload?: { type?: string; ask?: string } }).payload?.type === "ask" &&
				(event as { payload?: { type?: string; ask?: string } }).payload?.ask === "completion_result",
		)
		expect(completionCalls).toHaveLength(1)
	})
})
