// npx vitest run src/api/providers/__tests__/gemini-cli.spec.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import axios from "axios"
import type { ApiHandlerOptions } from "../../../shared/api"
import { GeminiCliHandler } from "../gemini-cli"

// Mock axios
vi.mock("axios", () => ({
	default: {
		get: vi.fn(),
	},
}))
const mockAxios = vi.mocked(axios)

// Mock fs/promises
vi.mock("fs/promises", () => ({
	readFile: vi.fn(),
	writeFile: vi.fn(),
}))

// Mock google-auth-library
vi.mock("google-auth-library", () => ({
	OAuth2Client: vi.fn().mockImplementation(() => ({
		setCredentials: vi.fn(),
		refreshAccessToken: vi.fn(),
		request: vi.fn(),
	})),
}))

// Mock dotenvx
vi.mock("@dotenvx/dotenvx", () => ({
	config: vi.fn().mockReturnValue({ parsed: null, error: null }),
}))

describe("GeminiCliHandler", () => {
	let handler: GeminiCliHandler
	let mockOptions: ApiHandlerOptions

	beforeEach(() => {
		vi.clearAllMocks()

		mockOptions = {
			apiModelId: "gemini-1.5-pro-latest",
			geminiCliOAuthPath: undefined,
			geminiCliProjectId: undefined,
		}
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("OAuth Config Fetching", () => {
		it("should initialize without fetching config immediately", () => {
			// Act
			handler = new GeminiCliHandler(mockOptions)

			// Assert - config should not be fetched during construction
			expect(mockAxios.get).not.toHaveBeenCalled()
			expect(handler["oauthClientId"]).toBeNull()
			expect(handler["oauthClientSecret"]).toBeNull()
		})

		it("should fetch OAuth config from API endpoint when fetchOAuthConfig is called", async () => {
			// Arrange
			const mockConfig = {
				geminiCli: {
					oauthClientId: "test-client-id",
					oauthClientSecret: "test-client-secret",
				},
			}

			;(mockAxios.get as any).mockResolvedValueOnce({ data: mockConfig })
			handler = new GeminiCliHandler(mockOptions)

			// Act
			await handler["fetchOAuthConfig"]()

			// Assert
			expect(mockAxios.get).toHaveBeenCalledWith("https://api.kilo.ai/extension-config.json")
			expect(handler["oauthClientId"]).toBe("test-client-id")
			expect(handler["oauthClientSecret"]).toBe("test-client-secret")
		})

		it("should throw error if OAuth config fetch fails", async () => {
			// Arrange
			const mockError = new Error("Network error")
			;(mockAxios.get as any).mockRejectedValueOnce(mockError)
			handler = new GeminiCliHandler(mockOptions)

			// Act & Assert
			await expect(handler["fetchOAuthConfig"]()).rejects.toThrow()
		})
	})

	// The loadOAuthCredentials integration with fetchOAuthConfig is tested through actual usage
	// Individual components (fetchOAuthConfig) are tested above
})
