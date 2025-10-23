// kilocode_change - file added
// npx vitest run api/providers/__tests__/fetch-with-timeout.spec.ts

import { vi, describe, it, expect, beforeEach } from "vitest"

// Declare hoisted mocks to be safely referenced inside vi.mock factory
const hoisted = vi.hoisted(() => {
	return {
		mockFetch: vi.fn(),
		mockAgentConstructor: vi.fn(),
		agentInstances: [] as any[],
	}
})

// Mock the undici module used by the implementation
vi.mock("undici", () => {
	// Create a mock HeadersTimeoutError class
	class HeadersTimeoutError extends Error {
		constructor(message?: string) {
			super(message)
			this.name = "HeadersTimeoutError"
		}
	}

	return {
		EnvHttpProxyAgent: vi.fn().mockImplementation((opts: any) => {
			hoisted.mockAgentConstructor(opts)
			const instance = { __mock: "EnvHttpProxyAgent" }
			hoisted.agentInstances.push(instance)
			return instance
		}),
		fetch: hoisted.mockFetch,
		errors: {
			HeadersTimeoutError,
		},
	}
})

// Import after mocking so the implementation picks up our mocks
import { fetchWithTimeout } from "../kilocode/fetchWithTimeout"

describe("fetchWithTimeout - header precedence and timeout wiring", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		hoisted.agentInstances.length = 0
	})

	it("should prefer persistent headers over request-specific headers (application/json overrides text/plain)", async () => {
		hoisted.mockFetch.mockResolvedValueOnce({ ok: true } as any)

		const timeoutMs = 5_000
		const f = fetchWithTimeout(timeoutMs, {
			"Content-Type": "application/json",
			"X-Test": "A",
		})

		await f("http://example.com", {
			method: "POST",
			headers: {
				"Content-Type": "text/plain",
				"X-Test": "B",
			},
			body: '{"x":1}',
		})

		// Agent constructed with correct timeouts
		expect(hoisted.mockAgentConstructor).toHaveBeenCalledWith({
			headersTimeout: timeoutMs,
			bodyTimeout: timeoutMs,
		})

		// Fetch called with merged headers where persistent wins
		expect(hoisted.mockFetch).toHaveBeenCalledTimes(1)
		const [url, init] = hoisted.mockFetch.mock.calls[0]
		expect(url).toBe("http://example.com")

		// Dispatcher is the agent instance we created
		expect(init.dispatcher).toBe(hoisted.agentInstances[0])

		// Persistent headers must override request-specific ones
		expect(init.headers).toEqual(
			expect.objectContaining({
				"Content-Type": "application/json",
				"X-Test": "A",
			}),
		)
	})

	it("should apply persistent application/json when request-specific Content-Type is omitted (prevents defaulting to text/plain)", async () => {
		hoisted.mockFetch.mockResolvedValueOnce({ ok: true } as any)

		const f = fetchWithTimeout(10_000, {
			"Content-Type": "application/json",
		})

		await f("http://example.com", {
			method: "POST",
			body: '{"x":1}',
		})

		expect(hoisted.mockFetch).toHaveBeenCalledTimes(1)
		const [, init] = hoisted.mockFetch.mock.calls[0]

		// Ensure Content-Type remains application/json
		expect(init.headers).toEqual(
			expect.objectContaining({
				"Content-Type": "application/json",
			}),
		)
	})
})
