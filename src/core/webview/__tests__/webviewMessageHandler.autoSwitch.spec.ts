// kilocode_change new file

import type { Mock } from "vitest"
import { describe, it, expect, vi, beforeEach } from "vitest"
import axios from "axios"

// Mock dependencies first
vi.mock("vscode", () => ({
	window: {
		showWarningMessage: vi.fn(),
		showErrorMessage: vi.fn(),
		showInformationMessage: vi.fn(),
		createTextEditorDecorationType: vi.fn(() => ({
			dispose: vi.fn(),
		})),
	},
	workspace: {
		workspaceFolders: [{ uri: { fsPath: "/mock/workspace" } }],
		getConfiguration: vi.fn().mockReturnValue({
			get: vi.fn(),
			update: vi.fn(),
		}),
	},
	Uri: {
		file: vi.fn((path) => ({ fsPath: path })),
		parse: vi.fn((path) => ({ fsPath: path })),
	},
	env: {
		uriScheme: "vscode",
		openExternal: vi.fn(),
	},
	commands: {
		executeCommand: vi.fn(),
	},
}))

vi.mock("axios")

vi.mock("../../task-persistence", () => ({
	saveTaskMessages: vi.fn(),
}))

vi.mock("../../../api/providers/fetchers/modelCache", () => ({
	getModels: vi.fn(),
	flushModels: vi.fn(),
}))

vi.mock("../../../integrations/notifications", () => ({
	showSystemNotification: vi.fn(),
}))

vi.mock("../kiloWebviewMessgeHandlerHelpers", () => ({
	refreshOrganizationModes: vi.fn(),
	fetchAndRefreshOrganizationModesOnStartup: vi.fn(),
}))

vi.mock("@roo-code/cloud", () => ({
	CloudService: {
		instance: {
			logout: vi.fn(),
		},
	},
}))

// Import after mocks
import { webviewMessageHandler } from "../webviewMessageHandler"
import type { ClineProvider } from "../ClineProvider"
import { getModels, flushModels } from "../../../api/providers/fetchers/modelCache"
import { showSystemNotification } from "../../../integrations/notifications"
import { refreshOrganizationModes } from "../kiloWebviewMessgeHandlerHelpers"
import { CloudService } from "@roo-code/cloud"

describe("webviewMessageHandler - Automatic Organization Switching", () => {
	let mockProvider: ClineProvider
	let mockGetGlobalState: Mock
	let mockUpdateGlobalState: Mock
	let mockUpsertProviderProfile: Mock
	let mockPostMessageToWebview: Mock
	let mockPostStateToWebview: Mock
	let mockLog: Mock
	let mockProviderSettingsManager: any

	beforeEach(() => {
		vi.clearAllMocks()

		// Setup mock functions
		mockGetGlobalState = vi.fn()
		mockUpdateGlobalState = vi.fn()
		mockUpsertProviderProfile = vi.fn()
		mockPostMessageToWebview = vi.fn()
		mockPostStateToWebview = vi.fn()
		mockLog = vi.fn()
		mockProviderSettingsManager = {
			getProfile: vi.fn().mockResolvedValue({}),
		}

		// Create mock provider
		mockProvider = {
			getState: vi.fn().mockResolvedValue({
				apiConfiguration: {
					kilocodeToken: "test-token",
					kilocodeOrganizationId: undefined,
				},
				currentApiConfigName: "default",
			}),
			contextProxy: {
				getValue: mockGetGlobalState,
				setValue: mockUpdateGlobalState,
				globalStorageUri: { fsPath: "/mock/storage" },
			},
			upsertProviderProfile: mockUpsertProviderProfile,
			postMessageToWebview: mockPostMessageToWebview,
			postStateToWebview: mockPostStateToWebview,
			log: mockLog,
			providerSettingsManager: mockProviderSettingsManager,
		} as unknown as ClineProvider
	})

	describe("Auto-Switch Success Cases", () => {
		it("should auto-switch to first organization on first login", async () => {
			// Setup: User logs in with organizations, no org selected, flag not set
			const mockProfileData = {
				organizations: [
					{ id: "org-1", name: "Test Org 1", balance: 100, role: "owner" },
					{ id: "org-2", name: "Test Org 2", balance: 50, role: "member" },
				],
			}

			mockGetGlobalState.mockImplementation((key: string) => {
				if (key === "hasPerformedOrganizationAutoSwitch") return undefined
				if (key === "systemNotificationsEnabled") return true
				return undefined
			})
			;(axios.get as Mock).mockResolvedValueOnce({ data: mockProfileData })
			;(getModels as Mock).mockResolvedValueOnce({ "model-1": {} })

			await webviewMessageHandler(mockProvider, {
				type: "fetchProfileDataRequest",
			})

			// Verify organization ID was set to first org (via recursive upsertApiConfiguration call)
			expect(mockUpsertProviderProfile).toHaveBeenCalledWith(
				"default",
				{
					kilocodeToken: "test-token",
					kilocodeOrganizationId: "org-1",
				},
				true, // Changed: Now correctly activates the profile (fix for PR #5415 bug)
			)

			// Verify flag was set to true after the recursive call
			expect(mockUpdateGlobalState).toHaveBeenCalledWith("hasPerformedOrganizationAutoSwitch", true)

			// Verify organization modes were fetched (via upsertApiConfiguration handler)
			expect(refreshOrganizationModes).toHaveBeenCalled()

			// Verify models were flushed and refetched (via upsertApiConfiguration handler)
			expect(flushModels).toHaveBeenCalledWith(
				{
					provider: "kilocode",
					kilocodeOrganizationId: "org-1",
					kilocodeToken: "test-token",
				},
				true,
			)
			expect(getModels).toHaveBeenCalledWith({
				provider: "kilocode",
				kilocodeOrganizationId: "org-1",
				kilocodeToken: "test-token",
			})

			// Verify webview state was updated (via upsertApiConfiguration handler)
			expect(mockPostStateToWebview).toHaveBeenCalled()
		})

		it("should send VSCode notification after successful auto-switch", async () => {
			const mockProfileData = {
				organizations: [{ id: "org-1", name: "Test Org 1", balance: 100, role: "owner" }],
			}

			mockGetGlobalState.mockReturnValue(undefined)
			;(axios.get as Mock).mockResolvedValueOnce({ data: mockProfileData })
			;(getModels as Mock).mockResolvedValueOnce({ "model-1": {} })

			await webviewMessageHandler(mockProvider, {
				type: "fetchProfileDataRequest",
			})

			// Verify VSCode notification was shown
			const vscode = await import("vscode")
			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
				expect.stringContaining("Automatically switched to organization:"),
			)
			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(expect.stringContaining("Test Org 1"))
		})

		it("should fetch organization modes after auto-switch", async () => {
			const mockProfileData = {
				organizations: [{ id: "org-1", name: "Test Org 1", balance: 100, role: "owner" }],
			}

			mockGetGlobalState.mockReturnValue(undefined)
			;(axios.get as Mock).mockResolvedValueOnce({ data: mockProfileData })
			;(getModels as Mock).mockResolvedValueOnce({ "model-1": {} })

			await webviewMessageHandler(mockProvider, {
				type: "fetchProfileDataRequest",
			})

			// Verify refreshOrganizationModes was called (via upsertApiConfiguration)
			expect(refreshOrganizationModes).toHaveBeenCalled()

			// Verify it was called with an object containing the organization ID
			const callArgs = (refreshOrganizationModes as Mock).mock.calls[0]
			expect(callArgs[0].apiConfiguration.kilocodeOrganizationId).toBe("org-1")
			expect(callArgs[1]).toBe(mockProvider)
		})

		it("should flush and refetch models after auto-switch", async () => {
			const mockProfileData = {
				organizations: [{ id: "org-1", name: "Test Org 1", balance: 100, role: "owner" }],
			}

			mockGetGlobalState.mockReturnValue(undefined)
			;(axios.get as Mock).mockResolvedValueOnce({ data: mockProfileData })
			;(getModels as Mock).mockResolvedValueOnce({ "model-1": {}, "model-2": {} })

			await webviewMessageHandler(mockProvider, {
				type: "fetchProfileDataRequest",
			})

			// Verify flushModels was called (via upsertApiConfiguration)
			expect(flushModels).toHaveBeenCalledWith(
				{
					provider: "kilocode",
					kilocodeOrganizationId: "org-1",
					kilocodeToken: "test-token",
				},
				true,
			)

			// Verify getModels was called with organization ID (via upsertApiConfiguration)
			expect(getModels).toHaveBeenCalledWith({
				provider: "kilocode",
				kilocodeOrganizationId: "org-1",
				kilocodeToken: "test-token",
			})

			// Verify models were sent to webview (via upsertApiConfiguration)
			expect(mockPostMessageToWebview).toHaveBeenCalledWith({
				type: "routerModels",
				routerModels: { kilocode: { "model-1": {}, "model-2": {} } },
			})
		})
	})

	describe("Auto-Switch Prevention Cases", () => {
		it("should NOT auto-switch if user already has organization selected", async () => {
			// User already has an organization
			mockProvider.getState = vi.fn().mockResolvedValue({
				apiConfiguration: {
					kilocodeToken: "test-token",
					kilocodeOrganizationId: "existing-org",
				},
				currentApiConfigName: "default",
			})

			const mockProfileData = {
				organizations: [
					{ id: "org-1", name: "Test Org 1", balance: 100, role: "owner" },
					{ id: "existing-org", name: "Existing Org", balance: 200, role: "owner" },
				],
			}

			mockGetGlobalState.mockReturnValue(undefined)
			;(axios.get as Mock).mockResolvedValueOnce({ data: mockProfileData })

			await webviewMessageHandler(mockProvider, {
				type: "fetchProfileDataRequest",
			})

			// Verify no auto-switch occurred
			expect(mockUpsertProviderProfile).not.toHaveBeenCalled()
			expect(mockUpdateGlobalState).not.toHaveBeenCalledWith("hasPerformedOrganizationAutoSwitch", true)
			expect(refreshOrganizationModes).not.toHaveBeenCalled()
			expect(flushModels).not.toHaveBeenCalled()
		})

		it("should NOT auto-switch if flag is already set", async () => {
			const mockProfileData = {
				organizations: [{ id: "org-1", name: "Test Org 1", balance: 100, role: "owner" }],
			}

			// Flag is already set
			mockGetGlobalState.mockImplementation((key: string) => {
				if (key === "hasPerformedOrganizationAutoSwitch") return true
				return undefined
			})
			;(axios.get as Mock).mockResolvedValueOnce({ data: mockProfileData })

			await webviewMessageHandler(mockProvider, {
				type: "fetchProfileDataRequest",
			})

			// Verify no auto-switch occurred
			expect(mockUpsertProviderProfile).not.toHaveBeenCalled()
			expect(refreshOrganizationModes).not.toHaveBeenCalled()
			expect(flushModels).not.toHaveBeenCalled()
		})

		it("should NOT auto-switch if user has no organizations", async () => {
			const mockProfileData = {
				organizations: [],
			}

			mockGetGlobalState.mockReturnValue(undefined)
			;(axios.get as Mock).mockResolvedValueOnce({ data: mockProfileData })

			await webviewMessageHandler(mockProvider, {
				type: "fetchProfileDataRequest",
			})

			// Verify no auto-switch occurred
			expect(mockUpsertProviderProfile).not.toHaveBeenCalled()
			expect(mockUpdateGlobalState).not.toHaveBeenCalledWith("hasPerformedOrganizationAutoSwitch", true)
		})

		it("should NOT auto-switch if organizations array is undefined", async () => {
			const mockProfileData = {
				organizations: undefined,
			}

			mockGetGlobalState.mockReturnValue(undefined)
			;(axios.get as Mock).mockResolvedValueOnce({ data: mockProfileData })

			await webviewMessageHandler(mockProvider, {
				type: "fetchProfileDataRequest",
			})

			// Verify no auto-switch occurred
			expect(mockUpsertProviderProfile).not.toHaveBeenCalled()
			expect(mockUpdateGlobalState).not.toHaveBeenCalledWith("hasPerformedOrganizationAutoSwitch", true)
		})

		it("should NOT auto-switch when YOLO mode is enabled (cloud agents, CI)", async () => {
			// Setup: User logs in with organizations but YOLO mode is enabled
			const mockProfileData = {
				organizations: [{ id: "org-1", name: "Test Org 1", balance: 100, role: "owner" }],
			}

			// YOLO mode is enabled (e.g., cloud agent running with --ci flag)
			mockGetGlobalState.mockImplementation((key: string) => {
				if (key === "yoloMode") return true
				if (key === "hasPerformedOrganizationAutoSwitch") return undefined
				return undefined
			})
			;(axios.get as Mock).mockResolvedValueOnce({ data: mockProfileData })

			await webviewMessageHandler(mockProvider, {
				type: "fetchProfileDataRequest",
			})

			// Verify no auto-switch occurred - YOLO mode should prevent it
			expect(mockUpsertProviderProfile).not.toHaveBeenCalled()
			expect(mockUpdateGlobalState).not.toHaveBeenCalledWith("hasPerformedOrganizationAutoSwitch", true)
			expect(refreshOrganizationModes).not.toHaveBeenCalled()
			expect(flushModels).not.toHaveBeenCalled()

			// Verify profile fetch still succeeded
			expect(mockPostMessageToWebview).toHaveBeenCalledWith({
				type: "profileDataResponse",
				payload: {
					success: true,
					data: expect.objectContaining({
						kilocodeToken: "test-token",
						organizations: mockProfileData.organizations,
					}),
				},
			})
		})
	})

	describe("Flag Reset Cases", () => {
		it("should reset flag on token change", async () => {
			// Mock existing configuration with a different token
			mockProviderSettingsManager.getProfile.mockResolvedValueOnce({
				kilocodeToken: "old-token",
				kilocodeOrganizationId: "org-1",
			})

			await webviewMessageHandler(mockProvider, {
				type: "upsertApiConfiguration",
				text: "default",
				apiConfiguration: {
					kilocodeToken: "new-token",
					kilocodeOrganizationId: "org-1",
				},
			})

			// Verify flag was reset
			expect(mockUpdateGlobalState).toHaveBeenCalledWith("hasPerformedOrganizationAutoSwitch", undefined)

			// Verify organization ID was cleared
			expect(mockUpsertProviderProfile).toHaveBeenCalledWith(
				"default",
				{
					kilocodeToken: "new-token",
					kilocodeOrganizationId: undefined,
				},
				true, // Changed: Now correctly activates the profile (fix for PR #5415 bug)
			)
		})

		it("should NOT reset flag if token stays the same", async () => {
			// Mock existing configuration with the same token
			mockProviderSettingsManager.getProfile.mockResolvedValueOnce({
				kilocodeToken: "same-token",
				kilocodeOrganizationId: "org-1",
			})

			await webviewMessageHandler(mockProvider, {
				type: "upsertApiConfiguration",
				text: "default",
				apiConfiguration: {
					kilocodeToken: "same-token",
					kilocodeOrganizationId: "org-1",
				},
			})

			// Verify flag was NOT reset
			expect(mockUpdateGlobalState).not.toHaveBeenCalledWith("hasPerformedOrganizationAutoSwitch", undefined)
		})

		it("should NOT reset flag if previous token was undefined", async () => {
			// Mock existing configuration with no token
			mockProviderSettingsManager.getProfile.mockResolvedValueOnce({
				kilocodeToken: undefined,
			})

			await webviewMessageHandler(mockProvider, {
				type: "upsertApiConfiguration",
				text: "default",
				apiConfiguration: {
					kilocodeToken: "new-token",
				},
			})

			// Verify flag was NOT reset (no previous token to change from)
			expect(mockUpdateGlobalState).not.toHaveBeenCalledWith("hasPerformedOrganizationAutoSwitch", undefined)
		})
	})

	describe("Error Handling Cases", () => {
		it("should handle auto-switch errors gracefully and still fetch profile", async () => {
			const mockProfileData = {
				organizations: [{ id: "org-1", name: "Test Org 1", balance: 100, role: "owner" }],
			}

			mockGetGlobalState.mockReturnValue(undefined)
			;(axios.get as Mock).mockResolvedValueOnce({ data: mockProfileData })

			// Make upsertProviderProfile throw an error (called during recursive upsertApiConfiguration)
			mockUpsertProviderProfile.mockRejectedValueOnce(new Error("Database error"))

			await webviewMessageHandler(mockProvider, {
				type: "fetchProfileDataRequest",
			})

			// Verify error was logged
			expect(mockLog).toHaveBeenCalledWith(expect.stringContaining("Error during automatic organization switch"))

			// Verify profile fetch still succeeded
			expect(mockPostMessageToWebview).toHaveBeenCalledWith({
				type: "profileDataResponse",
				payload: {
					success: true,
					data: expect.objectContaining({
						kilocodeToken: "test-token",
						organizations: mockProfileData.organizations,
					}),
				},
			})
		})

		it("should handle organization modes fetch failure gracefully", async () => {
			const mockProfileData = {
				organizations: [{ id: "org-1", name: "Test Org 1", balance: 100, role: "owner" }],
			}

			mockGetGlobalState.mockReturnValue(undefined)
			;(axios.get as Mock).mockResolvedValueOnce({ data: mockProfileData })
			;(getModels as Mock).mockResolvedValueOnce({ "model-1": {} })

			// Make refreshOrganizationModes throw an error (called during upsertApiConfiguration)
			;(refreshOrganizationModes as Mock).mockRejectedValueOnce(new Error("Network error"))

			await webviewMessageHandler(mockProvider, {
				type: "fetchProfileDataRequest",
			})

			// Note: Error handling now happens within upsertApiConfiguration handler, not in auto-switch
			// The auto-switch will complete successfully even if refreshOrganizationModes fails
			// because upsertApiConfiguration has its own error handling

			// Verify profile fetch still succeeded
			expect(mockPostMessageToWebview).toHaveBeenCalledWith({
				type: "profileDataResponse",
				payload: expect.objectContaining({
					success: true,
				}),
			})

			// Verify the auto-switch completed (flag was set)
			expect(mockUpdateGlobalState).toHaveBeenCalledWith("hasPerformedOrganizationAutoSwitch", true)
		})

		it("should handle models refetch failure gracefully", async () => {
			const mockProfileData = {
				organizations: [{ id: "org-1", name: "Test Org 1", balance: 100, role: "owner" }],
			}

			mockGetGlobalState.mockReturnValue(undefined)
			;(axios.get as Mock).mockResolvedValueOnce({ data: mockProfileData })

			// Make getModels throw an error on all calls (called during upsertApiConfiguration)
			;(getModels as Mock).mockRejectedValue(new Error("API error"))

			await webviewMessageHandler(mockProvider, {
				type: "fetchProfileDataRequest",
			})

			// The auto-switch will fail, but profile fetch should still succeed
			// Verify profile fetch succeeded
			expect(mockPostMessageToWebview).toHaveBeenCalledWith({
				type: "profileDataResponse",
				payload: expect.objectContaining({
					success: true,
				}),
			})

			// When getModels fails during upsertApiConfiguration, the entire auto-switch fails and logs an error
			// Verify that an error was logged
			expect(mockLog).toHaveBeenCalled()
		})
	})

	describe("Integration Cases", () => {
		it("should select first organization when multiple exist", async () => {
			const mockProfileData = {
				organizations: [
					{ id: "org-1", name: "First Org", balance: 100, role: "owner" },
					{ id: "org-2", name: "Second Org", balance: 50, role: "member" },
					{ id: "org-3", name: "Third Org", balance: 75, role: "admin" },
				],
			}

			mockGetGlobalState.mockReturnValue(undefined)
			;(axios.get as Mock).mockResolvedValueOnce({ data: mockProfileData })
			;(getModels as Mock).mockResolvedValueOnce({ "model-1": {} })

			await webviewMessageHandler(mockProvider, {
				type: "fetchProfileDataRequest",
			})

			// Verify first organization was selected (index 0)
			expect(mockUpsertProviderProfile).toHaveBeenCalledWith(
				"default",
				{
					kilocodeToken: "test-token",
					kilocodeOrganizationId: "org-1",
				},
				true, // Changed: Now correctly activates the profile (fix for PR #5415 bug)
			)

			// Verify log message mentions the correct organization
			expect(mockLog).toHaveBeenCalledWith(
				expect.stringContaining("automatic organization switch to: First Org (org-1)"),
			)
		})

		it("should update webview state after auto-switch", async () => {
			const mockProfileData = {
				organizations: [{ id: "org-1", name: "Test Org", balance: 100, role: "owner" }],
			}

			mockGetGlobalState.mockReturnValue(undefined)
			;(axios.get as Mock).mockResolvedValueOnce({ data: mockProfileData })
			;(getModels as Mock).mockResolvedValueOnce({ "model-1": {} })

			await webviewMessageHandler(mockProvider, {
				type: "fetchProfileDataRequest",
			})

			// Verify postStateToWebview was called after auto-switch
			expect(mockPostStateToWebview).toHaveBeenCalled()
		})

		it("should complete full auto-switch flow in correct order", async () => {
			const mockProfileData = {
				organizations: [{ id: "org-1", name: "Test Org", balance: 100, role: "owner" }],
			}

			const callOrder: string[] = []

			mockGetGlobalState.mockReturnValue(undefined)
			;(axios.get as Mock).mockResolvedValueOnce({ data: mockProfileData })

			mockUpsertProviderProfile.mockImplementation(async () => {
				callOrder.push("upsertProviderProfile")
			})
			;(refreshOrganizationModes as Mock).mockImplementation(async () => {
				callOrder.push("refreshOrganizationModes")
			})
			;(flushModels as Mock).mockImplementation(async () => {
				callOrder.push("flushModels")
			})
			;(getModels as Mock).mockImplementation(async () => {
				callOrder.push("getModels")
				return { "model-1": {} }
			})
			mockUpdateGlobalState.mockImplementation(async (key: string) => {
				if (key === "hasPerformedOrganizationAutoSwitch") {
					callOrder.push("setFlag")
				}
			})
			mockPostStateToWebview.mockImplementation(() => {
				callOrder.push("postStateToWebview")
			})
			mockPostMessageToWebview.mockImplementation(() => {
				// Don't track postMessageToWebview in call order
			})

			await webviewMessageHandler(mockProvider, {
				type: "fetchProfileDataRequest",
			})

			// Verify operations occurred in the correct order
			// All operations except setFlag happen within the recursive upsertApiConfiguration call
			expect(callOrder).toContain("upsertProviderProfile")
			expect(callOrder).toContain("refreshOrganizationModes")
			expect(callOrder).toContain("flushModels")
			expect(callOrder).toContain("setFlag")
			expect(callOrder).toContain("postStateToWebview")

			// Verify the recursive call (upsertProviderProfile) completes before setFlag
			expect(callOrder.indexOf("upsertProviderProfile")).toBeLessThan(callOrder.indexOf("setFlag"))
			// Verify all side effects (flushModels) happen before setFlag
			expect(callOrder.indexOf("flushModels")).toBeLessThan(callOrder.indexOf("setFlag"))
		})
	})
})
