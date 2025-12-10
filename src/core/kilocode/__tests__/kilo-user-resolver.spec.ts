import { describe, it, expect, vi, beforeEach } from "vitest"
import { resolveKiloUser, resolveKiloUserToken, resolveKiloUserProfile } from "../kilo-user-resolver"
import { EMPTY_KILO_USER } from "@roo-code/types"
import type { ClineProvider } from "../../webview/ClineProvider"

// Mock axios
vi.mock("axios", () => ({
	default: {
		get: vi.fn(),
	},
}))

describe("kilo-user-resolver", () => {
	let mockProvider: Partial<ClineProvider>
	let mockGetState: ReturnType<typeof vi.fn>
	let mockListConfig: ReturnType<typeof vi.fn>
	let mockGetProfile: ReturnType<typeof vi.fn>

	beforeEach(() => {
		vi.clearAllMocks()

		mockGetState = vi.fn()
		mockListConfig = vi.fn()
		mockGetProfile = vi.fn()

		mockProvider = {
			getState: mockGetState,
			providerSettingsManager: {
				listConfig: mockListConfig,
				getProfile: mockGetProfile,
			} as any,
		}
	})

	describe("resolveKiloUser", () => {
		it("should return active profile when it's a kilocode provider with token", async () => {
			const axios = await import("axios")
			vi.mocked(axios.default.get).mockResolvedValueOnce({
				data: { user: { email: "test@example.com" } },
			})

			mockGetState.mockResolvedValue({
				apiConfiguration: {
					apiProvider: "kilocode",
					kilocodeToken: "active-token",
				},
				currentApiConfigName: "active-profile",
			})

			const result = await resolveKiloUser(mockProvider as ClineProvider)

			expect(result).toEqual({
				source: "active-profile",
				profileName: "active-profile",
				email: "test@example.com",
				isAuthenticated: true,
			})
		})

		it("should return first kilocode profile when active profile is not kilocode", async () => {
			const axios = await import("axios")
			vi.mocked(axios.default.get).mockResolvedValueOnce({
				data: { user: { email: "other@example.com" } },
			})

			mockGetState.mockResolvedValue({
				apiConfiguration: {
					apiProvider: "openrouter",
					openRouterApiKey: "some-key",
				},
				currentApiConfigName: "openrouter-profile",
			})

			mockListConfig.mockResolvedValue([
				{ name: "openrouter-profile", apiProvider: "openrouter" },
				{ name: "kilo-profile", apiProvider: "kilocode" },
			])

			mockGetProfile.mockResolvedValue({
				apiProvider: "kilocode",
				kilocodeToken: "other-token",
				name: "kilo-profile",
			})

			const result = await resolveKiloUser(mockProvider as ClineProvider)

			expect(result).toEqual({
				source: "other-profile",
				profileName: "kilo-profile",
				email: "other@example.com",
				isAuthenticated: true,
			})
		})

		it("should return EMPTY_KILO_USER when no kilocode profile exists", async () => {
			mockGetState.mockResolvedValue({
				apiConfiguration: {
					apiProvider: "openrouter",
					openRouterApiKey: "some-key",
				},
				currentApiConfigName: "openrouter-profile",
			})

			mockListConfig.mockResolvedValue([
				{ name: "openrouter-profile", apiProvider: "openrouter" },
				{ name: "anthropic-profile", apiProvider: "anthropic" },
			])

			const result = await resolveKiloUser(mockProvider as ClineProvider)

			expect(result).toEqual(EMPTY_KILO_USER)
		})

		it("should return unauthenticated when API call fails", async () => {
			const axios = await import("axios")
			vi.mocked(axios.default.get).mockRejectedValueOnce(new Error("Network error"))

			mockGetState.mockResolvedValue({
				apiConfiguration: {
					apiProvider: "kilocode",
					kilocodeToken: "invalid-token",
				},
				currentApiConfigName: "active-profile",
			})

			const result = await resolveKiloUser(mockProvider as ClineProvider)

			expect(result).toEqual({
				source: "active-profile",
				profileName: "active-profile",
				email: undefined,
				isAuthenticated: false,
			})
		})

		it("should skip non-kilocode profiles when searching", async () => {
			const axios = await import("axios")
			vi.mocked(axios.default.get).mockResolvedValueOnce({
				data: { user: { email: "kilo@example.com" } },
			})

			mockGetState.mockResolvedValue({
				apiConfiguration: {
					apiProvider: "anthropic",
					apiKey: "some-key",
				},
				currentApiConfigName: "anthropic-profile",
			})

			mockListConfig.mockResolvedValue([
				{ name: "anthropic-profile", apiProvider: "anthropic" },
				{ name: "openrouter-profile", apiProvider: "openrouter" },
				{ name: "kilo-profile", apiProvider: "kilocode" },
			])

			mockGetProfile.mockImplementation(async ({ name }: { name: string }) => {
				if (name === "kilo-profile") {
					return {
						apiProvider: "kilocode",
						kilocodeToken: "kilo-token",
						name: "kilo-profile",
					}
				}
				throw new Error("Profile not found")
			})

			const result = await resolveKiloUser(mockProvider as ClineProvider)

			expect(result).toEqual({
				source: "other-profile",
				profileName: "kilo-profile",
				email: "kilo@example.com",
				isAuthenticated: true,
			})

			// Should only call getProfile for the kilocode profile
			expect(mockGetProfile).toHaveBeenCalledTimes(1)
			expect(mockGetProfile).toHaveBeenCalledWith({ name: "kilo-profile" })
		})

		it("should prioritize active profile over other kilocode profiles", async () => {
			const axios = await import("axios")
			vi.mocked(axios.default.get).mockResolvedValueOnce({
				data: { user: { email: "active@example.com" } },
			})

			mockGetState.mockResolvedValue({
				apiConfiguration: {
					apiProvider: "kilocode",
					kilocodeToken: "active-token",
				},
				currentApiConfigName: "active-kilo",
			})

			mockListConfig.mockResolvedValue([
				{ name: "active-kilo", apiProvider: "kilocode" },
				{ name: "other-kilo", apiProvider: "kilocode" },
			])

			const result = await resolveKiloUser(mockProvider as ClineProvider)

			expect(result).toEqual({
				source: "active-profile",
				profileName: "active-kilo",
				email: "active@example.com",
				isAuthenticated: true,
			})

			// Should not call listConfig or getProfile since active profile is kilocode
			expect(mockListConfig).not.toHaveBeenCalled()
			expect(mockGetProfile).not.toHaveBeenCalled()
		})
	})

	describe("resolveKiloUserToken", () => {
		it("should return token from active kilocode profile", async () => {
			mockGetState.mockResolvedValue({
				apiConfiguration: {
					apiProvider: "kilocode",
					kilocodeToken: "active-token",
				},
			})

			const result = await resolveKiloUserToken(mockProvider as ClineProvider)

			expect(result).toBe("active-token")
		})

		it("should return token from first kilocode profile when active is not kilocode", async () => {
			mockGetState.mockResolvedValue({
				apiConfiguration: {
					apiProvider: "openrouter",
				},
			})

			mockListConfig.mockResolvedValue([
				{ name: "openrouter-profile", apiProvider: "openrouter" },
				{ name: "kilo-profile", apiProvider: "kilocode" },
			])

			mockGetProfile.mockResolvedValue({
				apiProvider: "kilocode",
				kilocodeToken: "kilo-token",
			})

			const result = await resolveKiloUserToken(mockProvider as ClineProvider)

			expect(result).toBe("kilo-token")
		})

		it("should return undefined when no kilocode profile exists", async () => {
			mockGetState.mockResolvedValue({
				apiConfiguration: {
					apiProvider: "openrouter",
				},
			})

			mockListConfig.mockResolvedValue([{ name: "openrouter-profile", apiProvider: "openrouter" }])

			const result = await resolveKiloUserToken(mockProvider as ClineProvider)

			expect(result).toBeUndefined()
		})

		it("should skip profiles without kilocode provider", async () => {
			mockGetState.mockResolvedValue({
				apiConfiguration: {
					apiProvider: "anthropic",
				},
			})

			mockListConfig.mockResolvedValue([
				{ name: "anthropic-profile", apiProvider: "anthropic" },
				{ name: "kilo-profile", apiProvider: "kilocode" },
			])

			mockGetProfile.mockImplementation(async ({ name }: { name: string }) => {
				if (name === "kilo-profile") {
					return {
						apiProvider: "kilocode",
						kilocodeToken: "kilo-token",
					}
				}
				throw new Error("Should not be called for non-kilocode profiles")
			})

			const result = await resolveKiloUserToken(mockProvider as ClineProvider)

			expect(result).toBe("kilo-token")
			expect(mockGetProfile).toHaveBeenCalledTimes(1)
		})
	})

	describe("resolveKiloUserProfile", () => {
		it("should return profile details from active kilocode profile", async () => {
			mockGetState.mockResolvedValue({
				apiConfiguration: {
					apiProvider: "kilocode",
					kilocodeToken: "active-token",
					kilocodeOrganizationId: "org-123",
				},
				currentApiConfigName: "active-profile",
			})

			const result = await resolveKiloUserProfile(mockProvider as ClineProvider)

			expect(result).toEqual({
				token: "active-token",
				profileName: "active-profile",
				source: "active-profile",
				profile: expect.objectContaining({
					apiProvider: "kilocode",
					kilocodeToken: "active-token",
				}),
			})
		})

		it("should return profile details from first kilocode profile when active is not kilocode", async () => {
			mockGetState.mockResolvedValue({
				apiConfiguration: {
					apiProvider: "openrouter",
				},
				currentApiConfigName: "openrouter-profile",
			})

			mockListConfig.mockResolvedValue([
				{ name: "openrouter-profile", apiProvider: "openrouter" },
				{ name: "kilo-profile", apiProvider: "kilocode" },
			])

			mockGetProfile.mockResolvedValue({
				apiProvider: "kilocode",
				kilocodeToken: "kilo-token",
				name: "kilo-profile",
			})

			const result = await resolveKiloUserProfile(mockProvider as ClineProvider)

			expect(result).toEqual({
				token: "kilo-token",
				profileName: "kilo-profile",
				source: "other-profile",
				profile: expect.objectContaining({
					apiProvider: "kilocode",
					kilocodeToken: "kilo-token",
				}),
			})
		})

		it("should return none when no kilocode profile exists", async () => {
			mockGetState.mockResolvedValue({
				apiConfiguration: {
					apiProvider: "openrouter",
				},
			})

			mockListConfig.mockResolvedValue([{ name: "openrouter-profile", apiProvider: "openrouter" }])

			const result = await resolveKiloUserProfile(mockProvider as ClineProvider)

			expect(result).toEqual({
				token: undefined,
				profileName: undefined,
				source: "none",
				profile: undefined,
			})
		})
	})
})
