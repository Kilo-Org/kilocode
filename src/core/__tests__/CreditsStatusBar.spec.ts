import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest"
import * as vscode from "vscode"
import { CreditsStatusBar } from "../kilocode/CreditsStatusBar"
import { ClineProvider } from "../webview/ClineProvider"
import { BalanceDataResponsePayload } from "../../shared/WebviewMessage"
import i18next from "i18next"

// Mock vscode
vi.mock("vscode", () => ({
	window: {
		createStatusBarItem: vi.fn(() => ({
			text: "",
			tooltip: "",
			backgroundColor: undefined,
			command: undefined,
			show: vi.fn(),
			hide: vi.fn(),
			dispose: vi.fn(),
		})),
	},
	StatusBarAlignment: {
		Right: 2,
	},
	commands: {
		registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
	},
	Disposable: class {
		constructor(private callOnDispose: () => void) {}
		dispose() {
			this.callOnDispose()
		}
	},
}))

// Initialize i18n for tests
beforeAll(async () => {
	// Load English translations for the kilocode namespace
	const enTranslations = {
		creditsstatusbar: {
			loading: "Loading...",
			clickToRefresh: "Click to refresh",
			minute: "min",
		},
	}

	await i18next.init({
		lng: "en",
		fallbackLng: "en",
		debug: false,
		resources: {
			en: {
				kilocode: enTranslations,
			},
		},
		interpolation: {
			escapeValue: false,
		},
	})
})

describe("CreditsStatusBar", () => {
	let creditsStatusBar: CreditsStatusBar
	let mockContext: any
	let mockProvider: any
	let mockStatusBarItem: any

	beforeEach(() => {
		mockStatusBarItem = {
			text: "",
			tooltip: "",
			backgroundColor: undefined,
			command: undefined,
			show: vi.fn(),
			hide: vi.fn(),
			dispose: vi.fn(),
		}

		vi.mocked(vscode.window.createStatusBarItem).mockReturnValue(mockStatusBarItem)

		mockContext = {
			subscriptions: [] as any[],
		}

		mockProvider = {
			getState: vi.fn().mockResolvedValue({
				apiConfiguration: {
					kilocodeToken: "test-token",
					kilocodeOrganizationId: "org-123",
				},
			}),
			fetchBalanceData: vi.fn().mockResolvedValue({
				success: true,
				data: { balance: 100 },
			}),
			registerBalanceHandler: vi.fn((handler) => {
				return new vscode.Disposable(() => {})
			}),
		}

		creditsStatusBar = new CreditsStatusBar(mockContext, mockProvider)
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	describe("initialize", () => {
		it("should register refresh command", async () => {
			await creditsStatusBar.initialize()

			expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
				"kilo-code.refreshCredits",
				expect.any(Function),
			)
		})

		it("should register balance handler with provider", async () => {
			await creditsStatusBar.initialize()

			expect(mockProvider.registerBalanceHandler).toHaveBeenCalledWith(expect.any(Function))
		})

		it("should call initial refresh", async () => {
			const refreshSpy = vi.spyOn(creditsStatusBar as any, "refresh")
			await creditsStatusBar.initialize()

			expect(refreshSpy).toHaveBeenCalled()
		})
	})

	describe("organization ID change detection", () => {
		it("should clear balance state when organization ID changes", async () => {
			await creditsStatusBar.initialize()

			// Get the registered balance handler
			const handlerCall = vi.mocked(mockProvider.registerBalanceHandler).mock.calls[0]
			const balanceHandler = handlerCall[0]

			// First update with org-123
			mockProvider.getState.mockResolvedValueOnce({
				apiConfiguration: {
					kilocodeToken: "test-token",
					kilocodeOrganizationId: "org-123",
				},
			})

			const firstPayload: BalanceDataResponsePayload = {
				success: true,
				data: { balance: 100 },
			}
			await balanceHandler(firstPayload)

			// Verify status bar was updated
			expect(mockStatusBarItem.text).toContain("$100")

			// Change organization ID
			mockProvider.getState.mockResolvedValueOnce({
				apiConfiguration: {
					kilocodeToken: "test-token",
					kilocodeOrganizationId: "org-456",
				},
			})

			const secondPayload: BalanceDataResponsePayload = {
				success: true,
				data: { balance: 200 },
			}
			await balanceHandler(secondPayload)

			// Verify status bar was updated with new balance
			expect(mockStatusBarItem.text).toContain("$200")
			// Consumption rate should not be shown after org change (no previous balance)
			expect(mockStatusBarItem.text).not.toContain("/min")
		})

		it("should not clear state when organization ID stays the same", async () => {
			await creditsStatusBar.initialize()

			const handlerCall = vi.mocked(mockProvider.registerBalanceHandler).mock.calls[0]
			const balanceHandler = handlerCall[0]

			// First update
			mockProvider.getState.mockResolvedValue({
				apiConfiguration: {
					kilocodeToken: "test-token",
					kilocodeOrganizationId: "org-123",
				},
			})

			const firstPayload: BalanceDataResponsePayload = {
				success: true,
				data: { balance: 100 },
			}
			await balanceHandler(firstPayload)

			// Wait a bit to ensure time difference for consumption rate
			await new Promise((resolve) => setTimeout(resolve, 100))

			// Second update with same org
			const secondPayload: BalanceDataResponsePayload = {
				success: true,
				data: { balance: 95 },
			}
			await balanceHandler(secondPayload)

			// Consumption rate should be calculated since org didn't change
			expect(mockStatusBarItem.text).toContain("/min")
		})

		it("should clear state when organization ID changes from defined to undefined", async () => {
			await creditsStatusBar.initialize()

			const handlerCall = vi.mocked(mockProvider.registerBalanceHandler).mock.calls[0]
			const balanceHandler = handlerCall[0]

			// First update with org-123
			mockProvider.getState.mockResolvedValueOnce({
				apiConfiguration: {
					kilocodeToken: "test-token",
					kilocodeOrganizationId: "org-123",
				},
			})

			await balanceHandler({ success: true, data: { balance: 100 } })

			// Change to undefined organization ID
			mockProvider.getState.mockResolvedValueOnce({
				apiConfiguration: {
					kilocodeToken: "test-token",
					kilocodeOrganizationId: undefined,
				},
			})

			await balanceHandler({ success: true, data: { balance: 200 } })

			// Should have cleared state and updated with new balance
			expect(mockStatusBarItem.text).toContain("$200")
			expect(mockStatusBarItem.text).not.toContain("/min")
		})

		it("should clear state when organization ID changes from undefined to defined", async () => {
			await creditsStatusBar.initialize()

			const handlerCall = vi.mocked(mockProvider.registerBalanceHandler).mock.calls[0]
			const balanceHandler = handlerCall[0]

			// First update with no org ID
			mockProvider.getState.mockResolvedValueOnce({
				apiConfiguration: {
					kilocodeToken: "test-token",
					kilocodeOrganizationId: undefined,
				},
			})

			await balanceHandler({ success: true, data: { balance: 100 } })

			// Change to defined organization ID
			mockProvider.getState.mockResolvedValueOnce({
				apiConfiguration: {
					kilocodeToken: "test-token",
					kilocodeOrganizationId: "org-123",
				},
			})

			await balanceHandler({ success: true, data: { balance: 200 } })

			// Should have cleared state and updated with new balance
			expect(mockStatusBarItem.text).toContain("$200")
			expect(mockStatusBarItem.text).not.toContain("/min")
		})
	})

	describe("refresh", () => {
		it("should call fetchBalanceData on provider", async () => {
			await creditsStatusBar.initialize()

			await (creditsStatusBar as any).refresh()

			expect(mockProvider.fetchBalanceData).toHaveBeenCalled()
		})

		it("should prevent concurrent refreshes", async () => {
			await creditsStatusBar.initialize()

			const refresh1 = (creditsStatusBar as any).refresh()
			const refresh2 = (creditsStatusBar as any).refresh()

			await Promise.all([refresh1, refresh2])

			// Should only call fetchBalanceData once
			expect(mockProvider.fetchBalanceData).toHaveBeenCalledTimes(2) // 1 from initialize, 1 from first refresh
		})

		it("should handle errors gracefully", async () => {
			await creditsStatusBar.initialize()

			mockProvider.fetchBalanceData.mockRejectedValueOnce(new Error("Network error"))

			await (creditsStatusBar as any).refresh()

			// Should not throw and status bar should still be updated
			expect(mockStatusBarItem.show).toHaveBeenCalled()
		})
	})

	describe("dispose", () => {
		it("should clean up resources", async () => {
			await creditsStatusBar.initialize()

			creditsStatusBar.dispose()

			expect(mockStatusBarItem.dispose).toHaveBeenCalled()
		})
	})

	describe("updateStatusBar", () => {
		it("should hide status bar when no token", async () => {
			mockProvider.getState.mockResolvedValueOnce({
				apiConfiguration: {
					kilocodeToken: undefined,
				},
			})

			await creditsStatusBar.initialize()

			const handlerCall = vi.mocked(mockProvider.registerBalanceHandler).mock.calls[0]
			const balanceHandler = handlerCall[0]

			await balanceHandler({ success: true, data: { balance: 100 } })

			expect(mockStatusBarItem.hide).toHaveBeenCalled()
		})

		it("should show loading state", async () => {
			await creditsStatusBar.initialize()

			const handlerCall = vi.mocked(mockProvider.registerBalanceHandler).mock.calls[0]
			const balanceHandler = handlerCall[0]

			await balanceHandler({ success: false, isLoading: true })

			expect(mockStatusBarItem.text).toContain("Loading")
			expect(mockStatusBarItem.show).toHaveBeenCalled()
		})
	})

	describe("clearAndRefresh", () => {
		it("should clear balance state and trigger refresh", async () => {
			await creditsStatusBar.initialize()

			// Get the registered balance handler
			const handlerCall = vi.mocked(mockProvider.registerBalanceHandler).mock.calls[0]
			const balanceHandler = handlerCall[0]

			// First update with org-123
			mockProvider.getState.mockResolvedValue({
				apiConfiguration: {
					kilocodeToken: "test-token",
					kilocodeOrganizationId: "org-123",
				},
			})

			await balanceHandler({ success: true, data: { balance: 100 } })

			// Verify initial state was set
			expect(mockStatusBarItem.text).toContain("$100")

			// Clear mock calls to track new calls
			vi.clearAllMocks()
			mockProvider.getState.mockResolvedValue({
				apiConfiguration: {
					kilocodeToken: "test-token",
					kilocodeOrganizationId: "org-456",
				},
			})
			mockProvider.fetchBalanceData.mockResolvedValue({
				success: true,
				data: { balance: 200 },
			})

			// Manually call clearAndRefresh (simulating ClineProvider calling it)
			await (creditsStatusBar as any).clearAndRefresh()

			// Verify that fetchBalanceData was called (refresh was triggered)
			expect(mockProvider.fetchBalanceData).toHaveBeenCalled()
		})

		it("should clear consumption rate after organization change", async () => {
			await creditsStatusBar.initialize()

			const handlerCall = vi.mocked(mockProvider.registerBalanceHandler).mock.calls[0]
			const balanceHandler = handlerCall[0]

			// First update with org-123
			mockProvider.getState.mockResolvedValue({
				apiConfiguration: {
					kilocodeToken: "test-token",
					kilocodeOrganizationId: "org-123",
				},
			})

			await balanceHandler({ success: true, data: { balance: 100 } })

			// Wait a bit and update again to establish consumption rate
			await new Promise((resolve) => setTimeout(resolve, 100))
			await balanceHandler({ success: true, data: { balance: 95 } })

			// Verify consumption rate is shown
			expect(mockStatusBarItem.text).toContain("/min")

			// Call clearAndRefresh
			await (creditsStatusBar as any).clearAndRefresh()

			// Change org and update
			mockProvider.getState.mockResolvedValue({
				apiConfiguration: {
					kilocodeToken: "test-token",
					kilocodeOrganizationId: "org-456",
				},
			})

			await balanceHandler({ success: true, data: { balance: 200 } })

			// Consumption rate should not be shown after org change
			expect(mockStatusBarItem.text).not.toContain("/min")
			expect(mockStatusBarItem.text).toContain("$200")
		})
	})
})
