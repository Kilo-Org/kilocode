import { describe, it, expect, beforeEach, vi } from "vitest"
import { NewAutocompleteModel } from "../NewAutocompleteModel"
import { ProviderSettings } from "@roo-code/types"
import Mistral from "../../../continuedev/core/llm/llms/Mistral"
import { OpenAI } from "../../../continuedev/core/llm/llms/OpenAI"

// Mock the LLM classes
vi.mock("../../../continuedev/core/llm/llms/Mistral")
vi.mock("../../../continuedev/core/llm/llms/OpenAI")

describe("NewAutocompleteModel", () => {
	let model: NewAutocompleteModel

	beforeEach(() => {
		model = new NewAutocompleteModel()
		vi.clearAllMocks()
	})

	describe("getILLM", () => {
		describe("Mistral provider", () => {
			it("should create Mistral instance with valid configuration", () => {
				// Set the profile on the model
				;(model as any).profile = {
					apiProvider: "mistral",
					mistralApiKey: "test-mistral-key",
					mistralCodestralUrl: "https://custom.mistral.ai/v1/",
				}

				const result = model.getILLM()

				expect(result).toBeDefined()
				expect(Mistral).toHaveBeenCalledWith(
					expect.objectContaining({
						model: "codestral-latest",
						apiKey: "test-mistral-key",
						apiBase: "https://custom.mistral.ai/v1/",
						contextLength: 32000,
					}),
				)
			})

			it("should use default Mistral URL when not provided", () => {
				;(model as any).profile = {
					apiProvider: "mistral",
					mistralApiKey: "test-mistral-key",
				}

				model.getILLM()

				expect(Mistral).toHaveBeenCalledWith(
					expect.objectContaining({
						apiBase: "https://codestral.mistral.ai/v1/",
					}),
				)
			})

			it("should return null when API key is missing", () => {
				;(model as any).profile = {
					apiProvider: "mistral",
				}

				const result = model.getILLM()

				expect(result).toBeNull()
				expect(Mistral).not.toHaveBeenCalled()
			})
		})

		describe("Kilocode provider", () => {
			it("should create OpenAI instance with valid Kilocode configuration", () => {
				;(model as any).profile = {
					apiProvider: "kilocode",
					kilocodeToken: "test-kilocode-token",
				}

				const result = model.getILLM()

				expect(result).toBeDefined()
				expect(OpenAI).toHaveBeenCalledWith(
					expect.objectContaining({
						model: "mistralai/codestral-2508",
						apiKey: "test-kilocode-token",
					}),
				)
			})

			it("should return null when Kilocode token is missing", () => {
				;(model as any).profile = {
					apiProvider: "kilocode",
				}

				const result = model.getILLM()

				expect(result).toBeNull()
				expect(OpenAI).not.toHaveBeenCalled()
			})
		})

		describe("OpenRouter provider", () => {
			it("should create OpenAI instance with valid OpenRouter configuration", () => {
				;(model as any).profile = {
					apiProvider: "openrouter",
					openRouterApiKey: "test-openrouter-key",
					openRouterBaseUrl: "https://custom.openrouter.ai/api/v1",
				}

				const result = model.getILLM()

				expect(result).toBeDefined()
				expect(OpenAI).toHaveBeenCalledWith(
					expect.objectContaining({
						model: "mistralai/codestral-2508",
						apiKey: "test-openrouter-key",
						apiBase: "https://custom.openrouter.ai/api/v1",
					}),
				)
			})

			it("should use default OpenRouter URL when not provided", () => {
				;(model as any).profile = {
					apiProvider: "openrouter",
					openRouterApiKey: "test-openrouter-key",
				}

				model.getILLM()

				expect(OpenAI).toHaveBeenCalledWith(
					expect.objectContaining({
						apiBase: "https://openrouter.ai/api/v1",
					}),
				)
			})

			it("should return null when API key is missing", () => {
				;(model as any).profile = {
					apiProvider: "openrouter",
				}

				const result = model.getILLM()

				expect(result).toBeNull()
				expect(OpenAI).not.toHaveBeenCalled()
			})
		})

		describe("Bedrock provider", () => {
			it("should return null as Bedrock is not yet supported", () => {
				;(model as any).profile = {
					apiProvider: "bedrock",
					awsAccessKey: "test-access-key",
					awsSecretKey: "test-secret-key",
					awsRegion: "us-east-1",
				}

				const result = model.getILLM()

				expect(result).toBeNull()
			})
		})

		describe("LLM options", () => {
			it("should set correct completion options for autocomplete", () => {
				;(model as any).profile = {
					apiProvider: "mistral",
					mistralApiKey: "test-key",
				}

				model.getILLM()

				expect(Mistral).toHaveBeenCalledWith(
					expect.objectContaining({
						completionOptions: expect.objectContaining({
							temperature: 0.2,
							maxTokens: 256,
						}),
					}),
				)
			})

			it("should set autocomplete options with cache disabled", () => {
				;(model as any).profile = {
					apiProvider: "mistral",
					mistralApiKey: "test-key",
				}

				model.getILLM()

				expect(Mistral).toHaveBeenCalledWith(
					expect.objectContaining({
						autocompleteOptions: expect.objectContaining({
							useCache: false,
						}),
					}),
				)
			})

			it("should generate unique ID with correct format", () => {
				;(model as any).profile = {
					apiProvider: "mistral",
					mistralApiKey: "test-key",
				}

				model.getILLM()
				const call = vi.mocked(Mistral).mock.calls[0][0]

				expect(call.uniqueId).toMatch(/^autocomplete-mistral-\d+$/)
				expect(call.uniqueId).toContain("autocomplete-mistral-")
			})
		})

		describe("Error handling", () => {
			it("should return null and log error when LLM instantiation fails", () => {
				const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
				vi.mocked(Mistral).mockImplementationOnce(() => {
					throw new Error("Instantiation failed")
				})
				;(model as any).profile = {
					apiProvider: "mistral",
					mistralApiKey: "test-key",
				}

				const result = model.getILLM()

				expect(result).toBeNull()
				expect(consoleErrorSpy).toHaveBeenCalledWith(
					expect.stringContaining("Error creating ILLM"),
					expect.any(Error),
				)

				consoleErrorSpy.mockRestore()
			})

			it("should return null when no profile is loaded", () => {
				const result = model.getILLM()

				expect(result).toBeNull()
			})
		})
	})
})
