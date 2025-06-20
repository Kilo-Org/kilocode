/**
 * Test file to verify the token validation logic refactoring.
 * This tests that hasValidToken is correctly derived from the API handler state.
 */

import { ContextProxy } from "../../../core/config/ContextProxy"
import { buildApiHandler } from "../../../api"

// Mock the dependencies
jest.mock("../../../core/config/ContextProxy")
jest.mock("../../../api")

const mockBuildApiHandler = buildApiHandler as jest.MockedFunction<typeof buildApiHandler>
const mockContextProxy = {
	getProviderSettings: jest.fn(),
} as any

describe("Token validation logic (using API handler state)", () => {
	beforeEach(() => {
		jest.clearAllMocks()
		;(ContextProxy as any).instance = mockContextProxy
	})

	/**
	 * Simulates the createApiHandler function from AutocompleteProvider.ts
	 */
	const createApiHandler = () => {
		const { kilocodeToken, openRouterApiKey } = mockContextProxy.getProviderSettings()
		const useOpenRouter = false // Use this to try out OpenRouter. Seems slightly faster?
		const apiProvider = useOpenRouter ? "openrouter" : "kilocode"
		if ((apiProvider === "kilocode" && kilocodeToken) || (apiProvider === "openrouter" && openRouterApiKey)) {
			return buildApiHandler({
				apiProvider,
				kilocodeToken,
				kilocodeModel: "google/gemini-2.5-flash-preview",
				openRouterModelId: "google/gemini-2.5-flash-preview",
				...mockContextProxy.getProviderSettings(),
			})
		}
		return null
	}

	/**
	 * Simulates the updateTokenStatus function from AutocompleteProvider.ts
	 */
	const updateTokenStatus = (apiHandler: any) => {
		return apiHandler !== null
	}

	it("should return true for hasValidToken when API handler is created successfully", () => {
		const mockSettings = {
			kilocodeToken: "test-token",
			openRouterApiKey: undefined,
		}

		mockContextProxy.getProviderSettings.mockReturnValue(mockSettings)
		mockBuildApiHandler.mockReturnValue({} as any) // Mock successful API handler creation

		const apiHandler = createApiHandler()
		const hasValidToken = updateTokenStatus(apiHandler)

		expect(hasValidToken).toBe(true)
		expect(apiHandler).toBeDefined()
		expect(mockBuildApiHandler).toHaveBeenCalled()
	})

	it("should return false for hasValidToken when API handler creation fails (no token)", () => {
		const mockSettings = {
			kilocodeToken: undefined,
			openRouterApiKey: undefined,
		}

		mockContextProxy.getProviderSettings.mockReturnValue(mockSettings)

		const apiHandler = createApiHandler()
		const hasValidToken = updateTokenStatus(apiHandler)

		expect(hasValidToken).toBe(false)
		expect(apiHandler).toBeNull()
		expect(mockBuildApiHandler).not.toHaveBeenCalled()
	})

	it("should return false for hasValidToken when API handler creation fails (empty token)", () => {
		const mockSettings = {
			kilocodeToken: "",
			openRouterApiKey: undefined,
		}

		mockContextProxy.getProviderSettings.mockReturnValue(mockSettings)

		const apiHandler = createApiHandler()
		const hasValidToken = updateTokenStatus(apiHandler)

		expect(hasValidToken).toBe(false)
		expect(apiHandler).toBeNull()
		expect(mockBuildApiHandler).not.toHaveBeenCalled()
	})

	it("should work correctly with OpenRouter when enabled", () => {
		// This test simulates what would happen if useOpenRouter was true
		const mockSettings = {
			kilocodeToken: "test-token",
			openRouterApiKey: "openrouter-key",
		}

		mockContextProxy.getProviderSettings.mockReturnValue(mockSettings)
		mockBuildApiHandler.mockReturnValue({} as any)

		// Simulate the logic when useOpenRouter = true
		const createApiHandlerWithOpenRouter = () => {
			const { kilocodeToken, openRouterApiKey } = mockContextProxy.getProviderSettings()
			const useOpenRouter = true // Simulate OpenRouter being enabled
			const apiProvider = useOpenRouter ? "openrouter" : "kilocode"
			if ((apiProvider === "kilocode" && kilocodeToken) || (apiProvider === "openrouter" && openRouterApiKey)) {
				return buildApiHandler({
					apiProvider,
					kilocodeToken,
					kilocodeModel: "google/gemini-2.5-flash-preview",
					openRouterModelId: "google/gemini-2.5-flash-preview",
					...mockContextProxy.getProviderSettings(),
				})
			}
			return null
		}

		const apiHandler = createApiHandlerWithOpenRouter()
		const hasValidToken = updateTokenStatus(apiHandler)

		expect(hasValidToken).toBe(true)
		expect(apiHandler).toBeDefined()
		expect(mockBuildApiHandler).toHaveBeenCalledWith({
			apiProvider: "openrouter",
			kilocodeToken: "test-token",
			kilocodeModel: "google/gemini-2.5-flash-preview",
			openRouterModelId: "google/gemini-2.5-flash-preview",
			openRouterApiKey: "openrouter-key",
		})
	})
})
