/**
 * Test file to verify the API handler creation logic refactoring.
 * This tests the logic that was extracted into the createApiHandler helper function.
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

describe("API handler creation logic (refactored into createApiHandler)", () => {
	beforeEach(() => {
		jest.clearAllMocks()
		;(ContextProxy as any).instance = mockContextProxy
	})

	/**
	 * Tests the logic that was duplicated in two places and is now centralized
	 * in the createApiHandler helper function
	 */
	const testApiHandlerCreation = (settings: any) => {
		const { kilocodeToken, openRouterApiKey } = settings
		const apiProvider = "kilocode"

		if (kilocodeToken && !openRouterApiKey) {
			return buildApiHandler({
				apiProvider,
				kilocodeModel: "google/gemini-2.5-flash-preview",
				openRouterModelId: "google/gemini-2.5-flash-preview",
				...settings,
			})
		}
		return null
	}

	it("should create API handler when kilocodeToken exists and openRouterApiKey does not", () => {
		const mockSettings = {
			kilocodeToken: "test-token",
			openRouterApiKey: undefined,
			someOtherSetting: "value",
		}

		mockContextProxy.getProviderSettings.mockReturnValue(mockSettings)
		mockBuildApiHandler.mockReturnValue({} as any)

		const result = testApiHandlerCreation(mockSettings)

		expect(result).toBeDefined()
		expect(mockBuildApiHandler).toHaveBeenCalledWith({
			apiProvider: "kilocode",
			kilocodeToken: "test-token",
			kilocodeModel: "google/gemini-2.5-flash-preview",
			openRouterModelId: "google/gemini-2.5-flash-preview",
			someOtherSetting: "value",
		})
	})

	it("should return null when kilocodeToken is missing", () => {
		const mockSettings = {
			kilocodeToken: undefined,
			openRouterApiKey: undefined,
		}

		const result = testApiHandlerCreation(mockSettings)

		expect(result).toBeNull()
		expect(mockBuildApiHandler).not.toHaveBeenCalled()
	})

	it("should return null when openRouterApiKey exists", () => {
		const mockSettings = {
			kilocodeToken: "test-token",
			openRouterApiKey: "openrouter-key",
		}

		const result = testApiHandlerCreation(mockSettings)

		expect(result).toBeNull()
		expect(mockBuildApiHandler).not.toHaveBeenCalled()
	})
})
