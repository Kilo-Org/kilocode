import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

// vi.hoisted() is hoisted above vi.mock() calls, so these classes are available to mock factories
const { MockExtensionHost, MockMessageBridge, MockIPCChannel } = vi.hoisted(() => {
	// We need to create mock classes without extending EventEmitter
	// since EventEmitter import would not be available at hoist time.
	// Instead, we'll create simple objects with the methods we need.

	class MockIPCChannel {
		private listeners: Map<string, Set<(...args: unknown[]) => void>> = new Map()

		on(event: string, listener: (...args: unknown[]) => void) {
			if (!this.listeners.has(event)) {
				this.listeners.set(event, new Set())
			}
			this.listeners.get(event)!.add(listener)
			return this
		}

		emit(event: string, ...args: unknown[]) {
			const eventListeners = this.listeners.get(event)
			if (eventListeners) {
				for (const listener of eventListeners) {
					listener(...args)
				}
			}
			return true
		}

		removeListener(event: string, listener: (...args: unknown[]) => void) {
			const eventListeners = this.listeners.get(event)
			if (eventListeners) {
				eventListeners.delete(listener)
			}
			return this
		}

		send() {}
		respond() {}
	}

	class MockExtensionHost {
		private listeners: Map<string, Set<(...args: unknown[]) => void>> = new Map()
		private _webviewReady = false
		private _currentState = {}

		on(event: string, listener: (...args: unknown[]) => void) {
			if (!this.listeners.has(event)) {
				this.listeners.set(event, new Set())
			}
			this.listeners.get(event)!.add(listener)
			return this
		}

		emit(event: string, ...args: unknown[]) {
			const eventListeners = this.listeners.get(event)
			if (eventListeners) {
				for (const listener of eventListeners) {
					listener(...args)
				}
			}
			return true
		}

		removeListener(event: string, listener: (...args: unknown[]) => void) {
			const eventListeners = this.listeners.get(event)
			if (eventListeners) {
				eventListeners.delete(listener)
			}
			return this
		}

		listenerCount(event: string) {
			return this.listeners.get(event)?.size ?? 0
		}

		async activate() {
			// Emit activated event after a short delay
			setTimeout(() => {
				this.emit("activated", this.getAPI())
			}, 10)
			return this.getAPI()
		}

		async deactivate() {}

		getAPI() {
			return {
				getState: () => this._currentState,
				sendMessage: () => {},
				updateState: () => {},
			}
		}

		async sendWebviewMessage() {}

		async injectConfiguration() {}

		async syncConfigurationMessages() {}

		markWebviewReady(): void {
			this._webviewReady = true
		}

		isWebviewReady(): boolean {
			return this._webviewReady
		}

		isInInitialSetup(): boolean {
			return false
		}
	}

	class MockMessageBridge {
		private tuiChannel = new MockIPCChannel()
		private extChannel = new MockIPCChannel()

		async sendWebviewMessage() {}
		async sendExtensionMessage() {}
		getTUIChannel() {
			return this.tuiChannel
		}
		getExtensionChannel() {
			return this.extChannel
		}
		dispose() {}
	}

	return { MockExtensionHost, MockMessageBridge, MockIPCChannel }
})

// Mock the extension-paths module
vi.mock("../utils/extension-paths.js", () => ({
	resolveExtensionPaths: () => ({
		extensionBundlePath: "/mock/extension/dist/extension.js",
		extensionRootPath: "/mock/extension",
	}),
}))

// Mock the ExtensionHost
vi.mock("../host/ExtensionHost.js", () => ({
	ExtensionHost: MockExtensionHost,
	createExtensionHost: () => new MockExtensionHost(),
}))

// Mock the IPC module
vi.mock("../communication/ipc.js", () => ({
	MessageBridge: MockMessageBridge,
	IPCChannel: MockIPCChannel,
	createMessageBridge: () => new MockMessageBridge(),
}))

// Now import the ExtensionService which will use our mocks
import { ExtensionService } from "../services/extension.js"
import type { ExtensionMessage, WebviewMessage } from "../types/index.js"

describe("ExtensionService - requestSingleCompletion", () => {
	let service: ExtensionService

	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(async () => {
		if (service) {
			await service.dispose()
		}
	})

	describe("Error Handling", () => {
		it("should throw error when service is not ready", async () => {
			service = new ExtensionService({
				extensionBundlePath: "/mock/extension/dist/extension.js",
				extensionRootPath: "/mock/extension",
			})

			// Don't initialize - service not ready
			await expect(service.requestSingleCompletion("test")).rejects.toThrow("ExtensionService not ready")
		})

		it("should handle message send failures", async () => {
			service = new ExtensionService({
				extensionBundlePath: "/mock/extension/dist/extension.js",
				extensionRootPath: "/mock/extension",
			})

			await service.initialize()

			// Wait for activation event
			await new Promise((resolve) => setTimeout(resolve, 50))

			// Mock sendWebviewMessage to fail
			vi.spyOn(service, "sendWebviewMessage").mockRejectedValue(new Error("Send failed"))

			await expect(service.requestSingleCompletion("test")).rejects.toThrow("Send failed")
		})
	})

	describe("Timeout Handling", () => {
		it("should timeout if no response received within default timeout", async () => {
			service = new ExtensionService({
				extensionBundlePath: "/mock/extension/dist/extension.js",
				extensionRootPath: "/mock/extension",
			})

			await service.initialize()

			// Wait for activation event
			await new Promise((resolve) => setTimeout(resolve, 50))

			// Use a very short timeout for testing
			const completionPromise = service.requestSingleCompletion("test", 100)

			// Don't send any response - let it timeout
			await expect(completionPromise).rejects.toThrow("Single completion request timed out")
		}, 10000)

		it("should use custom timeout value", async () => {
			service = new ExtensionService({
				extensionBundlePath: "/mock/extension/dist/extension.js",
				extensionRootPath: "/mock/extension",
			})

			await service.initialize()

			// Wait for activation event
			await new Promise((resolve) => setTimeout(resolve, 50))

			const customTimeout = 200
			const completionPromise = service.requestSingleCompletion("test", customTimeout)

			await expect(completionPromise).rejects.toThrow("Single completion request timed out")
		}, 10000)

		it("should cleanup event listeners on timeout", async () => {
			service = new ExtensionService({
				extensionBundlePath: "/mock/extension/dist/extension.js",
				extensionRootPath: "/mock/extension",
			})

			await service.initialize()

			// Wait for activation event
			await new Promise((resolve) => setTimeout(resolve, 50))

			const initialListenerCount = service.listenerCount("message")

			try {
				await service.requestSingleCompletion("test", 100)
			} catch (_error) {
				// Expected to timeout
			}

			// Wait a bit for cleanup
			await new Promise((resolve) => setTimeout(resolve, 50))

			// Listener count should be back to initial
			expect(service.listenerCount("message")).toBe(initialListenerCount)
		}, 10000)
	})

	describe("Request Correlation", () => {
		it("should not mix up responses for different request IDs", async () => {
			service = new ExtensionService({
				extensionBundlePath: "/mock/extension/dist/extension.js",
				extensionRootPath: "/mock/extension",
			})

			await service.initialize()

			// Wait for activation event
			await new Promise((resolve) => setTimeout(resolve, 50))

			// Capture request IDs
			const requestIds: string[] = []
			const originalSend = service.sendWebviewMessage.bind(service)
			vi.spyOn(service, "sendWebviewMessage").mockImplementation(async (msg: WebviewMessage) => {
				if (msg.type === "singleCompletion" && "completionRequestId" in msg) {
					requestIds.push(msg.completionRequestId as string)
				}
				return originalSend(msg)
			})

			const promise1 = service.requestSingleCompletion("prompt 1")
			const promise2 = service.requestSingleCompletion("prompt 2")

			await new Promise((resolve) => setTimeout(resolve, 100))

			const requestId1 = requestIds[0]
			const requestId2 = requestIds[1]

			// Send response for request 2 first
			service.emit("message", {
				type: "singleCompletionResult",
				completionRequestId: requestId2,
				completionText: "result 2",
				success: true,
			} as ExtensionMessage)

			// Send response for request 1
			service.emit("message", {
				type: "singleCompletionResult",
				completionRequestId: requestId1,
				completionText: "result 1",
				success: true,
			} as ExtensionMessage)

			const result1 = await promise1
			const result2 = await promise2

			expect(result1).toBe("result 1")
			expect(result2).toBe("result 2")
		})
	})

	describe("Edge Cases", () => {
		it("should handle very long prompts", async () => {
			service = new ExtensionService({
				extensionBundlePath: "/mock/extension/dist/extension.js",
				extensionRootPath: "/mock/extension",
			})

			await service.initialize()

			// Wait for activation event
			await new Promise((resolve) => setTimeout(resolve, 50))

			let capturedRequestId: string | undefined
			const originalSend = service.sendWebviewMessage.bind(service)
			vi.spyOn(service, "sendWebviewMessage").mockImplementation(async (msg: WebviewMessage) => {
				if (msg.type === "singleCompletion" && "completionRequestId" in msg) {
					capturedRequestId = msg.completionRequestId as string
					setTimeout(() => {
						service.emit("message", {
							type: "singleCompletionResult",
							completionRequestId: capturedRequestId,
							completionText: "result",
							success: true,
						} as ExtensionMessage)
					}, 10)
				}
				return originalSend(msg)
			})

			const longPrompt = "a".repeat(10000)
			const result = await service.requestSingleCompletion(longPrompt)
			expect(result).toBe("result")
		})

		it("should handle special characters in prompt", async () => {
			service = new ExtensionService({
				extensionBundlePath: "/mock/extension/dist/extension.js",
				extensionRootPath: "/mock/extension",
			})

			await service.initialize()

			// Wait for activation event
			await new Promise((resolve) => setTimeout(resolve, 50))

			let capturedRequestId: string | undefined
			const originalSend = service.sendWebviewMessage.bind(service)
			vi.spyOn(service, "sendWebviewMessage").mockImplementation(async (msg: WebviewMessage) => {
				if (msg.type === "singleCompletion" && "completionRequestId" in msg) {
					capturedRequestId = msg.completionRequestId as string
					setTimeout(() => {
						service.emit("message", {
							type: "singleCompletionResult",
							completionRequestId: capturedRequestId,
							completionText: "result",
							success: true,
						} as ExtensionMessage)
					}, 10)
				}
				return originalSend(msg)
			})

			const specialPrompt = "Test with\nnewlines\tand\ttabs and 'quotes'"
			const result = await service.requestSingleCompletion(specialPrompt)
			expect(result).toBe("result")
		})

		it("should cleanup listeners on successful completion", async () => {
			service = new ExtensionService({
				extensionBundlePath: "/mock/extension/dist/extension.js",
				extensionRootPath: "/mock/extension",
			})

			await service.initialize()

			// Wait for activation event
			await new Promise((resolve) => setTimeout(resolve, 50))

			const initialListenerCount = service.listenerCount("message")

			let capturedRequestId: string | undefined
			const originalSend = service.sendWebviewMessage.bind(service)
			vi.spyOn(service, "sendWebviewMessage").mockImplementation(async (msg: WebviewMessage) => {
				if (msg.type === "singleCompletion" && "completionRequestId" in msg) {
					capturedRequestId = msg.completionRequestId as string
					setTimeout(() => {
						service.emit("message", {
							type: "singleCompletionResult",
							completionRequestId: capturedRequestId,
							completionText: "result",
							success: true,
						} as ExtensionMessage)
					}, 10)
				}
				return originalSend(msg)
			})

			await service.requestSingleCompletion("test")

			// Listener count should be back to initial
			expect(service.listenerCount("message")).toBe(initialListenerCount)
		})
	})
})
