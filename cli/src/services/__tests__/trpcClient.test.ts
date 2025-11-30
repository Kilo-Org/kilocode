import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { TrpcClient } from "../trpcClient.js"

vi.mock("@roo-code/types", () => ({
	getApiUrl: vi.fn(() => "https://api.kilocode.ai"),
}))

describe("TrpcClient", () => {
	let fetchMock: ReturnType<typeof vi.fn>

	beforeEach(() => {
		// Reset the singleton instance before each test
		// @ts-expect-error - Accessing private static property for testing
		TrpcClient.instance = null

		// Always set environment variable to a valid default for tests
		// This ensures consistency across all tests
		process.env.KILOCODE_BACKEND_BASE_URL = "https://api.kilocode.ai"

		// Mock global fetch
		fetchMock = vi.fn()
		global.fetch = fetchMock
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("init", () => {
		it("should throw error when no token provided and no instance exists", () => {
			expect(() => TrpcClient.init()).toThrow("token required to init TrpcClient service")
		})

		it("should create new instance with token", () => {
			const instance = TrpcClient.init("test-token")
			expect(instance).toBeInstanceOf(TrpcClient)
		})

		it("should return same instance on subsequent calls", () => {
			const instance1 = TrpcClient.init("test-token")
			const instance2 = TrpcClient.init()
			expect(instance1).toBe(instance2)
		})

		it("should not create new instance if one already exists, even with new token", () => {
			const instance1 = TrpcClient.init("token1")
			const instance2 = TrpcClient.init("token2")
			expect(instance1).toBe(instance2)
		})
	})

	describe("request", () => {
		let client: TrpcClient

		beforeEach(() => {
			client = TrpcClient.init("test-token")
		})

		describe("GET requests", () => {
			it("should make GET request without input", async () => {
				const mockResponse = { result: { data: "test" } }
				fetchMock.mockResolvedValueOnce({
					ok: true,
					json: async () => mockResponse,
				})

				const result = await client.request("test.procedure", "GET")

				expect(fetchMock).toHaveBeenCalledTimes(1)
				expect(fetchMock).toHaveBeenCalledWith(
					expect.any(URL),
					expect.objectContaining({
						method: "GET",
						headers: {
							"Content-Type": "application/json",
							Authorization: "Bearer test-token",
						},
					}),
				)
				expect(result).toEqual(mockResponse)
			})

			it("should add input as URL search param for GET requests", async () => {
				const mockResponse = { result: "success" }
				fetchMock.mockResolvedValueOnce({
					ok: true,
					json: async () => mockResponse,
				})

				const input = { key: "value", number: 42 }
				await client.request("test.procedure", "GET", input)

				const callUrl = fetchMock.mock.calls[0]?.[0] as URL
				expect(callUrl.searchParams.get("input")).toBe(JSON.stringify(input))
			})

			it("should construct correct URL with procedure name", async () => {
				fetchMock.mockResolvedValueOnce({
					ok: true,
					json: async () => ({}),
				})

				await client.request("user.getProfile", "GET")

				const callUrl = fetchMock.mock.calls[0]?.[0] as URL
				expect(callUrl.pathname).toBe("/api/trpc/user.getProfile")
			})

			it("should use endpoint from getApiUrl", async () => {
				const { getApiUrl } = await import("@roo-code/types")
				vi.mocked(getApiUrl).mockReturnValueOnce("https://custom.api.com")

				// Need to create new client instance to pick up mocked getApiUrl
				// @ts-expect-error - Accessing private static property for testing
				TrpcClient.instance = null
				const customClient = TrpcClient.init("test-token")

				fetchMock.mockResolvedValueOnce({
					ok: true,
					json: async () => ({}),
				})

				await customClient.request("test", "GET")

				const callUrl = fetchMock.mock.calls[0]?.[0] as URL
				expect(callUrl.origin).toBe("https://custom.api.com")
			})

			it("should use default endpoint from getApiUrl when no environment variable", async () => {
				const { getApiUrl } = await import("@roo-code/types")
				vi.mocked(getApiUrl).mockReturnValueOnce("https://api.kilocode.ai")

				// @ts-expect-error - Accessing private static property for testing
				TrpcClient.instance = null
				const defaultClient = TrpcClient.init("test-token")!

				fetchMock.mockResolvedValueOnce({
					ok: true,
					json: async () => ({}),
				})

				await defaultClient.request("test", "GET")

				const callUrl = fetchMock.mock.calls[0]?.[0] as URL
				expect(callUrl.origin).toBe("https://api.kilocode.ai")
			})
		})

		describe("POST requests", () => {
			it("should make POST request without input", async () => {
				const mockResponse = { result: "created" }
				fetchMock.mockResolvedValueOnce({
					ok: true,
					json: async () => mockResponse,
				})

				const result = await client.request("test.create", "POST")

				expect(fetchMock).toHaveBeenCalledWith(
					expect.any(URL),
					expect.objectContaining({
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: "Bearer test-token",
						},
					}),
				)
				expect(result).toEqual(mockResponse)
			})

			it("should add input as body for POST requests", async () => {
				const mockResponse = { result: "created" }
				fetchMock.mockResolvedValueOnce({
					ok: true,
					json: async () => mockResponse,
				})

				const input = { name: "test", data: { nested: true } }
				await client.request("test.create", "POST", input)

				expect(fetchMock).toHaveBeenCalledWith(
					expect.any(URL),
					expect.objectContaining({
						method: "POST",
						body: JSON.stringify(input),
					}),
				)
			})

			it("should not add input to URL params for POST requests", async () => {
				fetchMock.mockResolvedValueOnce({
					ok: true,
					json: async () => ({}),
				})

				const input = { key: "value" }
				await client.request("test", "POST", input)

				const callUrl = fetchMock.mock.calls[0]?.[0] as URL
				expect(callUrl.searchParams.has("input")).toBe(false)
			})
		})

		describe("error handling", () => {
			it("should throw error when response is not ok", async () => {
				fetchMock.mockResolvedValueOnce({
					ok: false,
					status: 404,
					statusText: "Not Found",
					json: async () => ({}),
				})

				await expect(client.request("test", "GET")).rejects.toThrow("tRPC request failed: 404 Not Found")
			})

			it("should include error message from response if available", async () => {
				fetchMock.mockResolvedValueOnce({
					ok: false,
					status: 400,
					statusText: "Bad Request",
					json: async () => ({ message: "Invalid input data" }),
				})

				await expect(client.request("test", "POST")).rejects.toThrow(
					"tRPC request failed: 400 Bad Request - Invalid input data",
				)
			})

			it("should handle response without message field", async () => {
				fetchMock.mockResolvedValueOnce({
					ok: false,
					status: 500,
					statusText: "Internal Server Error",
					json: async () => ({ error: "Something went wrong" }),
				})

				await expect(client.request("test", "GET")).rejects.toThrow(
					"tRPC request failed: 500 Internal Server Error",
				)
			})

			it("should handle JSON parse error in error response", async () => {
				fetchMock.mockResolvedValueOnce({
					ok: false,
					status: 500,
					statusText: "Internal Server Error",
					json: async () => {
						throw new Error("Invalid JSON")
					},
				})

				await expect(client.request("test", "GET")).rejects.toThrow(
					"tRPC request failed: 500 Internal Server Error",
				)
			})

			it("should handle network errors", async () => {
				fetchMock.mockRejectedValueOnce(new Error("Network error"))

				await expect(client.request("test", "GET")).rejects.toThrow("Network error")
			})

			it("should handle 401 Unauthorized", async () => {
				fetchMock.mockResolvedValueOnce({
					ok: false,
					status: 401,
					statusText: "Unauthorized",
					json: async () => ({ message: "Invalid token" }),
				})

				await expect(client.request("test", "GET")).rejects.toThrow(
					"tRPC request failed: 401 Unauthorized - Invalid token",
				)
			})

			it("should handle 403 Forbidden", async () => {
				fetchMock.mockResolvedValueOnce({
					ok: false,
					status: 403,
					statusText: "Forbidden",
					json: async () => ({ message: "Access denied" }),
				})

				await expect(client.request("test", "GET")).rejects.toThrow(
					"tRPC request failed: 403 Forbidden - Access denied",
				)
			})
		})

		describe("authorization", () => {
			it("should include Bearer token in Authorization header", async () => {
				fetchMock.mockResolvedValueOnce({
					ok: true,
					json: async () => ({}),
				})

				await client.request("test", "GET")

				const headers = fetchMock.mock.calls[0]?.[1]?.headers
				expect(headers?.Authorization).toBe("Bearer test-token")
			})

			it("should use token from init call", async () => {
				// @ts-expect-error - Accessing private static property for testing
				TrpcClient.instance = null
				const clientWithToken = TrpcClient.init("custom-token-123")

				fetchMock.mockResolvedValueOnce({
					ok: true,
					json: async () => ({}),
				})

				await clientWithToken.request("test", "POST")

				const headers = fetchMock.mock.calls[0]?.[1]?.headers
				expect(headers?.Authorization).toBe("Bearer custom-token-123")
			})
		})

		describe("content types", () => {
			it("should set Content-Type to application/json", async () => {
				fetchMock.mockResolvedValueOnce({
					ok: true,
					json: async () => ({}),
				})

				await client.request("test", "POST", { data: "test" })

				const headers = fetchMock.mock.calls[0]?.[1]?.headers
				expect(headers?.["Content-Type"]).toBe("application/json")
			})
		})

		describe("type safety", () => {
			it("should handle typed input and output", async () => {
				interface TestInput {
					name: string
					age: number
				}

				interface TestOutput {
					id: string
					created: boolean
				}

				const mockResponse: TestOutput = { id: "123", created: true }
				fetchMock.mockResolvedValueOnce({
					ok: true,
					json: async () => mockResponse,
				})

				const input: TestInput = { name: "Test", age: 25 }
				const result = await client.request<TestInput, TestOutput>("user.create", "POST", input)

				expect(result).toEqual(mockResponse)
				expect(result.id).toBe("123")
				expect(result.created).toBe(true)
			})

			it("should handle void input type", async () => {
				interface TestOutput {
					status: string
				}

				const mockResponse: TestOutput = { status: "ok" }
				fetchMock.mockResolvedValueOnce({
					ok: true,
					json: async () => mockResponse,
				})

				const result = await client.request<void, TestOutput>("health.check", "GET")

				expect(result).toEqual(mockResponse)
			})
		})

		describe("complex input types", () => {
			it("should handle nested objects in input", async () => {
				fetchMock.mockResolvedValueOnce({
					ok: true,
					json: async () => ({}),
				})

				const input = {
					user: {
						name: "Test",
						settings: {
							theme: "dark",
							notifications: true,
						},
					},
					metadata: {
						timestamp: Date.now(),
					},
				}

				await client.request("test", "POST", input)

				const body = fetchMock.mock.calls[0]?.[1]?.body
				expect(body).toBe(JSON.stringify(input))
			})

			it("should handle arrays in input", async () => {
				fetchMock.mockResolvedValueOnce({
					ok: true,
					json: async () => ({}),
				})

				const input = {
					items: [1, 2, 3],
					tags: ["test", "example"],
				}

				await client.request("test", "POST", input)

				const body = fetchMock.mock.calls[0]?.[1]?.body
				expect(JSON.parse(body as string)).toEqual(input)
			})
		})
	})
})
