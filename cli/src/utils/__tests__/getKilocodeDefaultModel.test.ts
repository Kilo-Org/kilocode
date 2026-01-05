import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { getKilocodeDefaultModel } from "../../auth/providers/kilocode/shared.js"
import { openRouterDefaultModelId } from "@roo-code/types"

// Mock the logs module
vi.mock("../../services/logs.js", () => ({
	logs: {
		info: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		warn: vi.fn(),
	},
}))

// Mock fetch globally
const mockFetch = vi.fn()

describe("getKilocodeDefaultModel", () => {
	beforeEach(() => {
		vi.spyOn(globalThis, "fetch").mockImplementation((...args: unknown[]) => mockFetch(...(args as never[])))
		vi.clearAllMocks()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("should fetch and return the default model successfully", async () => {
		const mockModel = "anthropic/claude-opus-4"
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ defaultModel: mockModel }),
		})

		const result = await getKilocodeDefaultModel("test-token-1234567890")

		expect(result).toBe(mockModel)
		expect(mockFetch).toHaveBeenCalledWith(
			expect.stringContaining("/api/defaults"),
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: "Bearer test-token-1234567890",
				}),
			}),
		)
	})

	it("should fetch from organization-specific endpoint when organizationId is provided", async () => {
		const mockModel = "anthropic/claude-sonnet-4.5"
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ defaultModel: mockModel }),
		})

		const result = await getKilocodeDefaultModel("test-token-1234567890", "org-123")

		expect(result).toBe(mockModel)
		expect(mockFetch).toHaveBeenCalledWith(
			expect.stringContaining("/organizations/org-123/defaults"),
			expect.any(Object),
		)
	})

	it("should return fallback model when API returns non-ok status", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 401,
		})

		const result = await getKilocodeDefaultModel("invalid-token")

		expect(result).toBe(openRouterDefaultModelId)
	})

	it("should return fallback model when API returns empty defaultModel", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ defaultModel: null }),
		})

		const result = await getKilocodeDefaultModel("test-token-1234567890")

		expect(result).toBe(openRouterDefaultModelId)
	})

	it("should return fallback model when API returns undefined defaultModel", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ defaultModel: undefined }),
		})

		const result = await getKilocodeDefaultModel("test-token-1234567890")

		expect(result).toBe(openRouterDefaultModelId)
	})

	it("should return fallback model when fetch throws network error", async () => {
		mockFetch.mockRejectedValueOnce(new Error("Network error"))

		const result = await getKilocodeDefaultModel("test-token-1234567890")

		expect(result).toBe(openRouterDefaultModelId)
	})

	it("should return fallback model when fetch times out", async () => {
		// Simulate timeout by rejecting with abort error
		mockFetch.mockRejectedValueOnce(new Error("The operation was aborted"))

		const result = await getKilocodeDefaultModel("test-token-1234567890")

		expect(result).toBe(openRouterDefaultModelId)
	})

	it("should return fallback model when JSON parsing fails", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => {
				throw new Error("Invalid JSON")
			},
		})

		const result = await getKilocodeDefaultModel("test-token-1234567890")

		expect(result).toBe(openRouterDefaultModelId)
	})

	it("should return fallback model when response schema validation fails", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ wrongField: "value" }),
		})

		const result = await getKilocodeDefaultModel("test-token-1234567890")

		expect(result).toBe(openRouterDefaultModelId)
	})

	it("should handle empty string token gracefully", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ defaultModel: "anthropic/claude-sonnet-4" }),
		})

		const result = await getKilocodeDefaultModel("")

		expect(result).toBe("anthropic/claude-sonnet-4")
	})

	it("should include proper headers in the request", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ defaultModel: "test-model" }),
		})

		await getKilocodeDefaultModel("test-token-1234567890")

		expect(mockFetch).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({
				headers: expect.objectContaining({
					"Content-Type": "application/json",
					Authorization: "Bearer test-token-1234567890",
				}),
			}),
		)
	})
})
