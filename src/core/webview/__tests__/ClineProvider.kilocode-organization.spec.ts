// kilocode_change - new file
// npx vitest core/webview/__tests__/ClineProvider.kilocode-organization.spec.ts

import { setupCommonMocks, setupProvider, createMockWebviewView } from "../../../__tests__/common-mocks"

// Setup all mocks before any imports
setupCommonMocks()

describe("ClineProvider", () => {
	let provider: any
	let mockWebviewView: any

	beforeEach(() => {
		vi.clearAllMocks()
		const setup = setupProvider()
		provider = setup.provider
		mockWebviewView = createMockWebviewView()
	})

	describe("kilocodeOrganizationId", () => {
		test("preserves kilocodeOrganizationId when no previous token exists", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

			const mockUpsertProviderProfile = vi.fn()
			;(provider as any).upsertProviderProfile = mockUpsertProviderProfile
			;(provider as any).providerSettingsManager = {
				getProfile: vi.fn().mockResolvedValue({
					// Simulate saved config with NO kilocodeToken (common case)
					name: "test-config",
					apiProvider: "anthropic",
					apiKey: "test-key",
					id: "test-id",
				}),
			} as any

			await messageHandler({
				type: "upsertApiConfiguration",
				text: "test-config",
				apiConfiguration: {
					apiProvider: "anthropic" as const,
					apiKey: "test-key",
					kilocodeToken: "test-kilo-token",
					kilocodeOrganizationId: "org-123",
				},
			})

			expect(mockUpsertProviderProfile).toHaveBeenCalledWith(
				"test-config",
				expect.objectContaining({
					kilocodeToken: "test-kilo-token",
					kilocodeOrganizationId: "org-123", // Should be preserved
				}),
				false, // activate parameter
			)
		})

		test("clears kilocodeOrganizationId when token actually changes", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

			const mockUpsertProviderProfile = vi.fn()
			;(provider as any).upsertProviderProfile = mockUpsertProviderProfile
			;(provider as any).providerSettingsManager = {
				getProfile: vi.fn().mockResolvedValue({
					// Simulate saved config with DIFFERENT kilocodeToken
					name: "test-config",
					apiProvider: "anthropic",
					apiKey: "test-key",
					kilocodeToken: "old-kilo-token",
					id: "test-id",
				}),
			} as any

			await messageHandler({
				type: "upsertApiConfiguration",
				text: "test-config",
				apiConfiguration: {
					apiProvider: "anthropic" as const,
					apiKey: "test-key",
					kilocodeToken: "new-kilo-token", // Different token
					kilocodeOrganizationId: "org-123",
				},
			})

			// Verify the organization ID was cleared for security
			expect(mockUpsertProviderProfile).toHaveBeenCalledWith(
				"test-config",
				expect.objectContaining({
					kilocodeToken: "new-kilo-token",
					kilocodeOrganizationId: undefined, // Should be cleared
				}),
				false, // activate parameter
			)
		})
	})
})
