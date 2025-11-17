import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { createStore } from "jotai"
import type { Mock } from "vitest"
import {
	addUserInputMessageAtom,
	addCliOutputMessageAtom,
	flushMessagesAtom,
	cleanupMessageBatchingAtom,
} from "../message-batching.js"
import { sessionIdAtom } from "../session.js"
import { configAtom } from "../config.js"
import type { CLIConfig } from "../../../config/types.js"

// Mock fetch globally
global.fetch = vi.fn() as Mock

describe("message-batching", () => {
	let store: ReturnType<typeof createStore>

	beforeEach(() => {
		store = createStore()
		vi.clearAllMocks()
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	describe("addUserInputMessageAtom", () => {
		it("should add a user input message to the batch", async () => {
			// Setup
			store.set(sessionIdAtom, "test-session-id")
			store.set(configAtom, {
				kilocodeToken: "test-token",
			} as Partial<CLIConfig> as CLIConfig)

			// Mock successful fetch
			;(global.fetch as Mock).mockResolvedValueOnce({
				ok: true,
				json: async () => ({ result: { data: [] } }),
			})

			// Add a message
			await store.set(addUserInputMessageAtom, "Hello world")

			// Fast-forward time to trigger flush
			await vi.advanceTimersByTimeAsync(1000)

			// Verify fetch was called
			expect(global.fetch).toHaveBeenCalledWith(
				expect.stringContaining("/api/trpc/sessionMessages.batchCreate"),
				expect.objectContaining({
					method: "POST",
					headers: expect.objectContaining({
						"Content-Type": "application/json",
						Authorization: "Bearer test-token",
					}),
					body: expect.stringContaining("Hello world"),
				}),
			)
		})

		it("should flush immediately when 100 messages are reached", async () => {
			// Setup
			store.set(sessionIdAtom, "test-session-id")
			store.set(configAtom, {
				kilocodeToken: "test-token",
			} as Partial<CLIConfig> as CLIConfig)

			// Mock successful fetch
			;(global.fetch as Mock).mockResolvedValue({
				ok: true,
				json: async () => ({ result: { data: [] } }),
			})

			// Add 100 messages
			for (let i = 0; i < 100; i++) {
				await store.set(addUserInputMessageAtom, `Message ${i}`)
			}

			// Should have flushed immediately without waiting for timer
			expect(global.fetch).toHaveBeenCalled()
		})
	})

	describe("addCliOutputMessageAtom", () => {
		it("should add a CLI output message to the batch", async () => {
			// Setup
			store.set(sessionIdAtom, "test-session-id")
			store.set(configAtom, {
				kilocodeToken: "test-token",
			} as Partial<CLIConfig> as CLIConfig)

			// Mock successful fetch
			;(global.fetch as Mock).mockResolvedValueOnce({
				ok: true,
				json: async () => ({ result: { data: [] } }),
			})

			// Add a CLI output message
			await store.set(addCliOutputMessageAtom, "$ ls\nfile1.txt\nfile2.txt")

			// Fast-forward time to trigger flush
			await vi.advanceTimersByTimeAsync(1000)

			// Verify fetch was called with correct message type
			expect(global.fetch).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					body: expect.stringContaining("cli_output"),
				}),
			)
		})
	})

	describe("flushMessagesAtom", () => {
		it("should not flush if no session ID", async () => {
			// Don't set session ID
			store.set(configAtom, {
				kilocodeToken: "test-token",
			} as Partial<CLIConfig> as CLIConfig)

			// Add a message
			await store.set(addUserInputMessageAtom, "Test message")

			// Try to flush
			await store.set(flushMessagesAtom)

			// Should not have called fetch
			expect(global.fetch).not.toHaveBeenCalled()
		})

		it("should not flush if no token", async () => {
			// Set session ID but no token
			store.set(sessionIdAtom, "test-session-id")
			store.set(configAtom, {} as Partial<CLIConfig> as CLIConfig)

			// Add a message
			await store.set(addUserInputMessageAtom, "Test message")

			// Try to flush
			await store.set(flushMessagesAtom)

			// Should not have called fetch
			expect(global.fetch).not.toHaveBeenCalled()
		})

		it("should handle fetch errors gracefully", async () => {
			// Setup
			store.set(sessionIdAtom, "test-session-id")
			store.set(configAtom, {
				kilocodeToken: "test-token",
			} as Partial<CLIConfig> as CLIConfig)

			// Mock failed fetch
			;(global.fetch as Mock).mockRejectedValueOnce(new Error("Network error"))

			// Add a message
			await store.set(addUserInputMessageAtom, "Test message")

			// Flush should not throw
			await expect(store.set(flushMessagesAtom)).resolves.not.toThrow()
		})
	})

	describe("cleanupMessageBatchingAtom", () => {
		it("should flush remaining messages on cleanup", async () => {
			// Setup
			store.set(sessionIdAtom, "test-session-id")
			store.set(configAtom, {
				kilocodeToken: "test-token",
			} as Partial<CLIConfig> as CLIConfig)

			// Mock successful fetch
			;(global.fetch as Mock).mockResolvedValueOnce({
				ok: true,
				json: async () => ({ result: { data: [] } }),
			})

			// Add some messages
			await store.set(addUserInputMessageAtom, "Message 1")
			await store.set(addUserInputMessageAtom, "Message 2")

			// Cleanup
			await store.set(cleanupMessageBatchingAtom)

			// Should have flushed messages
			expect(global.fetch).toHaveBeenCalled()
		})
	})

	describe("timer-based flushing", () => {
		it("should flush messages after 1 second", async () => {
			// Setup
			store.set(sessionIdAtom, "test-session-id")
			store.set(configAtom, {
				kilocodeToken: "test-token",
			} as Partial<CLIConfig> as CLIConfig)

			// Mock successful fetch
			;(global.fetch as Mock).mockResolvedValueOnce({
				ok: true,
				json: async () => ({ result: { data: [] } }),
			})

			// Add a message
			await store.set(addUserInputMessageAtom, "Test message")

			// Should not have flushed yet
			expect(global.fetch).not.toHaveBeenCalled()

			// Fast-forward time
			await vi.advanceTimersByTimeAsync(1000)

			// Should have flushed now
			expect(global.fetch).toHaveBeenCalled()
		})

		it("should flush after 1 second even when messages are continuously added", async () => {
			// Setup
			store.set(sessionIdAtom, "test-session-id")
			store.set(configAtom, {
				kilocodeToken: "test-token",
			} as Partial<CLIConfig> as CLIConfig)

			// Mock successful fetch
			;(global.fetch as Mock).mockResolvedValue({
				ok: true,
				json: async () => ({ result: { data: [] } }),
			})

			// Add first message
			await store.set(addUserInputMessageAtom, "Message 1")

			// Wait 500ms
			await vi.advanceTimersByTimeAsync(500)

			// Add second message (timer should NOT reset)
			await store.set(addUserInputMessageAtom, "Message 2")

			// Should not have flushed yet
			expect(global.fetch).not.toHaveBeenCalled()

			// Wait another 500ms (total 1000ms from first flush)
			await vi.advanceTimersByTimeAsync(500)

			// Should have flushed now (1 second elapsed since last flush, not since last message)
			expect(global.fetch).toHaveBeenCalled()
		})
	})
})
