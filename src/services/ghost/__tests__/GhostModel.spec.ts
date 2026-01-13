import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { GhostModel } from "../GhostModel"
import { ProviderSettingsManager } from "../../../core/config/ProviderSettingsManager"
import { AUTOCOMPLETE_PROVIDER_MODELS } from "../utils/kilocode-utils"
import * as apiIndex from "../../../api"
import { TelemetryService } from "../../../../packages/telemetry/src/TelemetryService"

describe("GhostModel", () => {
	let mockProviderSettingsManager: ProviderSettingsManager

	beforeEach(() => {
		mockProviderSettingsManager = {
			listConfig: vi.fn(),
			getProfile: vi.fn(),
		} as any
	})

	describe("reload", () => {
		it("sorts profiles by supportedProviders index order", async () => {
			const supportedProviders = [...AUTOCOMPLETE_PROVIDER_MODELS.keys()]
			const profiles = [
				{ id: "3", name: "profile3", apiProvider: supportedProviders[2] },
				{ id: "1", name: "profile1", apiProvider: supportedProviders[0] },
				{ id: "2", name: "profile2", apiProvider: supportedProviders[1] },
			] as any

			vi.mocked(mockProviderSettingsManager.listConfig).mockResolvedValue(profiles)
			vi.mocked(mockProviderSettingsManager.getProfile).mockResolvedValue({
				id: "1",
				name: "profile1",
				apiProvider: supportedProviders[0],
				mistralApiKey: "test-key",
			} as any)

			const model = new GhostModel()
			await model.reload(mockProviderSettingsManager)

			expect(mockProviderSettingsManager.getProfile).toHaveBeenCalledWith({ id: "1" })
		})

		it("filters out profiles without apiProvider", async () => {
			const supportedProviders = [...AUTOCOMPLETE_PROVIDER_MODELS.keys()]
			const profiles = [
				{ id: "1", name: "profile1", apiProvider: undefined },
				{ id: "2", name: "profile2", apiProvider: supportedProviders[0] },
			] as any

			vi.mocked(mockProviderSettingsManager.listConfig).mockResolvedValue(profiles)
			vi.mocked(mockProviderSettingsManager.getProfile).mockResolvedValue({
				id: "2",
				name: "profile2",
				apiProvider: supportedProviders[0],
				mistralApiKey: "test-key",
			} as any)

			const model = new GhostModel()
			await model.reload(mockProviderSettingsManager)

			expect(mockProviderSettingsManager.getProfile).toHaveBeenCalledWith({ id: "2" })
		})

		it("filters out profiles with unsupported apiProvider", async () => {
			const supportedProviders = [...AUTOCOMPLETE_PROVIDER_MODELS.keys()]
			const profiles = [
				{ id: "1", name: "profile1", apiProvider: "unsupported" },
				{ id: "2", name: "profile2", apiProvider: supportedProviders[0] },
			] as any

			vi.mocked(mockProviderSettingsManager.listConfig).mockResolvedValue(profiles)
			vi.mocked(mockProviderSettingsManager.getProfile).mockResolvedValue({
				id: "2",
				name: "profile2",
				apiProvider: supportedProviders[0],
				mistralApiKey: "test-key",
			} as any)

			const model = new GhostModel()
			await model.reload(mockProviderSettingsManager)

			expect(mockProviderSettingsManager.getProfile).toHaveBeenCalledWith({ id: "2" })
		})

		it("handles empty profile list", async () => {
			vi.mocked(mockProviderSettingsManager.listConfig).mockResolvedValue([])

			const model = new GhostModel()
			const result = await model.reload(mockProviderSettingsManager)

			expect(mockProviderSettingsManager.getProfile).not.toHaveBeenCalled()
			expect(model.hasValidCredentials()).toBe(false)
			expect(result).toBe(false)
		})

		it("returns true when profile found", async () => {
			const supportedProviders = [...AUTOCOMPLETE_PROVIDER_MODELS.keys()]
			const profiles = [{ id: "1", name: "mistral-profile", apiProvider: "mistral" }] as any

			vi.mocked(mockProviderSettingsManager.listConfig).mockResolvedValue(profiles)
			vi.mocked(mockProviderSettingsManager.getProfile).mockResolvedValue({
				id: "1",
				name: "mistral-profile",
				apiProvider: "mistral",
				mistralApiKey: "test-key",
			} as any)

			const model = new GhostModel()
			const result = await model.reload(mockProviderSettingsManager)

			expect(result).toBe(true)
			expect(model.loaded).toBe(true)
		})
	})

	describe("provider usability", () => {
		beforeEach(() => {
			// Mock fetch globally for these tests
			vi.stubGlobal("fetch", vi.fn())

			// Mock TelemetryService
			const mockTelemetryService = {
				captureEvent: vi.fn(),
				captureException: vi.fn(),
				isTelemetryEnabled: vi.fn().mockReturnValue(false),
				shutdown: vi.fn(),
			}
			vi.spyOn(TelemetryService, "hasInstance").mockReturnValue(true)
			vi.spyOn(TelemetryService, "instance", "get").mockReturnValue(mockTelemetryService as any)
		})

		afterEach(() => {
			// Restore fetch
			vi.unstubAllGlobals()

			// Restore TelemetryService mocks
			vi.restoreAllMocks()
		})

		it("should skip kilocode provider when balance is zero and use openrouter instead", async () => {
			const profiles = [
				{ id: "1", name: "kilocode-profile", apiProvider: "kilocode" },
				{ id: "2", name: "openrouter-profile", apiProvider: "openrouter" },
			] as any

			vi.mocked(mockProviderSettingsManager.listConfig).mockResolvedValue(profiles)

			// Mock profiles with tokens
			vi.mocked(mockProviderSettingsManager.getProfile).mockImplementation(async (args: any) => {
				if (args.id === "1") {
					return {
						id: "1",
						name: "kilocode-profile",
						apiProvider: "kilocode",
						kilocodeToken: "test-token",
					} as any
				} else if (args.id === "2") {
					return {
						id: "2",
						name: "openrouter-profile",
						apiProvider: "openrouter",
						openRouterApiKey: "test-key",
					} as any
				}
				return null as any
			})

			// Mock fetch to return zero balance for kilocode
			;(global.fetch as any).mockImplementation(async (url: string) => {
				if (url.includes("/api/profile/balance")) {
					return {
						ok: true,
						json: async () => ({ data: { balance: 0 } }),
					} as any
				}
				// For OpenRouter models endpoint
				if (url.includes("/models")) {
					return {
						ok: true,
						json: async () => ({ data: [] }),
					} as any
				}
				// For other URLs, return a basic response
				return {
					ok: true,
					json: async () => ({}),
				} as any
			})

			const model = new GhostModel()
			const result = await model.reload(mockProviderSettingsManager)

			// Should have tried both providers but used openrouter (since kilocode balance is 0)
			expect(result).toBe(true)
			expect(model.loaded).toBe(true)
		})

		it("should use kilocode provider when balance is greater than zero", async () => {
			const profiles = [
				{ id: "1", name: "kilocode-profile", apiProvider: "kilocode" },
				{ id: "2", name: "openrouter-profile", apiProvider: "openrouter" },
			] as any

			vi.mocked(mockProviderSettingsManager.listConfig).mockResolvedValue(profiles)

			// Mock profiles with tokens
			vi.mocked(mockProviderSettingsManager.getProfile).mockImplementation(async (args: any) => {
				if (args.id === "1") {
					return {
						id: "1",
						name: "kilocode-profile",
						apiProvider: "kilocode",
						kilocodeToken: "test-token",
					} as any
				} else if (args.id === "2") {
					return {
						id: "2",
						name: "openrouter-profile",
						apiProvider: "openrouter",
						openRouterApiKey: "test-key",
					} as any
				}
				return null as any
			})

			// Mock fetch to return positive balance for kilocode
			;(global.fetch as any).mockImplementation(async (url: string) => {
				if (url.includes("/api/profile/balance")) {
					return {
						ok: true,
						json: async () => ({ data: { balance: 10.5 } }),
					} as any
				}
				// For OpenRouter models endpoint
				if (url.includes("/models")) {
					return {
						ok: true,
						json: async () => ({ data: [] }),
					} as any
				}
				// For other URLs, return a basic response
				return {
					ok: true,
					json: async () => ({}),
				} as any
			})

			const model = new GhostModel()
			const result = await model.reload(mockProviderSettingsManager)

			// Should have used kilocode provider (first one with positive balance)
			expect(result).toBe(true)
			expect(model.loaded).toBe(true)
		})

		it("should handle kilocode provider with no token", async () => {
			const profiles = [
				{ id: "1", name: "kilocode-profile", apiProvider: "kilocode" },
				{ id: "2", name: "openrouter-profile", apiProvider: "openrouter" },
			] as any

			vi.mocked(mockProviderSettingsManager.listConfig).mockResolvedValue(profiles)

			// Mock profiles - kilocode without token
			vi.mocked(mockProviderSettingsManager.getProfile).mockImplementation(async (args: any) => {
				if (args.id === "1") {
					return {
						id: "1",
						name: "kilocode-profile",
						apiProvider: "kilocode",
						kilocodeToken: "", // No token
					} as any
				} else if (args.id === "2") {
					return {
						id: "2",
						name: "openrouter-profile",
						apiProvider: "openrouter",
						openRouterApiKey: "test-key",
					} as any
				}
				return null as any
			})

			// Mock fetch to handle the no-token case
			;(global.fetch as any).mockImplementation(async (url: string) => {
				if (url.includes("/api/profile/balance")) {
					// This should not be called since there's no token
					return {
						ok: false,
						status: 401,
					} as any
				}
				// For OpenRouter models endpoint
				if (url.includes("/models")) {
					return {
						ok: true,
						json: async () => ({ data: [] }),
					} as any
				}
				// For other URLs, return a basic response
				return {
					ok: true,
					json: async () => ({}),
				} as any
			})

			const model = new GhostModel()
			const result = await model.reload(mockProviderSettingsManager)

			// Should skip kilocode (no token) and use openrouter
			expect(result).toBe(true)
			expect(model.loaded).toBe(true)
		})

		it("should set hasKilocodeProfileWithNoBalance when kilocode profile exists but has no balance", async () => {
			const profiles = [{ id: "1", name: "kilocode-profile", apiProvider: "kilocode" }] as any

			vi.mocked(mockProviderSettingsManager.listConfig).mockResolvedValue(profiles)

			// Mock profile with token
			vi.mocked(mockProviderSettingsManager.getProfile).mockResolvedValue({
				id: "1",
				name: "kilocode-profile",
				apiProvider: "kilocode",
				kilocodeToken: "test-token",
			} as any)

			// Mock fetch to return zero balance for kilocode
			;(global.fetch as any).mockImplementation(async (url: string) => {
				if (url.includes("/api/profile/balance")) {
					return {
						ok: true,
						json: async () => ({ balance: 0 }),
					} as any
				}
				return {
					ok: true,
					json: async () => ({}),
				} as any
			})

			const model = new GhostModel()
			const result = await model.reload(mockProviderSettingsManager)

			// Should not find a usable provider
			expect(result).toBe(false)
			expect(model.loaded).toBe(true)
			// Should have set the flag indicating kilocode profile exists but has no balance
			expect(model.hasKilocodeProfileWithNoBalance).toBe(true)
		})

		it("should not set hasKilocodeProfileWithNoBalance when kilocode profile has balance", async () => {
			const profiles = [{ id: "1", name: "kilocode-profile", apiProvider: "kilocode" }] as any

			vi.mocked(mockProviderSettingsManager.listConfig).mockResolvedValue(profiles)

			// Mock profile with token
			vi.mocked(mockProviderSettingsManager.getProfile).mockResolvedValue({
				id: "1",
				name: "kilocode-profile",
				apiProvider: "kilocode",
				kilocodeToken: "test-token",
			} as any)

			// Mock fetch to return positive balance for kilocode and valid models response
			;(global.fetch as any).mockImplementation(async (url: string) => {
				if (url.includes("/api/profile/balance")) {
					return {
						ok: true,
						json: async () => ({ balance: 10.5 }),
					} as any
				}
				// For OpenRouter/Kilocode models endpoint
				if (url.includes("/models")) {
					return {
						ok: true,
						json: async () => ({
							data: [
								{
									id: "mistralai/codestral-2508",
									name: "Codestral",
									context_length: 32000,
									pricing: { prompt: "0.0001", completion: "0.0003" },
								},
							],
						}),
					} as any
				}
				return {
					ok: true,
					json: async () => ({}),
				} as any
			})

			const model = new GhostModel()
			const result = await model.reload(mockProviderSettingsManager)

			// Should find a usable provider
			expect(result).toBe(true)
			expect(model.loaded).toBe(true)
			// Should not have set the flag
			expect(model.hasKilocodeProfileWithNoBalance).toBe(false)
		})

		it("should clear hasKilocodeProfileWithNoBalance on reload", async () => {
			const profiles = [{ id: "1", name: "kilocode-profile", apiProvider: "kilocode" }] as any

			vi.mocked(mockProviderSettingsManager.listConfig).mockResolvedValue(profiles)

			// Mock profile with token
			vi.mocked(mockProviderSettingsManager.getProfile).mockResolvedValue({
				id: "1",
				name: "kilocode-profile",
				apiProvider: "kilocode",
				kilocodeToken: "test-token",
			} as any)

			// First reload: zero balance
			;(global.fetch as any).mockImplementation(async (url: string) => {
				if (url.includes("/api/profile/balance")) {
					return {
						ok: true,
						json: async () => ({ balance: 0 }),
					} as any
				}
				return {
					ok: true,
					json: async () => ({}),
				} as any
			})

			const model = new GhostModel()
			await model.reload(mockProviderSettingsManager)
			expect(model.hasKilocodeProfileWithNoBalance).toBe(true)

			// Second reload: positive balance with valid models response
			;(global.fetch as any).mockImplementation(async (url: string) => {
				if (url.includes("/api/profile/balance")) {
					return {
						ok: true,
						json: async () => ({ balance: 10.5 }),
					} as any
				}
				// For OpenRouter/Kilocode models endpoint
				if (url.includes("/models")) {
					return {
						ok: true,
						json: async () => ({
							data: [
								{
									id: "mistralai/codestral-2508",
									name: "Codestral",
									context_length: 32000,
									pricing: { prompt: "0.0001", completion: "0.0003" },
								},
							],
						}),
					} as any
				}
				return {
					ok: true,
					json: async () => ({}),
				} as any
			})

			await model.reload(mockProviderSettingsManager)
			// Flag should be cleared after reload with positive balance
			expect(model.hasKilocodeProfileWithNoBalance).toBe(false)
		})
	})

	describe("getProviderDisplayName", () => {
		it("returns undefined when no provider is loaded", () => {
			const model = new GhostModel()
			expect(model.getProviderDisplayName()).toBeUndefined()
		})

		it("returns provider name from API handler when provider is loaded", async () => {
			const supportedProviders = [...AUTOCOMPLETE_PROVIDER_MODELS.keys()]
			const profiles = [{ id: "1", name: "profile1", apiProvider: supportedProviders[0] }] as any

			vi.mocked(mockProviderSettingsManager.listConfig).mockResolvedValue(profiles)
			vi.mocked(mockProviderSettingsManager.getProfile).mockResolvedValue({
				id: "1",
				name: "profile1",
				apiProvider: supportedProviders[0],
				mistralApiKey: "test-key",
			} as any)

			// Mock buildApiHandler to return a handler with providerName
			const mockApiHandler = {
				providerName: "Mistral",
				getModel: vi.fn().mockReturnValue({ id: "mistral-model", info: {} }),
				createMessage: vi.fn(),
				countTokens: vi.fn(),
			}
			vi.spyOn(apiIndex, "buildApiHandler").mockReturnValue(mockApiHandler as any)

			const model = new GhostModel()
			await model.reload(mockProviderSettingsManager)

			const providerName = model.getProviderDisplayName()
			expect(providerName).toBeTruthy()
			expect(typeof providerName).toBe("string")
			expect(providerName).toBe("Mistral")

			// Restore the spy
			vi.restoreAllMocks()
		})

		describe("profile information", () => {
			it("returns null for profile name when no profile is loaded", () => {
				const model = new GhostModel()
				expect(model.profileName).toBeNull()
			})

			it("returns null for profile type when no profile is loaded", () => {
				const model = new GhostModel()
				expect(model.profileType).toBeNull()
			})

			it("stores and returns profile name after loading", async () => {
				const supportedProviders = [...AUTOCOMPLETE_PROVIDER_MODELS.keys()]
				const profiles = [
					{
						id: "1",
						name: "My Autocomplete Profile",
						apiProvider: supportedProviders[0],
						profileType: "autocomplete",
					},
				] as any

				vi.mocked(mockProviderSettingsManager.listConfig).mockResolvedValue(profiles)
				vi.mocked(mockProviderSettingsManager.getProfile).mockResolvedValue({
					id: "1",
					name: "My Autocomplete Profile",
					apiProvider: supportedProviders[0],
					profileType: "autocomplete",
					mistralApiKey: "test-key",
				} as any)

				const model = new GhostModel()
				await model.reload(mockProviderSettingsManager)

				expect(model.profileName).toBe("My Autocomplete Profile")
			})

			it("stores and returns profile type after loading", async () => {
				const supportedProviders = [...AUTOCOMPLETE_PROVIDER_MODELS.keys()]
				const profiles = [
					{ id: "1", name: "My Profile", apiProvider: supportedProviders[0], profileType: "autocomplete" },
				] as any

				vi.mocked(mockProviderSettingsManager.listConfig).mockResolvedValue(profiles)
				vi.mocked(mockProviderSettingsManager.getProfile).mockResolvedValue({
					id: "1",
					name: "My Profile",
					apiProvider: supportedProviders[0],
					profileType: "autocomplete",
					mistralApiKey: "test-key",
				} as any)

				const model = new GhostModel()
				await model.reload(mockProviderSettingsManager)

				expect(model.profileType).toBe("autocomplete")
			})

			it("clears profile information on cleanup", async () => {
				const supportedProviders = [...AUTOCOMPLETE_PROVIDER_MODELS.keys()]
				const profiles = [
					{ id: "1", name: "My Profile", apiProvider: supportedProviders[0], profileType: "autocomplete" },
				] as any

				vi.mocked(mockProviderSettingsManager.listConfig).mockResolvedValue(profiles)
				vi.mocked(mockProviderSettingsManager.getProfile).mockResolvedValue({
					id: "1",
					name: "My Profile",
					apiProvider: supportedProviders[0],
					profileType: "autocomplete",
					mistralApiKey: "test-key",
				} as any)

				const model = new GhostModel()
				await model.reload(mockProviderSettingsManager)

				expect(model.profileName).toBe("My Profile")
				expect(model.profileType).toBe("autocomplete")

				// Reload with empty profiles to trigger cleanup
				vi.mocked(mockProviderSettingsManager.listConfig).mockResolvedValue([])
				await model.reload(mockProviderSettingsManager)

				expect(model.profileName).toBeNull()
				expect(model.profileType).toBeNull()
			})
		})
	})

	describe("reload model override behavior", () => {
		beforeEach(() => {
			// Mock buildApiHandler to return a handler with getModel
			const mockApiHandler = {
				getModel: vi.fn().mockReturnValue({ id: "test-model", info: {} }),
				createMessage: vi.fn(),
				countTokens: vi.fn(),
			}
			vi.spyOn(apiIndex, "buildApiHandler").mockReturnValue(mockApiHandler as any)
		})

		afterEach(() => {
			vi.restoreAllMocks()
		})

		it("should use custom model for explicit autocomplete profiles", async () => {
			const supportedProviders = [...AUTOCOMPLETE_PROVIDER_MODELS.keys()]
			const provider = supportedProviders[0]
			const customModelId = "custom-autocomplete-model"

			const profiles = [
				{
					id: "1",
					name: "My Autocomplete Profile",
					apiProvider: provider,
					profileType: "autocomplete",
				},
			] as any

			vi.mocked(mockProviderSettingsManager.listConfig).mockResolvedValue(profiles)
			vi.mocked(mockProviderSettingsManager.getProfile).mockResolvedValue({
				id: "1",
				name: "My Autocomplete Profile",
				apiProvider: provider,
				profileType: "autocomplete",
				mistralApiKey: "test-key",
				apiModelId: customModelId, // Custom model set by user
			} as any)

			// Mock buildApiHandler to return the custom model
			const mockApiHandler = {
				getModel: vi.fn().mockReturnValue({ id: customModelId, info: {} }),
				createMessage: vi.fn(),
				countTokens: vi.fn(),
			}
			vi.spyOn(apiIndex, "buildApiHandler").mockReturnValue(mockApiHandler as any)

			const model = new GhostModel()
			await model.reload(mockProviderSettingsManager)

			// The model should use the custom model from the profile
			const modelName = model.getModelName()
			expect(modelName).toBe(customModelId)
		})

		it("should override model for non-autocomplete profiles", async () => {
			const supportedProviders = [...AUTOCOMPLETE_PROVIDER_MODELS.keys()]
			const provider = supportedProviders[0]
			const defaultAutocompleteModel = AUTOCOMPLETE_PROVIDER_MODELS.get(provider)

			const profiles = [
				{
					id: "1",
					name: "My Chat Profile",
					apiProvider: provider,
					profileType: "chat", // Not an autocomplete profile
				},
			] as any

			vi.mocked(mockProviderSettingsManager.listConfig).mockResolvedValue(profiles)
			vi.mocked(mockProviderSettingsManager.getProfile).mockResolvedValue({
				id: "1",
				name: "My Chat Profile",
				apiProvider: provider,
				profileType: "chat",
				mistralApiKey: "test-key",
				apiModelId: "custom-chat-model", // This should be overridden
			} as any)

			// Mock buildApiHandler to return the overridden model
			const mockApiHandler = {
				getModel: vi.fn().mockReturnValue({ id: defaultAutocompleteModel, info: {} }),
				createMessage: vi.fn(),
				countTokens: vi.fn(),
			}
			vi.spyOn(apiIndex, "buildApiHandler").mockReturnValue(mockApiHandler as any)

			const model = new GhostModel()
			await model.reload(mockProviderSettingsManager)

			// The model should be overridden with the default autocomplete model
			const modelName = model.getModelName()
			expect(modelName).toBe(defaultAutocompleteModel)
		})

		it("should override model for profiles without profileType", async () => {
			const supportedProviders = [...AUTOCOMPLETE_PROVIDER_MODELS.keys()]
			const provider = supportedProviders[0]
			const defaultAutocompleteModel = AUTOCOMPLETE_PROVIDER_MODELS.get(provider)

			const profiles = [
				{
					id: "1",
					name: "My Generic Profile",
					apiProvider: provider,
					// No profileType specified
				},
			] as any

			vi.mocked(mockProviderSettingsManager.listConfig).mockResolvedValue(profiles)
			vi.mocked(mockProviderSettingsManager.getProfile).mockResolvedValue({
				id: "1",
				name: "My Generic Profile",
				apiProvider: provider,
				mistralApiKey: "test-key",
				apiModelId: "custom-model", // This should be overridden
			} as any)

			// Mock buildApiHandler to return the overridden model
			const mockApiHandler = {
				getModel: vi.fn().mockReturnValue({ id: defaultAutocompleteModel, info: {} }),
				createMessage: vi.fn(),
				countTokens: vi.fn(),
			}
			vi.spyOn(apiIndex, "buildApiHandler").mockReturnValue(mockApiHandler as any)

			const model = new GhostModel()
			await model.reload(mockProviderSettingsManager)

			// The model should be overridden with the default autocomplete model
			const modelName = model.getModelName()
			expect(modelName).toBe(defaultAutocompleteModel)
		})
	})
})
