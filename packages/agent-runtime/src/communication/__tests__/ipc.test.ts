import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { IPCChannel, MessageBridge, createMessageBridge } from "../ipc.js"

describe("IPCChannel", () => {
	let channel: IPCChannel

	beforeEach(() => {
		channel = new IPCChannel({ timeout: 100 })
	})

	afterEach(() => {
		channel.dispose()
	})

	describe("request/response", () => {
		it("should resolve when response is received", async () => {
			const responseData = { result: "success" }

			// Listen for the request and respond
			channel.on("message", (message) => {
				if (message.type === "request") {
					channel.handleMessage({
						id: message.id,
						type: "response",
						data: responseData,
						ts: Date.now(),
					})
				}
			})

			const result = await channel.request({ action: "test" })
			expect(result).toEqual(responseData)
		})

		it("should timeout if no response received", async () => {
			await expect(channel.request({ action: "test" })).rejects.toThrow("IPC request timeout after 100ms")
		})

		it("should generate unique message IDs", () => {
			const ids = new Set<string>()

			channel.on("message", (message) => {
				ids.add(message.id)
			})

			channel.event({ a: 1 })
			channel.event({ b: 2 })
			channel.event({ c: 3 })

			expect(ids.size).toBe(3)
		})
	})

	describe("events", () => {
		it("should emit event messages", () => {
			const handler = vi.fn()
			channel.on("event", handler)

			channel.event({ type: "test" })

			expect(handler).toHaveBeenCalledTimes(1)
			expect(handler.mock.calls[0][0].data).toEqual({ type: "test" })
		})

		it("should emit both message and event for events", () => {
			const messageHandler = vi.fn()
			const eventHandler = vi.fn()

			channel.on("message", messageHandler)
			channel.on("event", eventHandler)

			channel.event({ test: true })

			expect(messageHandler).toHaveBeenCalledTimes(1)
			expect(eventHandler).toHaveBeenCalledTimes(1)
		})
	})

	describe("handleMessage", () => {
		it("should emit request event for request messages", () => {
			const handler = vi.fn()
			channel.on("request", handler)

			channel.handleMessage({
				id: "test-1",
				type: "request",
				data: { action: "doSomething" },
				ts: Date.now(),
			})

			expect(handler).toHaveBeenCalledTimes(1)
		})

		it("should emit event for event messages", () => {
			const handler = vi.fn()
			channel.on("event", handler)

			channel.handleMessage({
				id: "test-1",
				type: "event",
				data: { notification: "hello" },
				ts: Date.now(),
			})

			expect(handler).toHaveBeenCalledTimes(1)
		})
	})

	describe("dispose", () => {
		it("should reject pending requests on dispose", async () => {
			const requestPromise = channel.request({ action: "test" })

			channel.dispose()

			await expect(requestPromise).rejects.toThrow("IPC channel disposed")
		})

		it("should remove all listeners on dispose", () => {
			channel.on("message", vi.fn())
			channel.on("event", vi.fn())

			expect(channel.listenerCount("message")).toBe(1)
			expect(channel.listenerCount("event")).toBe(1)

			channel.dispose()

			expect(channel.listenerCount("message")).toBe(0)
			expect(channel.listenerCount("event")).toBe(0)
		})
	})
})

describe("MessageBridge", () => {
	let bridge: MessageBridge

	beforeEach(() => {
		bridge = createMessageBridge({ timeout: 100 })
	})

	afterEach(() => {
		bridge.dispose()
	})

	it("should create TUI and Extension channels", () => {
		expect(bridge.getTUIChannel()).toBeInstanceOf(IPCChannel)
		expect(bridge.getExtensionChannel()).toBeInstanceOf(IPCChannel)
	})

	it("should route messages from TUI to Extension", async () => {
		const tuiChannel = bridge.getTUIChannel()
		const extChannel = bridge.getExtensionChannel()

		// Extension side listens for requests
		extChannel.on("request", (message) => {
			extChannel.respond(message.id, { handled: true })
		})

		const result = await tuiChannel.request({ action: "fromTUI" })
		expect(result).toEqual({ handled: true })
	})

	it("should route messages from Extension to TUI", async () => {
		const tuiChannel = bridge.getTUIChannel()
		const extChannel = bridge.getExtensionChannel()

		// TUI side listens for requests
		tuiChannel.on("request", (message) => {
			tuiChannel.respond(message.id, { handled: true })
		})

		const result = await extChannel.request({ action: "fromExtension" })
		expect(result).toEqual({ handled: true })
	})

	it("should emit extensionRequest when TUI sends request (routed to extension)", () => {
		const handler = vi.fn()
		bridge.on("extensionRequest", handler)

		bridge.getTUIChannel().request({ test: true }).catch(() => {
			// Ignore timeout
		})

		// TUI sends -> routes to extension -> extension emits "request" -> bridge emits "extensionRequest"
		expect(handler).toHaveBeenCalledTimes(1)
	})

	it("should emit tuiRequest when Extension sends request (routed to TUI)", () => {
		const handler = vi.fn()
		bridge.on("tuiRequest", handler)

		bridge.getExtensionChannel().request({ test: true }).catch(() => {
			// Ignore timeout
		})

		// Extension sends -> routes to TUI -> TUI emits "request" -> bridge emits "tuiRequest"
		expect(handler).toHaveBeenCalledTimes(1)
	})

	it("should emit tuiEvent when TUI sends event", () => {
		const handler = vi.fn()
		bridge.on("tuiEvent", handler)

		bridge.getTUIChannel().event({ notification: "test" })

		expect(handler).toHaveBeenCalledTimes(1)
	})

	it("should emit extensionEvent when Extension sends event", () => {
		const handler = vi.fn()
		bridge.on("extensionEvent", handler)

		bridge.getExtensionChannel().event({ notification: "test" })

		expect(handler).toHaveBeenCalledTimes(1)
	})

	describe("sendExtensionMessage", () => {
		it("should send extension message as event", () => {
			const handler = vi.fn()
			bridge.on("tuiEvent", handler)

			bridge.sendExtensionMessage({ type: "state", state: {} } as any)

			expect(handler).toHaveBeenCalledTimes(1)
			expect(handler.mock.calls[0][0].data).toEqual({
				type: "extensionMessage",
				payload: { type: "state", state: {} },
			})
		})
	})

	describe("dispose", () => {
		it("should dispose both channels", () => {
			const tuiChannel = bridge.getTUIChannel()
			const extChannel = bridge.getExtensionChannel()

			tuiChannel.on("message", vi.fn())
			extChannel.on("message", vi.fn())

			bridge.dispose()

			expect(tuiChannel.listenerCount("message")).toBe(0)
			expect(extChannel.listenerCount("message")).toBe(0)
		})
	})
})
