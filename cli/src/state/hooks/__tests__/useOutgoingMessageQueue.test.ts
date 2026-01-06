import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
	createQueuedOutgoingMessageProcessor,
	type OutgoingMessageHandlers,
	type OutgoingMessageQueueState,
	type OutgoingUserMessage,
} from "../useOutgoingMessageQueue.js"

describe("createQueuedOutgoingMessageProcessor", () => {
	let state: OutgoingMessageQueueState
	let handlers: OutgoingMessageHandlers
	let sendNewTask: ReturnType<typeof vi.fn>
	let sendAskResponse: ReturnType<typeof vi.fn>

	beforeEach(() => {
		vi.useFakeTimers()

		state = {
			isServiceReady: false,
			isStreaming: false,
			isApprovalPending: false,
			hasActiveTask: false,
		}

		sendNewTask = vi.fn().mockResolvedValue(undefined)
		sendAskResponse = vi.fn().mockResolvedValue(undefined)

		handlers = {
			sendNewTask,
			sendAskResponse,
		}
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	const msg = (text: string): OutgoingUserMessage => ({
		id: `m-${text}`,
		text,
		enqueuedAt: Date.now(),
	})

	it("should not deliver until service is ready and not streaming/approval pending", async () => {
		const processor = createQueuedOutgoingMessageProcessor({
			getState: () => state,
			handlers,
			options: { pollIntervalMs: 1, reactionStartTimeoutMs: 1, reactionDoneTimeoutMs: 1 },
		})

		processor.enqueue(msg("hello"))
		await vi.runAllTimersAsync()
		expect(sendNewTask).not.toHaveBeenCalled()

		state.isServiceReady = true
		state.isStreaming = true
		processor.notify()
		await vi.runAllTimersAsync()
		expect(sendNewTask).not.toHaveBeenCalled()

		state.isStreaming = false
		state.isApprovalPending = true
		processor.notify()
		await vi.runAllTimersAsync()
		expect(sendNewTask).not.toHaveBeenCalled()

		state.isApprovalPending = false
		processor.notify()
		await vi.runAllTimersAsync()

		expect(sendNewTask).toHaveBeenCalledWith({ text: "hello" })
		processor.dispose()
	})

	it("should send as askResponse when a task is active", async () => {
		state.isServiceReady = true
		state.hasActiveTask = true

		const processor = createQueuedOutgoingMessageProcessor({
			getState: () => state,
			handlers,
			options: { pollIntervalMs: 1, reactionStartTimeoutMs: 1, reactionDoneTimeoutMs: 1 },
		})

		processor.enqueue(msg("followup"))
		await vi.runAllTimersAsync()

		expect(sendAskResponse).toHaveBeenCalledWith({ response: "messageResponse", text: "followup" })
		expect(sendNewTask).not.toHaveBeenCalled()
		processor.dispose()
	})

	it("should apply backpressure and deliver queued messages one at a time", async () => {
		state.isServiceReady = true

		sendNewTask.mockImplementation(async () => {
			setTimeout(() => {
				state.isStreaming = true
			}, 5)
			setTimeout(() => {
				state.isStreaming = false
			}, 10)
		})

		const processor = createQueuedOutgoingMessageProcessor({
			getState: () => state,
			handlers,
			options: { pollIntervalMs: 1, reactionStartTimeoutMs: 100, reactionDoneTimeoutMs: 100 },
		})

		processor.enqueue(msg("first"))
		processor.enqueue(msg("second"))

		await Promise.resolve()
		await vi.advanceTimersByTimeAsync(1)
		expect(sendNewTask).toHaveBeenCalledTimes(1)
		expect(sendNewTask).toHaveBeenCalledWith({ text: "first" })

		// Not yet completed the streaming cycle.
		await vi.advanceTimersByTimeAsync(8)
		expect(sendNewTask).toHaveBeenCalledTimes(1)

		// After completion, second can be delivered.
		await vi.advanceTimersByTimeAsync(100)
		expect(sendNewTask).toHaveBeenCalledTimes(2)
		expect(sendNewTask).toHaveBeenNthCalledWith(2, { text: "second" })

		processor.dispose()
	})

	it("should invoke onDelivered callback when sent", async () => {
		state.isServiceReady = true
		const onDelivered = vi.fn()

		const processor = createQueuedOutgoingMessageProcessor({
			getState: () => state,
			handlers,
			callbacks: { onDelivered },
			options: { pollIntervalMs: 1, reactionStartTimeoutMs: 1, reactionDoneTimeoutMs: 1 },
		})

		processor.enqueue(msg("hello"))
		await vi.runAllTimersAsync()

		expect(onDelivered).toHaveBeenCalledWith("m-hello")
		processor.dispose()
	})

	it("should clear queued messages and not deliver them later", async () => {
		const processor = createQueuedOutgoingMessageProcessor({
			getState: () => state,
			handlers,
			options: { pollIntervalMs: 1, reactionStartTimeoutMs: 1, reactionDoneTimeoutMs: 1 },
		})

		processor.enqueue(msg("hello"))
		processor.clear()

		state.isServiceReady = true
		processor.notify()
		await vi.runAllTimersAsync()

		expect(sendNewTask).not.toHaveBeenCalled()
		processor.dispose()
	})
})
