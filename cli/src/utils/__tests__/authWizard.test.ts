/**
 * Tests for auth wizard ZAI functionality
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import authWizard from "../authWizard"
import { loadConfig, saveConfig } from "../../config"
import * as zaiConstants from "../../constants/providers/zai"

// Mock inquirer
vi.mock("inquirer", () => ({
	default: {
		prompt: vi.fn(),
	},
}))

// Mock config functions
vi.mock("../../config", () => ({
	loadConfig: vi.fn(),
	saveConfig: vi.fn(),
}))

// Mock openConfigFile
vi.mock("../../config/openConfig", () => ({
	default: vi.fn(),
}))

// Mock wait
vi.mock("../../utils/wait", () => ({
	default: vi.fn(),
}))

// Mock console.info
const consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {})

const inquirer = await import("inquirer")
const mockLoadConfig = vi.mocked(loadConfig)
const mockSaveConfig = vi.mocked(saveConfig)

describe("auth wizard - ZAI provider", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("should collect all required ZAI fields successfully", async () => {
		// Mock loadConfig to return empty config
		mockLoadConfig.mockResolvedValue({
			config: {
				providers: [],
			},
		} as any)

		// Mock inquirer responses for ZAI provider selection and configuration
		const mockInquirerPrompt = vi.mocked(inquirer.default.prompt)

		// First call: provider selection
		// Second call: API token input
		// Third call: API line selection
		// Fourth call: model selection
		mockInquirerPrompt
			.mockResolvedValueOnce({ provider: "zai" })
			.mockResolvedValueOnce({ zaiApiKey: "test-api-key-12345" })
			.mockResolvedValueOnce({ zaiApiLine: "international_coding" })
			.mockResolvedValueOnce({ apiModelId: "glm-4.6" })

		// Mock saveConfig
		mockSaveConfig.mockResolvedValue()

		// Execute auth wizard
		await authWizard()

		// Verify provider selection
		expect(mockInquirerPrompt).toHaveBeenNthCalledWith(1, [
			expect.objectContaining({
				type: "list",
				name: "provider",
				message: "Please select which provider you would like to use:",
				choices: [
					{ name: "Kilo Code", value: "kilocode" },
					{ name: "zAI", value: "zai" },
					{ name: "Other", value: "other" },
				],
			}),
		])

		// Verify API token collection
		expect(mockInquirerPrompt).toHaveBeenNthCalledWith(2, [
			expect.objectContaining({
				type: "password",
				name: "zaiApiKey",
				message: "Please enter your ZAI API token:",
				validate: expect.any(Function),
			}),
		])

		// Verify API line selection
		expect(mockInquirerPrompt).toHaveBeenNthCalledWith(3, [
			expect.objectContaining({
				type: "list",
				name: "zaiApiLine",
				message: "Select your ZAI API line:",
				choices: expect.any(Array),
				default: "international_coding",
			}),
		])

		// Verify model selection
		expect(mockInquirerPrompt).toHaveBeenNthCalledWith(4, [
			expect.objectContaining({
				type: "list",
				name: "apiModelId",
				message: "Select your ZAI model:",
				choices: expect.any(Array),
				default: "glm-4.6",
			}),
		])

		// Verify saveConfig was called with all three required fields
		expect(mockSaveConfig).toHaveBeenCalledWith(
			expect.objectContaining({
				providers: [
					expect.objectContaining({
						id: "default",
						provider: "zai",
						zaiApiKey: "test-api-key-12345",
						zaiApiLine: "international_coding",
						apiModelId: "glm-4.6",
					}),
				],
			}),
		)

		// Verify informational message was displayed
		expect(consoleInfoSpy).toHaveBeenCalledWith(
			"\nConfigure ZAI provider with API token, API line, and model selection.\n",
		)
	})

	it("should validate API token input", async () => {
		// Mock loadConfig
		mockLoadConfig.mockResolvedValue({
			config: { providers: [] },
		} as any)

		const mockInquirerPrompt = vi.mocked(inquirer.default.prompt)

		// Test validation function
		let validateFunction: ((input: string) => string | boolean) | undefined
		mockInquirerPrompt.mockImplementation((questions: any) => {
			if (Array.isArray(questions) && questions[0]?.name === "zaiApiKey") {
				validateFunction = questions[0].validate
			}
			return Promise.resolve({})
		})

		// Mock first call to provider selection
		mockInquirerPrompt.mockResolvedValueOnce({ provider: "zai" })

		// Start auth wizard (but we won't complete it)
		const authWizardPromise = authWizard()

		// Wait for the validation function to be captured
		await new Promise((resolve) => setTimeout(resolve, 0))

		// Test validation function
		expect(validateFunction).toBeDefined()

		if (validateFunction) {
			// Test empty input
			expect(validateFunction("")).toBe("API token is required")
			expect(validateFunction("   ")).toBe("API token is required")

			// Test valid input
			expect(validateFunction("valid-token")).toBe(true)
		}

		// Cancel the auth wizard
		authWizardPromise.catch(() => {})
	})

	it("should use correct default values", async () => {
		// Mock loadConfig
		mockLoadConfig.mockResolvedValue({
			config: { providers: [] },
		} as any)

		const mockInquirerPrompt = vi.mocked(inquirer.default.prompt)

		// Mock provider selection and accept defaults for subsequent prompts
		mockInquirerPrompt
			.mockResolvedValueOnce({ provider: "zai" })
			.mockResolvedValueOnce({ zaiApiKey: "test-key" })
			.mockResolvedValueOnce({}) // Accept API line default
			.mockResolvedValueOnce({}) // Accept model default

		mockSaveConfig.mockResolvedValue()

		await authWizard()

		// Verify that defaults were passed to inquirer
		expect(mockInquirerPrompt).toHaveBeenNthCalledWith(3, [
			expect.objectContaining({
				default: "international_coding",
			}),
		])

		expect(mockInquirerPrompt).toHaveBeenNthCalledWith(4, [
			expect.objectContaining({
				default: "glm-4.6",
			}),
		])
	})

	it("should work with China API line selection", async () => {
		// Mock loadConfig
		mockLoadConfig.mockResolvedValue({
			config: { providers: [] },
		} as any)

		const mockInquirerPrompt = vi.mocked(inquirer.default.prompt)

		mockInquirerPrompt
			.mockResolvedValueOnce({ provider: "zai" })
			.mockResolvedValueOnce({ zaiApiKey: "test-key" })
			.mockResolvedValueOnce({ zaiApiLine: "china_coding" })
			.mockResolvedValueOnce({ apiModelId: "glm-4.5-air" })

		mockSaveConfig.mockResolvedValue()

		await authWizard()

		// Verify saveConfig was called with China API line
		expect(mockSaveConfig).toHaveBeenCalledWith(
			expect.objectContaining({
				providers: [
					expect.objectContaining({
						zaiApiLine: "china_coding",
						apiModelId: "glm-4.5-air",
					}),
				],
			}),
		)
	})

	it("should have ZAI constants properly configured", () => {
		// Test that the ZAI constants are properly configured
		expect(zaiConstants.ZAI_DEFAULTS.apiLine).toBe("international_coding")
		expect(zaiConstants.ZAI_DEFAULTS.model).toBe("glm-4.6")
		expect(zaiConstants.ZAI_API_LINES).toHaveLength(2)
		expect(zaiConstants.ZAI_MODELS).toHaveLength(4)
	})
})
