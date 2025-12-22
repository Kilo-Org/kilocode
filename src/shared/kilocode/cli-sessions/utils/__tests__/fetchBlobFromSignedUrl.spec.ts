import { fetchSignedBlob } from "../fetchBlobFromSignedUrl"
import type { ILogger } from "../../types/ILogger"

describe("fetchSignedBlob", () => {
	let mockFetch: ReturnType<typeof vi.fn>

	beforeEach(() => {
		mockFetch = vi.fn()
		vi.stubGlobal("fetch", mockFetch)
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	describe("Successful Fetch", () => {
		it("fetches and parses JSON from URL", async () => {
			const mockData = { key: "value" }
			const mockResponse = {
				ok: true,
				json: vi.fn().mockResolvedValue(mockData),
			}
			mockFetch.mockResolvedValue(mockResponse)

			const result = await fetchSignedBlob("https://example.com/blob", "test-blob")

			expect(mockFetch).toHaveBeenCalledWith("https://example.com/blob")
			expect(result).toEqual(mockData)
		})

		it("logs debug messages when logger provided", async () => {
			const mockLogger: ILogger = {
				debug: vi.fn(),
				info: vi.fn(),
				warn: vi.fn(),
				error: vi.fn(),
			}
			const mockData = { key: "value" }
			const mockResponse = {
				ok: true,
				json: vi.fn().mockResolvedValue(mockData),
			}
			mockFetch.mockResolvedValue(mockResponse)

			await fetchSignedBlob("https://example.com/blob", "test-blob", mockLogger)

			expect(mockLogger.debug).toHaveBeenCalledWith("Fetching blob from signed URL", "fetchSignedBlob", {
				url: "https://example.com/blob",
				urlType: "test-blob",
			})
			expect(mockLogger.debug).toHaveBeenCalledWith("Successfully fetched blob", "fetchSignedBlob", {
				url: "https://example.com/blob",
				urlType: "test-blob",
			})
		})

		it("works without logger", async () => {
			const mockData = { key: "value" }
			const mockResponse = {
				ok: true,
				json: vi.fn().mockResolvedValue(mockData),
			}
			mockFetch.mockResolvedValue(mockResponse)

			const result = await fetchSignedBlob("https://example.com/blob", "test-blob")

			expect(result).toEqual(mockData)
		})
	})

	describe("Error Handling", () => {
		it("throws error on non-ok response", async () => {
			const mockResponse = {
				ok: false,
				status: 404,
				statusText: "Not Found",
			}
			mockFetch.mockResolvedValue(mockResponse)

			await expect(fetchSignedBlob("https://example.com/blob", "test-blob")).rejects.toThrow(
				"HTTP 404: Not Found",
			)
		})

		it("includes status in error message", async () => {
			const mockResponse = {
				ok: false,
				status: 500,
				statusText: "Internal Server Error",
			}
			mockFetch.mockResolvedValue(mockResponse)

			await expect(fetchSignedBlob("https://example.com/blob", "test-blob")).rejects.toThrow(
				"HTTP 500: Internal Server Error",
			)
		})

		it("logs error when logger provided", async () => {
			const mockLogger: ILogger = {
				debug: vi.fn(),
				info: vi.fn(),
				warn: vi.fn(),
				error: vi.fn(),
			}
			const mockResponse = {
				ok: false,
				status: 404,
				statusText: "Not Found",
			}
			mockFetch.mockResolvedValue(mockResponse)

			await expect(fetchSignedBlob("https://example.com/blob", "test-blob", mockLogger)).rejects.toThrow()

			expect(mockLogger.error).toHaveBeenCalledWith("Failed to fetch blob from signed URL", "fetchSignedBlob", {
				url: "https://example.com/blob",
				urlType: "test-blob",
				error: "HTTP 404: Not Found",
			})
		})

		it("throws error on JSON parse failure", async () => {
			const mockResponse = {
				ok: true,
				json: vi.fn().mockRejectedValue(new Error("Invalid JSON")),
			}
			mockFetch.mockResolvedValue(mockResponse)

			await expect(fetchSignedBlob("https://example.com/blob", "test-blob")).rejects.toThrow("Invalid JSON")
		})
	})
})
