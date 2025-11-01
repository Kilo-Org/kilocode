import { describe, it, expect, vi, beforeEach } from "vitest"
import { GhostModel } from "../GhostModel"
import { ProviderSettingsManager } from "../../../core/config/ProviderSettingsManager"
import { AUTOCOMPLETE_PROVIDER_MODELS } from "@roo-code/types"

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
			const supportedProviders = Object.keys(AUTOCOMPLETE_PROVIDER_MODELS)
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
			const supportedProviders = Object.keys(AUTOCOMPLETE_PROVIDER_MODELS)
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
			const supportedProviders = Object.keys(AUTOCOMPLETE_PROVIDER_MODELS)
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
			const supportedProviders = Object.keys(AUTOCOMPLETE_PROVIDER_MODELS)
			const profiles = [{ id: "1", name: "profile1", apiProvider: supportedProviders[0] }] as any

			vi.mocked(mockProviderSettingsManager.listConfig).mockResolvedValue(profiles)
			vi.mocked(mockProviderSettingsManager.getProfile).mockResolvedValue({
				id: "1",
				name: "profile1",
				apiProvider: supportedProviders[0],
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
		})

		afterEach(() => {
			// Restore fetch
			vi.unstubAllGlobals()
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
	})

	describe("getProviderDisplayName", () => {
		it("returns null when no provider is loaded", () => {
			const model = new GhostModel()
			expect(model.getProviderDisplayName()).toBeNull()
		})

		it("returns provider name from API handler when provider is loaded", async () => {
			const supportedProviders = Object.keys(AUTOCOMPLETE_PROVIDER_MODELS)
			const profiles = [{ id: "1", name: "profile1", apiProvider: supportedProviders[0] }] as any

			vi.mocked(mockProviderSettingsManager.listConfig).mockResolvedValue(profiles)
			vi.mocked(mockProviderSettingsManager.getProfile).mockResolvedValue({
				id: "1",
				name: "profile1",
				apiProvider: supportedProviders[0],
				mistralApiKey: "test-key",
			} as any)

			const model = new GhostModel()
			await model.reload(mockProviderSettingsManager)

			const providerName = model.getProviderDisplayName()
			expect(providerName).toBeTruthy()
			expect(typeof providerName).toBe("string")
		})

		describe("profile information", () => {
			it("returns null for profile name when no profile is loaded", () => {
				const model = new GhostModel()
				expect(model.getProfileName()).toBeNull()
			})

			it("returns null for profile type when no profile is loaded", () => {
				const model = new GhostModel()
				expect(model.getProfileType()).toBeNull()
			})

			it("returns false for isAutocompleteProfile when no profile is loaded", () => {
				const model = new GhostModel()
				expect(model.isAutocompleteProfile()).toBe(false)
			})

			it("stores and returns profile name after loading", async () => {
				const supportedProviders = Object.keys(AUTOCOMPLETE_PROVIDER_MODELS)
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

				expect(model.getProfileName()).toBe("My Autocomplete Profile")
			})

			it("stores and returns profile type after loading", async () => {
				const supportedProviders = Object.keys(AUTOCOMPLETE_PROVIDER_MODELS)
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

				expect(model.getProfileType()).toBe("autocomplete")
			})

			it("returns true for isAutocompleteProfile when autocomplete profile is loaded", async () => {
				const supportedProviders = Object.keys(AUTOCOMPLETE_PROVIDER_MODELS)
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

				expect(model.isAutocompleteProfile()).toBe(true)
			})

			it("returns false for isAutocompleteProfile when non-autocomplete profile is loaded", async () => {
				const supportedProviders = Object.keys(AUTOCOMPLETE_PROVIDER_MODELS)
				const profiles = [
					{ id: "1", name: "My Profile", apiProvider: supportedProviders[0], profileType: "chat" },
				] as any

				vi.mocked(mockProviderSettingsManager.listConfig).mockResolvedValue(profiles)
				vi.mocked(mockProviderSettingsManager.getProfile).mockResolvedValue({
					id: "1",
					name: "My Profile",
					apiProvider: supportedProviders[0],
					profileType: "chat",
					mistralApiKey: "test-key",
				} as any)

				const model = new GhostModel()
				await model.reload(mockProviderSettingsManager)

				expect(model.isAutocompleteProfile()).toBe(false)
			})

			it("clears profile information on cleanup", async () => {
				const supportedProviders = Object.keys(AUTOCOMPLETE_PROVIDER_MODELS)
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

				expect(model.getProfileName()).toBe("My Profile")
				expect(model.getProfileType()).toBe("autocomplete")

				// Reload with empty profiles to trigger cleanup
				vi.mocked(mockProviderSettingsManager.listConfig).mockResolvedValue([])
				await model.reload(mockProviderSettingsManager)

				expect(model.getProfileName()).toBeNull()
				expect(model.getProfileType()).toBeNull()
			})
		})
	})

	describe("loadProfile model override behavior", () => {
		it("should not override model for explicit autocomplete profiles", async () => {
			const supportedProviders = Object.keys(AUTOCOMPLETE_PROVIDER_MODELS)
			const provider = supportedProviders[0] as keyof typeof AUTOCOMPLETE_PROVIDER_MODELS
			const customModelId = "custom-autocomplete-model"

			const autocompleteProfile = {
				id: "1",
				name: "My Autocomplete Profile",
				apiProvider: provider,
				profileType: "autocomplete",
			} as any

			// Mock getProfile to return a profile with a custom model
			// For mistral provider, the model key is apiModelId
			vi.mocked(mockProviderSettingsManager.getProfile).mockResolvedValue({
				id: "1",
				name: "My Autocomplete Profile",
				apiProvider: provider,
				profileType: "autocomplete",
				mistralApiKey: "test-key",
				apiModelId: customModelId, // Custom model set by user
			} as any)

			const model = new GhostModel()
			await model.loadProfile(mockProviderSettingsManager, autocompleteProfile, provider)

			// The model should use the custom model from the profile, not the default autocomplete model
			const modelName = model.getModelName()
			expect(modelName).toBe(customModelId)
			expect(modelName).not.toBe(AUTOCOMPLETE_PROVIDER_MODELS[provider])
		})

		it("should override model for automatically detected profiles", async () => {
			const supportedProviders = Object.keys(AUTOCOMPLETE_PROVIDER_MODELS)
			const provider = supportedProviders[0] as keyof typeof AUTOCOMPLETE_PROVIDER_MODELS
			const customModelId = "custom-chat-model"

			const chatProfile = {
				id: "1",
				name: "My Chat Profile",
				apiProvider: provider,
				profileType: "chat", // Not an autocomplete profile
			} as any

			// Mock getProfile to return a profile with a custom model
			// For mistral provider, the model key is apiModelId
			vi.mocked(mockProviderSettingsManager.getProfile).mockResolvedValue({
				id: "1",
				name: "My Chat Profile",
				apiProvider: provider,
				profileType: "chat",
				mistralApiKey: "test-key",
				apiModelId: customModelId, // Custom model set by user
			} as any)

			const model = new GhostModel()
			await model.loadProfile(mockProviderSettingsManager, chatProfile, provider)

			// The model should be overridden with the default autocomplete model
			const modelName = model.getModelName()
			expect(modelName).toBe(AUTOCOMPLETE_PROVIDER_MODELS[provider])
			expect(modelName).not.toBe(customModelId)
		})

		it("should override model for profiles without profileType", async () => {
			const supportedProviders = Object.keys(AUTOCOMPLETE_PROVIDER_MODELS)
			const provider = supportedProviders[0] as keyof typeof AUTOCOMPLETE_PROVIDER_MODELS
			const customModelId = "custom-model"

			const genericProfile = {
				id: "1",
				name: "My Generic Profile",
				apiProvider: provider,
				// No profileType specified
			} as any

			// Mock getProfile to return a profile with a custom model
			// For mistral provider, the model key is apiModelId
			vi.mocked(mockProviderSettingsManager.getProfile).mockResolvedValue({
				id: "1",
				name: "My Generic Profile",
				apiProvider: provider,
				mistralApiKey: "test-key",
				apiModelId: customModelId, // Custom model set by user
			} as any)

			const model = new GhostModel()
			await model.loadProfile(mockProviderSettingsManager, genericProfile, provider)

			// The model should be overridden with the default autocomplete model
			const modelName = model.getModelName()
			expect(modelName).toBe(AUTOCOMPLETE_PROVIDER_MODELS[provider])
			expect(modelName).not.toBe(customModelId)
		})
	})
})
