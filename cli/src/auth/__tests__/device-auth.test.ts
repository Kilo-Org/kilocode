import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { authenticateWithDeviceAuth } from "../providers/kilocode/device-auth.js"
import { poll } from "../utils/polling.js"

// Mock dependencies
vi.mock("@roo-code/types", () => ({
	getApiUrl: (path: string) => `https://api.kilocode.com${path}`,
	openRouterDefaultModelId: "anthropic/claude-sonnet-4",
}))

vi.mock("../utils/browser.js", () => ({
	openBrowser: vi.fn().mockResolvedValue(true),
}))

vi.mock("inquirer", () => ({
	default: {
		prompt: vi.fn(),
	},
}))

vi.mock("../../../services/logs.js", () => ({
	logs: {
		info: vi.fn(),
		error: vi.fn(),
	},
}))

vi.mock("../providers/kilocode/shared.js", () => ({
	getKilocodeProfile: vi.fn().mockResolvedValue({
		user: { email: "test@example.com" },
		organizations: [],
	}),
	getKilocodeDefaultModel: vi.fn().mockResolvedValue("anthropic/claude-sonnet-4"),
	promptOrganizationSelection: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("../utils/polling.js", async () => {
	const actual = await vi.importActual<typeof import("../utils/polling.js")>("../utils/polling.js")
	return {
		...actual,
		poll: vi.fn(),
		formatTimeRemaining: actual.formatTimeRemaining,
	}
})

describe("Device Auth Flow", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		// Mock console methods
		vi.spyOn(console, "log").mockImplementation(() => {})
		vi.spyOn(console, "error").mockImplementation(() => {})
		vi.spyOn(process.stdout, "write").mockImplementation(() => true)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("should successfully complete device auth flow", async () => {
		// Mock fetch for initiate
		const mockInitiateResponse = {
			code: "ABC-123",
			verificationUrl: "https://app.kilocode.com/device-auth?code=ABC-123",
			expiresIn: 600,
		}

		// Mock fetch for poll (approved)
		const mockPollResponse = {
			status: "approved",
			token: "test-token-123",
			userId: "user-123",
			userEmail: "test@example.com",
		}

		vi.spyOn(globalThis, "fetch").mockImplementation(((url: string) => {
			if (url.includes("/api/device-auth/codes") && !url.match(/\/codes\/[^/]+$/)) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve(mockInitiateResponse),
				} as Response)
			}
			if (url.includes("/api/device-auth/codes/")) {
				return Promise.resolve({
					ok: true,
					status: 200,
					json: () => Promise.resolve(mockPollResponse),
				} as Response)
			}
			return Promise.reject(new Error("Unexpected URL"))
		}) as unknown as typeof fetch)

		// Mock poll to immediately return success
		vi.mocked(poll).mockResolvedValueOnce(mockPollResponse)

		const result = await authenticateWithDeviceAuth()

		expect(result.providerConfig).toEqual({
			id: "default",
			provider: "kilocode",
			kilocodeToken: "test-token-123",
			kilocodeModel: "anthropic/claude-sonnet-4",
		})
	})

	it("should handle initiation failure", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue({
			ok: false,
			status: 500,
		} as Response)

		await expect(authenticateWithDeviceAuth()).rejects.toThrow("Failed to start authentication")
	})

	it("should handle rate limiting", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue({
			ok: false,
			status: 429,
		} as Response)

		await expect(authenticateWithDeviceAuth()).rejects.toThrow(
			"Too many pending authorization requests. Please try again later.",
		)
	})

	it("should handle denied authorization", async () => {
		const mockInitiateResponse = {
			code: "ABC-123",
			verificationUrl: "https://app.kilocode.com/device-auth?code=ABC-123",
			expiresIn: 600,
		}

		vi.spyOn(globalThis, "fetch").mockImplementation(((url: string) => {
			if (url.includes("/api/device-auth/codes") && !url.match(/\/codes\/[^/]+$/)) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve(mockInitiateResponse),
				} as Response)
			}
			if (url.includes("/api/device-auth/codes/")) {
				return Promise.resolve({
					ok: false,
					status: 403,
					json: () => Promise.resolve({ status: "denied" }),
				} as Response)
			}
			return Promise.reject(new Error("Unexpected URL"))
		}) as unknown as typeof fetch)

		// Mock poll to immediately return the error
		vi.mocked(poll).mockRejectedValueOnce(new Error("Authorization denied by user"))

		await expect(authenticateWithDeviceAuth()).rejects.toThrow("Authorization denied by user")
	})

	it("should handle expired authorization code", async () => {
		const mockInitiateResponse = {
			code: "ABC-123",
			verificationUrl: "https://app.kilocode.com/device-auth?code=ABC-123",
			expiresIn: 600,
		}

		vi.spyOn(globalThis, "fetch").mockImplementation(((url: string) => {
			if (url.includes("/api/device-auth/codes") && !url.match(/\/codes\/[^/]+$/)) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve(mockInitiateResponse),
				} as Response)
			}
			if (url.includes("/api/device-auth/codes/")) {
				return Promise.resolve({
					ok: false,
					status: 410,
					json: () => Promise.resolve({ status: "expired" }),
				} as Response)
			}
			return Promise.reject(new Error("Unexpected URL"))
		}) as unknown as typeof fetch)

		// Mock poll to immediately return the error
		vi.mocked(poll).mockRejectedValueOnce(new Error("Authorization code expired"))

		await expect(authenticateWithDeviceAuth()).rejects.toThrow("Authorization code expired")
	})
})
