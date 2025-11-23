import { describe, it, expect, beforeEach, vi } from "vitest"
import { RequestDeduplicator, type PendingRequest } from "../RequestDeduplicator"
import type { LLMRetrievalResult } from "../GhostInlineCompletionProvider"

describe("RequestDeduplicator", () => {
	let deduplicator: RequestDeduplicator

	beforeEach(() => {
		deduplicator = new RequestDeduplicator()
	})

	function createMockRequest(prefix: string, suffix: string): PendingRequest {
		return {
			prefix,
			suffix,
			promise: Promise.resolve({
				suggestion: { text: "test", prefix, suffix },
				cost: 0,
				inputTokens: 0,
				outputTokens: 0,
				cacheWriteTokens: 0,
				cacheReadTokens: 0,
			} as LLMRetrievalResult),
			abortController: new AbortController(),
		}
	}

	describe("findReusable", () => {
		it("should find exact match", () => {
			const request = createMockRequest("const x = ", "")
			deduplicator.add("const x = ", "", request)

			const found = deduplicator.findReusable("const x = ", "")
			expect(found).toBe(request)
		})

		it("should find reusable request when user typed ahead", () => {
			const request = createMockRequest("const x = ", "")
			deduplicator.add("const x = ", "", request)

			// User typed "f" after the original prefix
			const found = deduplicator.findReusable("const x = f", "")
			expect(found).toBe(request)
		})

		it("should not find request with different suffix", () => {
			const request = createMockRequest("const x = ", "\nconst y = 2")
			deduplicator.add("const x = ", "\nconst y = 2", request)

			const found = deduplicator.findReusable("const x = ", "\nconst z = 3")
			expect(found).toBeNull()
		})

		it("should not find request when prefix diverged", () => {
			const request = createMockRequest("const x = f", "")
			deduplicator.add("const x = f", "", request)

			// User changed to "g" instead of continuing with "f"
			const found = deduplicator.findReusable("const x = g", "")
			expect(found).toBeNull()
		})

		it("should return null when no requests exist", () => {
			const found = deduplicator.findReusable("const x = ", "")
			expect(found).toBeNull()
		})

		it("should prefer exact match over type-ahead match", () => {
			const request1 = createMockRequest("const x = ", "")
			const request2 = createMockRequest("const x = f", "")

			deduplicator.add("const x = ", "", request1)
			deduplicator.add("const x = f", "", request2)

			// Should return exact match, not the shorter prefix
			const found = deduplicator.findReusable("const x = f", "")
			expect(found).toBe(request2)
		})
	})

	describe("add and remove", () => {
		it("should add and retrieve request", () => {
			const request = createMockRequest("const x = ", "")
			deduplicator.add("const x = ", "", request)

			expect(deduplicator.size()).toBe(1)
			const found = deduplicator.findReusable("const x = ", "")
			expect(found).toBe(request)
		})

		it("should remove request", () => {
			const request = createMockRequest("const x = ", "")
			deduplicator.add("const x = ", "", request)

			deduplicator.remove("const x = ", "")

			expect(deduplicator.size()).toBe(0)
			const found = deduplicator.findReusable("const x = ", "")
			expect(found).toBeNull()
		})

		it("should handle multiple requests", () => {
			const request1 = createMockRequest("const x = ", "")
			const request2 = createMockRequest("const y = ", "")

			deduplicator.add("const x = ", "", request1)
			deduplicator.add("const y = ", "", request2)

			expect(deduplicator.size()).toBe(2)
		})
	})

	describe("cancelObsolete", () => {
		it("should cancel requests with different suffix", () => {
			const request = createMockRequest("const x = ", "\nconst y = 2")
			const abortSpy = vi.spyOn(request.abortController, "abort")

			deduplicator.add("const x = ", "\nconst y = 2", request)

			// Cancel with different suffix
			deduplicator.cancelObsolete("const x = ", "\nconst z = 3")

			expect(abortSpy).toHaveBeenCalled()
			expect(deduplicator.size()).toBe(0)
		})

		it("should cancel requests with diverged prefix", () => {
			const request = createMockRequest("const x = f", "")
			const abortSpy = vi.spyOn(request.abortController, "abort")

			deduplicator.add("const x = f", "", request)

			// Cancel with diverged prefix
			deduplicator.cancelObsolete("const x = g", "")

			expect(abortSpy).toHaveBeenCalled()
			expect(deduplicator.size()).toBe(0)
		})

		it("should not cancel reusable requests", () => {
			const request = createMockRequest("const x = ", "")
			const abortSpy = vi.spyOn(request.abortController, "abort")

			deduplicator.add("const x = ", "", request)

			// User typed ahead - should not cancel
			deduplicator.cancelObsolete("const x = f", "")

			expect(abortSpy).not.toHaveBeenCalled()
			expect(deduplicator.size()).toBe(1)
		})

		it("should not cancel when current prefix is shorter (backspace)", () => {
			const request = createMockRequest("const x = fu", "")
			const abortSpy = vi.spyOn(request.abortController, "abort")

			deduplicator.add("const x = fu", "", request)

			// User backspaced - should not cancel
			deduplicator.cancelObsolete("const x = f", "")

			expect(abortSpy).not.toHaveBeenCalled()
			expect(deduplicator.size()).toBe(1)
		})

		it("should handle multiple requests", () => {
			const request1 = createMockRequest("const x = ", "")
			const request2 = createMockRequest("const y = ", "")
			const request3 = createMockRequest("const x = f", "")

			const abort1 = vi.spyOn(request1.abortController, "abort")
			const abort2 = vi.spyOn(request2.abortController, "abort")
			const abort3 = vi.spyOn(request3.abortController, "abort")

			deduplicator.add("const x = ", "", request1)
			deduplicator.add("const y = ", "", request2)
			deduplicator.add("const x = f", "", request3)

			// Cancel obsolete for "const x = fu"
			deduplicator.cancelObsolete("const x = fu", "")

			// request2 should be cancelled (different prefix)
			// request1 and request3 should not be cancelled (reusable)
			expect(abort1).not.toHaveBeenCalled()
			expect(abort2).toHaveBeenCalled()
			expect(abort3).not.toHaveBeenCalled()
			expect(deduplicator.size()).toBe(2)
		})
	})

	describe("clear", () => {
		it("should cancel and clear all requests", () => {
			const request1 = createMockRequest("const x = ", "")
			const request2 = createMockRequest("const y = ", "")

			const abort1 = vi.spyOn(request1.abortController, "abort")
			const abort2 = vi.spyOn(request2.abortController, "abort")

			deduplicator.add("const x = ", "", request1)
			deduplicator.add("const y = ", "", request2)

			deduplicator.clear()

			expect(abort1).toHaveBeenCalled()
			expect(abort2).toHaveBeenCalled()
			expect(deduplicator.size()).toBe(0)
		})

		it("should handle empty deduplicator", () => {
			expect(() => deduplicator.clear()).not.toThrow()
			expect(deduplicator.size()).toBe(0)
		})
	})

	describe("size", () => {
		it("should return correct size", () => {
			expect(deduplicator.size()).toBe(0)

			deduplicator.add("const x = ", "", createMockRequest("const x = ", ""))
			expect(deduplicator.size()).toBe(1)

			deduplicator.add("const y = ", "", createMockRequest("const y = ", ""))
			expect(deduplicator.size()).toBe(2)

			deduplicator.remove("const x = ", "")
			expect(deduplicator.size()).toBe(1)

			deduplicator.clear()
			expect(deduplicator.size()).toBe(0)
		})
	})
})
