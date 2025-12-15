import { TrpcClient, TrpcError } from "../TrpcClient"

// Mock getApiUrl
vi.mock("@roo-code/types", () => ({
	getApiUrl: vi.fn().mockReturnValue("https://api.example.com"),
}))

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal("fetch", mockFetch)

describe("TrpcClient", () => {
	let client: TrpcClient
	let mockGetToken: ReturnType<typeof vi.fn>

	beforeEach(() => {
		vi.clearAllMocks()
		mockGetToken = vi.fn().mockResolvedValue("mock-token")
		client = new TrpcClient({ getToken: mockGetToken })
	})

	describe("Request Handling", () => {
		it("request constructs correct URL for procedure", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: vi.fn().mockResolvedValue({ result: { data: "success" } }),
			})

			await client.request("cliSessions.get", "GET")

			const [url, options] = mockFetch.mock.calls[0]
			expect(url.href).toBe("https://api.example.com/api/trpc/cliSessions.get")
			expect(options).toEqual({
				method: "GET",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer mock-token",
				},
			})
		})

		it("request adds input to query params for GET", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: vi.fn().mockResolvedValue({ result: { data: "success" } }),
			})

			await client.request("cliSessions.get", "GET", { id: "123" })

			const [url, options] = mockFetch.mock.calls[0]
			expect(url.href).toBe("https://api.example.com/api/trpc/cliSessions.get?input=%7B%22id%22%3A%22123%22%7D")
			expect(options).toEqual({
				method: "GET",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer mock-token",
				},
			})
		})

		it("request adds input to body for POST", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: vi.fn().mockResolvedValue({ result: { data: "success" } }),
			})

			await client.request("cliSessions.create", "POST", { name: "test" })

			const [url, options] = mockFetch.mock.calls[0]
			expect(url.href).toBe("https://api.example.com/api/trpc/cliSessions.create")
			expect(options).toEqual({
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer mock-token",
				},
				body: JSON.stringify({ name: "test" }),
			})
		})

		it("request includes authorization header", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: vi.fn().mockResolvedValue({ result: { data: "success" } }),
			})

			await client.request("cliSessions.get", "GET")

			const [, options] = mockFetch.mock.calls[0]
			expect(options.headers.Authorization).toBe("Bearer mock-token")
		})

		it("request unwraps tRPC response", async () => {
			const mockData = { id: "123", name: "test" }
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: vi.fn().mockResolvedValue({ result: { data: mockData } }),
			})

			const result = await client.request("cliSessions.get", "GET")

			expect(result).toEqual(mockData)
		})
	})

	describe("Error Handling", () => {
		it("request throws TrpcError on non-ok response", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 404,
				text: vi.fn().mockResolvedValue("Not Found"),
			})

			await expect(client.request("cliSessions.get", "GET")).rejects.toThrow(TrpcError)
		})

		it("TrpcError includes procedure name", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 404,
				text: vi.fn().mockResolvedValue("Not Found"),
			})

			try {
				await client.request("cliSessions.get", "GET")
			} catch (error) {
				expect(error).toBeInstanceOf(TrpcError)
				expect((error as TrpcError).procedure).toBe("cliSessions.get")
			}
		})

		it("TrpcError includes HTTP method", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 404,
				text: vi.fn().mockResolvedValue("Not Found"),
			})

			try {
				await client.request("cliSessions.get", "GET")
			} catch (error) {
				expect(error).toBeInstanceOf(TrpcError)
				expect((error as TrpcError).method).toBe("GET")
			}
		})

		it("TrpcError includes status code", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 500,
				text: vi.fn().mockResolvedValue("Internal Server Error"),
			})

			try {
				await client.request("cliSessions.get", "GET")
			} catch (error) {
				expect(error).toBeInstanceOf(TrpcError)
				expect((error as TrpcError).status).toBe(500)
			}
		})

		it("TrpcError includes response body", async () => {
			const errorBody = { error: "Something went wrong" }
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 400,
				text: vi.fn().mockResolvedValue(JSON.stringify(errorBody)),
			})

			try {
				await client.request("cliSessions.get", "GET")
			} catch (error) {
				expect(error).toBeInstanceOf(TrpcError)
				expect((error as TrpcError).responseBody).toEqual(errorBody)
			}
		})

		it("TrpcError includes request input", async () => {
			const input = { id: "123" }
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 404,
				text: vi.fn().mockResolvedValue("Not Found"),
			})

			try {
				await client.request("cliSessions.get", "GET", input)
			} catch (error) {
				expect(error).toBeInstanceOf(TrpcError)
				expect((error as TrpcError).requestInput).toBe(input)
			}
		})

		it("TrpcError handles non-JSON response body", async () => {
			const plainTextBody = "Plain text error"
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 500,
				text: vi.fn().mockResolvedValue(plainTextBody),
			})

			try {
				await client.request("cliSessions.get", "GET")
			} catch (error) {
				expect(error).toBeInstanceOf(TrpcError)
				expect((error as TrpcError).responseBody).toBe(plainTextBody)
			}
		})
	})

	describe("Configuration", () => {
		it("uses endpoint from getApiUrl", () => {
			expect(client.endpoint).toBe("https://api.example.com")
		})

		it("exposes getToken function", () => {
			expect(client.getToken).toBe(mockGetToken)
		})
	})
})
