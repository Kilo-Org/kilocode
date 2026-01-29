// kilocode_change - new file
// npx vitest src/core/config/__tests__/ProviderSettingsManager.kilocode.spec.ts

import { ExtensionContext } from "vscode"

import { ProviderSettingsManager } from "../ProviderSettingsManager"

// Mock VSCode ExtensionContext
const mockSecrets = {
	get: vi.fn(),
	store: vi.fn(),
	delete: vi.fn(),
}

const mockGlobalState = {
	get: vi.fn(),
	update: vi.fn(),
}

const mockContext = {
	secrets: mockSecrets,
	globalState: mockGlobalState,
} as unknown as ExtensionContext

describe("ProviderSettingsManager - Kilocode specific tests", () => {
	let providerSettingsManager: ProviderSettingsManager

	beforeEach(async () => {
		vi.clearAllMocks()
		// Reset all mock implementations to default successful behavior
		mockSecrets.get.mockResolvedValue(null)
		mockSecrets.store.mockResolvedValue(undefined)
		mockSecrets.delete.mockResolvedValue(undefined)
		mockGlobalState.get.mockReturnValue(undefined)
		mockGlobalState.update.mockResolvedValue(undefined)

		providerSettingsManager = new ProviderSettingsManager(mockContext)

		// Wait for the first manager's initialization to complete, then clear mock calls
		// This is needed because new users get the default kilocode config stored
		await providerSettingsManager.initialize()
		vi.clearAllMocks()

		providerSettingsManager.initialize = async () => {
			providerSettingsManager = new ProviderSettingsManager(mockContext)
			await providerSettingsManager.initialize()
		}
	})

	describe("initialize", () => {
		it("should inject default kilocode profile for existing users with empty apiConfigs", async () => {
			// Existing user with stored content but empty apiConfigs
			mockSecrets.get.mockResolvedValue(
				JSON.stringify({
					currentApiConfigName: "default",
					apiConfigs: {}, // Empty!
					modeApiConfigs: {},
					migrations: {
						rateLimitSecondsMigrated: true,
						diffSettingsMigrated: true,
						openAiHeadersMigrated: true,
						consecutiveMistakeLimitMigrated: true,
						todoListEnabledMigrated: true,
						morphApiKeyMigrated: true,
						claudeCodeLegacySettingsMigrated: true,
					},
				}),
			)

			await providerSettingsManager.initialize()

			expect(mockSecrets.store).toHaveBeenCalled()
			const calls = mockSecrets.store.mock.calls
			const storedConfig = JSON.parse(calls[calls.length - 1][1])

			// Should have injected the default kilocode profile
			expect(storedConfig.apiConfigs.default).toBeDefined()
			expect(storedConfig.apiConfigs.default.apiProvider).toBe("kilocode")
			expect(storedConfig.apiConfigs.default.kilocodeModel).toBe("minimax/minimax-m2.1:free")
			expect(storedConfig.apiConfigs.default.id).toBeTruthy()
			expect(storedConfig.currentApiConfigName).toBe("default")

			// All modes should point to the new default profile
			expect(storedConfig.modeApiConfigs).toBeDefined()
			for (const mode of Object.keys(storedConfig.modeApiConfigs)) {
				expect(storedConfig.modeApiConfigs[mode]).toBe(storedConfig.apiConfigs.default.id)
			}
		})
	})
})
