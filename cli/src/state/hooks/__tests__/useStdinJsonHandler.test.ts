/**
 * Tests for useStdinJsonHandler hook
 *
 * Tests the handleStdinMessage function which handles JSON messages
 * from stdin in jsonInteractive mode.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
	handleStdinMessage,
	createQueuedStdinMessageProcessor,
	type StdinMessage,
	type StdinMessageHandlers,
	type StdinMessageQueueState,
} from "../useStdinJsonHandler.js"

describe("handleStdinMessage", () => {
	let handlers: StdinMessageHandlers
	let sendAskResponse: ReturnType<typeof vi.fn>
	let cancelTask: ReturnType<typeof vi.fn>
	let respondToTool: ReturnType<typeof vi.fn>

	beforeEach(() => {
		sendAskResponse = vi.fn().mockResolvedValue(undefined)
		cancelTask = vi.fn().mockResolvedValue(undefined)
		respondToTool = vi.fn().mockResolvedValue(undefined)

		handlers = {
			sendAskResponse,
			cancelTask,
			respondToTool,
		}
	})

	describe("askResponse messages", () => {
		it("should call sendAskResponse for messageResponse", async () => {
			const message: StdinMessage = {
				type: "askResponse",
				askResponse: "messageResponse",
				text: "hello world",
			}

			const result = await handleStdinMessage(message, handlers)

			expect(result.handled).toBe(true)
			expect(sendAskResponse).toHaveBeenCalledWith({
				response: "messageResponse",
				text: "hello world",
			})
			expect(respondToTool).not.toHaveBeenCalled()
		})

		it("should call sendAskResponse with images when provided", async () => {
			const message: StdinMessage = {
				type: "askResponse",
				askResponse: "messageResponse",
				text: "check this",
				images: ["img1.png", "img2.png"],
			}

			await handleStdinMessage(message, handlers)

			expect(sendAskResponse).toHaveBeenCalledWith({
				response: "messageResponse",
				text: "check this",
				images: ["img1.png", "img2.png"],
			})
		})

		it("should default to messageResponse when askResponse is undefined", async () => {
			const message: StdinMessage = {
				type: "askResponse",
				text: "hello",
			}

			await handleStdinMessage(message, handlers)

			expect(sendAskResponse).toHaveBeenCalledWith({
				response: "messageResponse",
				text: "hello",
			})
		})

		it("should call respondToTool for yesButtonClicked", async () => {
			const message: StdinMessage = {
				type: "askResponse",
				askResponse: "yesButtonClicked",
				text: "approved",
			}

			const result = await handleStdinMessage(message, handlers)

			expect(result.handled).toBe(true)
			expect(respondToTool).toHaveBeenCalledWith({
				response: "yesButtonClicked",
				text: "approved",
			})
			expect(sendAskResponse).not.toHaveBeenCalled()
		})

		it("should call respondToTool for noButtonClicked", async () => {
			const message: StdinMessage = {
				type: "askResponse",
				askResponse: "noButtonClicked",
				text: "rejected",
			}

			const result = await handleStdinMessage(message, handlers)

			expect(result.handled).toBe(true)
			expect(respondToTool).toHaveBeenCalledWith({
				response: "noButtonClicked",
				text: "rejected",
			})
		})

		it("should include images for yesButtonClicked", async () => {
			const message: StdinMessage = {
				type: "askResponse",
				askResponse: "yesButtonClicked",
				images: ["screenshot.png"],
			}

			await handleStdinMessage(message, handlers)

			expect(respondToTool).toHaveBeenCalledWith({
				response: "yesButtonClicked",
				images: ["screenshot.png"],
			})
		})
	})

	describe("cancelTask messages", () => {
		it("should call cancelTask handler", async () => {
			const message: StdinMessage = {
				type: "cancelTask",
			}

			const result = await handleStdinMessage(message, handlers)

			expect(result.handled).toBe(true)
			expect(cancelTask).toHaveBeenCalled()
			expect(sendAskResponse).not.toHaveBeenCalled()
			expect(respondToTool).not.toHaveBeenCalled()
		})
	})

	describe("respondToApproval messages", () => {
		it("should call respondToTool with yesButtonClicked when approved is true", async () => {
			const message: StdinMessage = {
				type: "respondToApproval",
				approved: true,
			}

			const result = await handleStdinMessage(message, handlers)

			expect(result.handled).toBe(true)
			expect(respondToTool).toHaveBeenCalledWith({
				response: "yesButtonClicked",
			})
		})

		it("should call respondToTool with noButtonClicked when approved is false", async () => {
			const message: StdinMessage = {
				type: "respondToApproval",
				approved: false,
			}

			const result = await handleStdinMessage(message, handlers)

			expect(result.handled).toBe(true)
			expect(respondToTool).toHaveBeenCalledWith({
				response: "noButtonClicked",
			})
		})

		it("should include text when provided with approval", async () => {
			const message: StdinMessage = {
				type: "respondToApproval",
				approved: true,
				text: "go ahead",
			}

			await handleStdinMessage(message, handlers)

			expect(respondToTool).toHaveBeenCalledWith({
				response: "yesButtonClicked",
				text: "go ahead",
			})
		})

		it("should include text when rejecting", async () => {
			const message: StdinMessage = {
				type: "respondToApproval",
				approved: false,
				text: "not allowed",
			}

			await handleStdinMessage(message, handlers)

			expect(respondToTool).toHaveBeenCalledWith({
				response: "noButtonClicked",
				text: "not allowed",
			})
		})
	})

	describe("unknown message types", () => {
		it("should return handled: false for unknown types", async () => {
			const message: StdinMessage = {
				type: "unknownType",
			}

			const result = await handleStdinMessage(message, handlers)

			expect(result.handled).toBe(false)
			expect(result.error).toBe("Unknown message type: unknownType")
			expect(sendAskResponse).not.toHaveBeenCalled()
			expect(cancelTask).not.toHaveBeenCalled()
			expect(respondToTool).not.toHaveBeenCalled()
		})
	})

	describe("optional fields", () => {
		it("should not include text when undefined", async () => {
			const message: StdinMessage = {
				type: "askResponse",
				askResponse: "messageResponse",
			}

			await handleStdinMessage(message, handlers)

			expect(sendAskResponse).toHaveBeenCalledWith({
				response: "messageResponse",
			})
			// Verify text is not in the call
			const call = sendAskResponse.mock.calls[0][0]
			expect("text" in call).toBe(false)
		})

		it("should not include images when undefined", async () => {
			const message: StdinMessage = {
				type: "askResponse",
				askResponse: "messageResponse",
				text: "hello",
			}

			await handleStdinMessage(message, handlers)

			const call = sendAskResponse.mock.calls[0][0]
			expect("images" in call).toBe(false)
		})
	})
})

describe("createQueuedStdinMessageProcessor", () => {
	let state: StdinMessageQueueState
	let handlers: StdinMessageHandlers
	let sendAskResponse: ReturnType<typeof vi.fn>
	let cancelTask: ReturnType<typeof vi.fn>
	let respondToTool: ReturnType<typeof vi.fn>

	beforeEach(() => {
		vi.useFakeTimers()

		state = {
			isServiceReady: false,
			isStreaming: false,
			isApprovalPending: false,
			followupAskTs: null,
		}

		sendAskResponse = vi.fn().mockResolvedValue(undefined)
		cancelTask = vi.fn().mockResolvedValue(undefined)
		respondToTool = vi.fn().mockResolvedValue(undefined)

		handlers = {
			sendAskResponse,
			cancelTask,
			respondToTool,
		}
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it("should not deliver messageResponse until service is ready", async () => {
		const processor = createQueuedStdinMessageProcessor({
			getState: () => state,
			handlers,
			options: { pollIntervalMs: 1, reactionStartTimeoutMs: 1, reactionDoneTimeoutMs: 1 },
		})

		processor.enqueue({ type: "askResponse", askResponse: "messageResponse", text: "hello" })
		await vi.runAllTimersAsync()
		expect(sendAskResponse).not.toHaveBeenCalled()

		state.isServiceReady = true
		processor.notify()
		await vi.runAllTimersAsync()

		expect(sendAskResponse).toHaveBeenCalledWith({ response: "messageResponse", text: "hello" })
		processor.dispose()
	})

	it("should not deliver messageResponse while streaming", async () => {
		state.isServiceReady = true
		state.isStreaming = true

		const processor = createQueuedStdinMessageProcessor({
			getState: () => state,
			handlers,
			options: { pollIntervalMs: 1, reactionStartTimeoutMs: 1, reactionDoneTimeoutMs: 1 },
		})

		processor.enqueue({ type: "askResponse", askResponse: "messageResponse", text: "hello" })
		await vi.runAllTimersAsync()
		expect(sendAskResponse).not.toHaveBeenCalled()

		state.isStreaming = false
		processor.notify()
		await vi.runAllTimersAsync()

		expect(sendAskResponse).toHaveBeenCalledWith({ response: "messageResponse", text: "hello" })
		processor.dispose()
	})

	it("should wait for pending approval before responding", async () => {
		state.isServiceReady = true

		const processor = createQueuedStdinMessageProcessor({
			getState: () => state,
			handlers,
			options: { pollIntervalMs: 1, reactionStartTimeoutMs: 1, reactionDoneTimeoutMs: 1 },
		})

		processor.enqueue({ type: "respondToApproval", approved: true })
		await vi.runAllTimersAsync()
		expect(respondToTool).not.toHaveBeenCalled()

		state.isApprovalPending = true
		processor.notify()
		await vi.runAllTimersAsync()

		expect(respondToTool).toHaveBeenCalledWith({ response: "yesButtonClicked" })
		processor.dispose()
	})

	it("should apply backpressure and deliver queued messages one at a time", async () => {
		state.isServiceReady = true

		sendAskResponse.mockImplementation(async () => {
			setTimeout(() => {
				state.isStreaming = true
			}, 5)
			setTimeout(() => {
				state.isStreaming = false
			}, 10)
		})

		const processor = createQueuedStdinMessageProcessor({
			getState: () => state,
			handlers,
			options: { pollIntervalMs: 1, reactionStartTimeoutMs: 100, reactionDoneTimeoutMs: 100 },
		})

		processor.enqueue({ type: "askResponse", askResponse: "messageResponse", text: "first" })
		processor.enqueue({ type: "askResponse", askResponse: "messageResponse", text: "second" })

		// Allow microtask-scheduled drain to start.
		await Promise.resolve()

		// Allow the first send to happen.
		await vi.advanceTimersByTimeAsync(1)
		expect(sendAskResponse).toHaveBeenCalledTimes(1)
		expect(sendAskResponse).toHaveBeenCalledWith({ response: "messageResponse", text: "first" })

		// Still waiting for the streaming cycle to complete.
		await vi.advanceTimersByTimeAsync(8)
		expect(sendAskResponse).toHaveBeenCalledTimes(1)

		// After the cycle completes, the second message can be delivered.
		await vi.advanceTimersByTimeAsync(100)
		expect(sendAskResponse).toHaveBeenCalledTimes(2)
		expect(sendAskResponse).toHaveBeenNthCalledWith(2, { response: "messageResponse", text: "second" })

		processor.dispose()
	})

	it("should clear queued messages and not deliver them later", async () => {
		const processor = createQueuedStdinMessageProcessor({
			getState: () => state,
			handlers,
			options: { pollIntervalMs: 1, reactionStartTimeoutMs: 1, reactionDoneTimeoutMs: 1 },
		})

		processor.enqueue({ type: "askResponse", askResponse: "messageResponse", text: "hello" })
		processor.clear()

		state.isServiceReady = true
		processor.notify()
		await vi.runAllTimersAsync()

		expect(sendAskResponse).not.toHaveBeenCalled()
		processor.dispose()
	})

	it("should drop messageResponse enqueued before a followup question and not block later answers", async () => {
		state.isServiceReady = true

		const processor = createQueuedStdinMessageProcessor({
			getState: () => state,
			handlers,
			options: { pollIntervalMs: 1, reactionStartTimeoutMs: 1, reactionDoneTimeoutMs: 1 },
		})

		vi.setSystemTime(1)
		processor.enqueue({ type: "askResponse", askResponse: "messageResponse", text: "queued-before-followup" })
		state.followupAskTs = 10_000
		processor.notify()

		vi.setSystemTime(20_000)
		processor.enqueue({ type: "askResponse", askResponse: "messageResponse", text: "answer" })
		processor.notify()
		await vi.runAllTimersAsync()

		expect(sendAskResponse).toHaveBeenCalledTimes(1)
		expect(sendAskResponse).toHaveBeenCalledWith({ response: "messageResponse", text: "answer" })

		processor.dispose()
	})

	it("should allow answering a followup question with a message enqueued after it was asked", async () => {
		state.isServiceReady = true
		state.followupAskTs = 10_000

		const processor = createQueuedStdinMessageProcessor({
			getState: () => state,
			handlers,
			options: { pollIntervalMs: 1, reactionStartTimeoutMs: 1, reactionDoneTimeoutMs: 1 },
		})

		vi.setSystemTime(20_000)
		processor.enqueue({ type: "askResponse", askResponse: "messageResponse", text: "answer" })
		await vi.runAllTimersAsync()

		expect(sendAskResponse).toHaveBeenCalledWith({ response: "messageResponse", text: "answer" })
		processor.dispose()
	})
})
