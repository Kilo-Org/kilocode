import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { ExtensionHost } from "../ExtensionHost.js"
import type { WebviewMessage } from "../../types/messages.js"

// Type for accessing private members in tests
interface ExtensionHostInternal {
	initializeState: () => void
	isActivated: boolean
	pendingMessages: WebviewMessage[]
	webviewProviders: Map<string, { handleCLIMessage?: (message: WebviewMessage) => Promise<void> }>
}

describe("ExtensionHost Race Condition Fix", () => {
	let extensionHost: ExtensionHost

	beforeEach(() => {
		extensionHost = new ExtensionHost({
			workspacePath: "/test/workspace",
			extensionBundlePath: "/test/extension.js",
			extensionRootPath: "/test",
		})

		// Initialize state and mark as activated for testing
		const initializeState = (extensionHost as unknown as ExtensionHostInternal).initializeState.bind(extensionHost)
		initializeState()
		;(extensionHost as unknown as ExtensionHostInternal).isActivated = true
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	describe("Message Queuing", () => {
		it("should queue messages when webview is not initialized", async () => {
			const message: WebviewMessage = {
				type: "newTask",
				text: "Test task",
			}

			// Webview should not be ready initially
			expect(extensionHost.isWebviewReady()).toBe(false)

			// Send message - it should be queued
			await extensionHost.sendWebviewMessage(message)

			// Verify message was queued (check internal state)
			const pendingMessages = (extensionHost as unknown as ExtensionHostInternal).pendingMessages
			expect(pendingMessages).toHaveLength(1)
			expect(pendingMessages[0]).toEqual(message)
		})

		it("should queue multiple messages before webview is ready", async () => {
			const messages: WebviewMessage[] = [
				{ type: "mode", text: "code" },
				{ type: "newTask", text: "Test task" },
				{ type: "telemetrySetting", text: "enabled" },
			]

			// Send all messages
			for (const message of messages) {
				await extensionHost.sendWebviewMessage(message)
			}

			// Verify all messages were queued
			const pendingMessages = (extensionHost as unknown as ExtensionHostInternal).pendingMessages
			expect(pendingMessages).toHaveLength(3)
			expect(pendingMessages).toEqual(messages)
		})

		it("should not queue messages after webview is ready", async () => {
			// Mark webview as ready
			extensionHost.markWebviewReady()

			const message: WebviewMessage = {
				type: "newTask",
				text: "Test task",
			}

			// Mock the webview provider to prevent actual message sending
			const mockProvider = {
				handleCLIMessage: vi.fn(),
			}
			;(extensionHost as unknown as ExtensionHostInternal).webviewProviders.set(
				"kilo-code.SidebarProvider",
				mockProvider,
			)

			// Send message - it should not be queued
			await extensionHost.sendWebviewMessage(message)

			// Verify message was not queued
			const pendingMessages = (extensionHost as unknown as ExtensionHostInternal).pendingMessages
			expect(pendingMessages).toHaveLength(0)

			// Verify message was sent directly
			expect(mockProvider.handleCLIMessage).toHaveBeenCalledWith(message)
		})
	})

	describe("Message Flushing", () => {
		it("should flush all pending messages when webview becomes ready", async () => {
			const messages: WebviewMessage[] = [
				{ type: "mode", text: "code" },
				{ type: "newTask", text: "Test task" },
			]

			// Queue messages
			for (const message of messages) {
				await extensionHost.sendWebviewMessage(message)
			}

			// Verify messages are queued
			expect((extensionHost as unknown as ExtensionHostInternal).pendingMessages).toHaveLength(2)

			// Mock the webview provider
			const mockProvider = {
				handleCLIMessage: vi.fn(),
			}
			;(extensionHost as unknown as ExtensionHostInternal).webviewProviders.set(
				"kilo-code.SidebarProvider",
				mockProvider,
			)

			// Mark webview as ready - this should flush messages
			extensionHost.markWebviewReady()

			// Wait for async flush to complete
			await new Promise((resolve) => setTimeout(resolve, 10))

			// Verify pending messages were cleared
			expect((extensionHost as unknown as ExtensionHostInternal).pendingMessages).toHaveLength(0)

			// Verify all messages were sent
			expect(mockProvider.handleCLIMessage).toHaveBeenCalledTimes(2)
		})

		it("should maintain message order when flushing", async () => {
			const messages: WebviewMessage[] = [
				{ type: "mode", text: "code" },
				{ type: "telemetrySetting", text: "enabled" },
				{ type: "newTask", text: "Test task" },
			]

			// Queue messages
			for (const message of messages) {
				await extensionHost.sendWebviewMessage(message)
			}

			// Mock the webview provider to track call order
			const callOrder: string[] = []
			const mockProvider = {
				handleCLIMessage: vi.fn(async (msg: WebviewMessage) => {
					callOrder.push(msg.type)
				}),
			}
			;(extensionHost as unknown as ExtensionHostInternal).webviewProviders.set(
				"kilo-code.SidebarProvider",
				mockProvider,
			)

			// Mark webview as ready
			extensionHost.markWebviewReady()

			// Wait for async flush
			await new Promise((resolve) => setTimeout(resolve, 10))

			// Verify messages were sent in order
			expect(callOrder).toEqual(["mode", "telemetrySetting", "newTask"])
		})
	})

	describe("Initialization State", () => {
		it("should start in initial setup mode", () => {
			expect(extensionHost.isInInitialSetup()).toBe(true)
		})

		it("should exit initial setup mode when webview is marked ready", () => {
			expect(extensionHost.isInInitialSetup()).toBe(true)

			extensionHost.markWebviewReady()

			expect(extensionHost.isInInitialSetup()).toBe(false)
		})

		it("should not be ready initially", () => {
			expect(extensionHost.isWebviewReady()).toBe(false)
		})

		it("should be ready after markWebviewReady is called", () => {
			extensionHost.markWebviewReady()

			expect(extensionHost.isWebviewReady()).toBe(true)
		})
	})

	describe("Race Condition Prevention", () => {
		it("should prevent task abortion by queuing newTask messages", async () => {
			// Simulate the race condition scenario:
			// 1. Extension activates
			// 2. CLI sends newTask immediately
			// 3. Webview resolves later

			const newTaskMessage: WebviewMessage = {
				type: "newTask",
				text: "Test task from CLI",
			}

			// Send newTask before webview is ready (simulating CLI auto mode)
			await extensionHost.sendWebviewMessage(newTaskMessage)

			// Verify message is queued, not processed
			const pendingMessages = (extensionHost as unknown as ExtensionHostInternal).pendingMessages
			expect(pendingMessages).toHaveLength(1)
			expect(pendingMessages[0].type).toBe("newTask")

			// Mock provider
			const mockProvider = {
				handleCLIMessage: vi.fn(),
			}
			;(extensionHost as unknown as ExtensionHostInternal).webviewProviders.set(
				"kilo-code.SidebarProvider",
				mockProvider,
			)

			// Now mark webview as ready (simulating resolveWebviewView completion)
			extensionHost.markWebviewReady()

			// Wait for flush
			await new Promise((resolve) => setTimeout(resolve, 10))

			// Verify the newTask message was sent AFTER webview was ready
			expect(mockProvider.handleCLIMessage).toHaveBeenCalledWith(newTaskMessage)
			expect((extensionHost as unknown as ExtensionHostInternal).pendingMessages).toHaveLength(0)
		})

		it("should handle configuration injection before task creation", async () => {
			const configMessage: WebviewMessage = {
				type: "mode",
				text: "architect",
			}

			const taskMessage: WebviewMessage = {
				type: "newTask",
				text: "Design a system",
			}

			// Send config and task messages before webview is ready
			await extensionHost.sendWebviewMessage(configMessage)
			await extensionHost.sendWebviewMessage(taskMessage)

			// Both should be queued
			const pendingMessages = (extensionHost as unknown as ExtensionHostInternal).pendingMessages
			expect(pendingMessages).toHaveLength(2)

			// Mock provider
			const callOrder: string[] = []
			const mockProvider = {
				handleCLIMessage: vi.fn(async (msg: WebviewMessage) => {
					callOrder.push(msg.type)
				}),
			}
			;(extensionHost as unknown as ExtensionHostInternal).webviewProviders.set(
				"kilo-code.SidebarProvider",
				mockProvider,
			)

			// Mark ready
			extensionHost.markWebviewReady()
			await new Promise((resolve) => setTimeout(resolve, 10))

			// Verify config was sent before task
			expect(callOrder).toEqual(["mode", "newTask"])
		})
	})

	describe("Edge Cases", () => {
		it("should handle markWebviewReady being called multiple times", () => {
			extensionHost.markWebviewReady()
			expect(extensionHost.isWebviewReady()).toBe(true)

			// Call again - should not cause issues
			extensionHost.markWebviewReady()
			expect(extensionHost.isWebviewReady()).toBe(true)
		})

		it("should handle empty pending messages queue", () => {
			// Mark ready with no pending messages
			expect((extensionHost as unknown as ExtensionHostInternal).pendingMessages).toHaveLength(0)

			// Should not throw
			expect(() => extensionHost.markWebviewReady()).not.toThrow()

			expect(extensionHost.isWebviewReady()).toBe(true)
		})

		it("should handle messages sent during flush", async () => {
			// Queue initial message
			await extensionHost.sendWebviewMessage({ type: "mode", text: "code" })

			// Mock provider that sends another message during handling
			const mockProvider = {
				handleCLIMessage: vi.fn(async (msg: WebviewMessage) => {
					if (msg.type === "mode") {
						// Send another message during flush
						await extensionHost.sendWebviewMessage({ type: "telemetrySetting", text: "enabled" })
					}
				}),
			}
			;(extensionHost as unknown as ExtensionHostInternal).webviewProviders.set(
				"kilo-code.SidebarProvider",
				mockProvider,
			)

			// Mark ready and flush
			extensionHost.markWebviewReady()
			await new Promise((resolve) => setTimeout(resolve, 20))

			// Both messages should have been processed
			expect(mockProvider.handleCLIMessage).toHaveBeenCalledTimes(2)
		})
	})
})
