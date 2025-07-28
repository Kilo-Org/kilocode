import React from "react"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { vi } from "vitest"
import { KilocodeNotifications } from "../components/kilocode/KilocodeNotifications"
import { ExtensionStateContext, ExtensionStateContextType } from "../context/ExtensionStateContext"

// Mock the vscode module
vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

// Import vscode after mocking
import { vscode } from "@/utils/vscode"

// Get the mocked postMessage function
const mockPostMessage = vscode.postMessage as ReturnType<typeof vi.fn>

// Mock localStorage
const localStorageMock = {
	getItem: vi.fn(),
	setItem: vi.fn(),
	clear: vi.fn(),
}
Object.defineProperty(window, "localStorage", { value: localStorageMock })

// Mock window.open
Object.defineProperty(window, "open", {
	value: vi.fn(),
})

const mockNotifications = {
	notifications: [
		{
			id: "admin-notice",
			title: "Admin Notification",
			message: "You have admin privileges. Please check the admin dashboard for updates.",
		},
		{
			id: "free-credits",
			title: "Free Credits Available!",
			message: "You can receive another $15 in free credits by adding a payment method!",
			action: {
				actionText: "Claim Free Credits",
				actionURL: "https://kilocode.ai/free-welcome-credits",
			},
		},
		{
			id: "non-card-promo",
			title: "50% Bonus on Non-Card Payments",
			message: "Get 50% extra credits when you top up using non-card payment methods!",
			action: {
				actionText: "Buy Credits",
				actionURL: "https://kilocode.ai/profile",
			},
		},
	],
}

const createMockContext = (overrides?: Partial<ExtensionStateContextType>): ExtensionStateContextType => {
	const defaultContext: ExtensionStateContextType = {
		apiConfiguration: {
			apiProvider: "kilocode",
			kilocodeToken: "test-token",
		},
		// Add other required context properties with default values
		version: "",
		clineMessages: [],
		taskHistory: [],
		shouldShowAnnouncement: false,
		allowedCommands: [],
		deniedCommands: [],
		soundEnabled: false,
		soundVolume: 0.5,
		ttsEnabled: false,
		ttsSpeed: 1.0,
		diffEnabled: false,
		enableCheckpoints: true,
		fuzzyMatchThreshold: 1.0,
		language: "en",
		writeDelayMs: 1000,
		browserViewportSize: "900x600",
		screenshotQuality: 75,
		terminalOutputLineLimit: 500,
		terminalShellIntegrationTimeout: 4000,
		mcpEnabled: true,
		enableMcpServerCreation: false,
		alwaysApproveResubmit: false,
		alwaysAllowWrite: true,
		alwaysAllowReadOnly: true,
		requestDelaySeconds: 5,
		currentApiConfigName: "default",
		listApiConfigMeta: [],
		mode: "code",
		customModePrompts: {},
		customSupportPrompts: {},
		experiments: { autocomplete: false },
		enhancementApiConfigId: "",
		commitMessageApiConfigId: "",
		autocompleteApiConfigId: "",
		ghostServiceSettings: {},
		condensingApiConfigId: "",
		customCondensingPrompt: "",
		hasOpenedModeSelector: false,
		autoApprovalEnabled: true,
		customModes: [],
		maxOpenTabsContext: 20,
		maxWorkspaceFiles: 200,
		cwd: "",
		browserToolEnabled: true,
		telemetrySetting: "unset",
		showRooIgnoredFiles: true,
		showAutoApproveMenu: false,
		renderContext: "sidebar",
		maxReadFileLine: -1,
		pinnedApiConfigs: {},
		terminalZshOhMy: false,
		maxConcurrentFileReads: 5,
		allowVeryLargeReads: false,
		terminalZshP10k: false,
		terminalZdotdir: false,
		terminalCompressProgressBar: true,
		historyPreviewCollapsed: false,
		showTaskTimeline: true,
		cloudUserInfo: null,
		cloudIsAuthenticated: false,
		sharingEnabled: false,
		organizationAllowList: { allowAll: true, providers: {} },
		autoCondenseContext: true,
		autoCondenseContextPercent: 100,
		profileThresholds: {},
		codebaseIndexConfig: {
			codebaseIndexEnabled: true,
			codebaseIndexQdrantUrl: "http://localhost:6333",
			codebaseIndexEmbedderProvider: "openai",
			codebaseIndexEmbedderBaseUrl: "",
			codebaseIndexEmbedderModelId: "",
			codebaseIndexSearchMaxResults: undefined,
			codebaseIndexSearchMinScore: undefined,
		},
		codebaseIndexModels: { ollama: {}, openai: {} },
		alwaysAllowUpdateTodoList: true,
		didHydrateState: true,
		showWelcome: false,
		theme: undefined,
		mcpServers: [],
		mcpMarketplaceCatalog: { items: [] },
		filePaths: [],
		openedTabs: [],
		globalRules: {},
		localRules: {},
		globalWorkflows: {},
		localWorkflows: {},
		alwaysAllowFollowupQuestions: false,
		followupAutoApproveTimeoutMs: undefined,
		marketplaceItems: [],
		marketplaceInstalledMetadata: { project: {}, global: {} },
		// Add all the setter functions
		setApiConfiguration: vi.fn(),
		setCustomInstructions: vi.fn(),
		setAlwaysAllowReadOnly: vi.fn(),
		setAlwaysAllowReadOnlyOutsideWorkspace: vi.fn(),
		setAlwaysAllowWrite: vi.fn(),
		setAlwaysAllowWriteOutsideWorkspace: vi.fn(),
		setAlwaysAllowExecute: vi.fn(),
		setAlwaysAllowBrowser: vi.fn(),
		setAlwaysAllowMcp: vi.fn(),
		setAlwaysAllowModeSwitch: vi.fn(),
		setAlwaysAllowSubtasks: vi.fn(),
		setBrowserToolEnabled: vi.fn(),
		setShowRooIgnoredFiles: vi.fn(),
		setShowAutoApproveMenu: vi.fn(),
		setShowAnnouncement: vi.fn(),
		setAllowedCommands: vi.fn(),
		setDeniedCommands: vi.fn(),
		setAllowedMaxRequests: vi.fn(),
		setSoundEnabled: vi.fn(),
		setSoundVolume: vi.fn(),
		setTerminalShellIntegrationTimeout: vi.fn(),
		setTerminalShellIntegrationDisabled: vi.fn(),
		setTerminalZdotdir: vi.fn(),
		setTtsEnabled: vi.fn(),
		setTtsSpeed: vi.fn(),
		setDiffEnabled: vi.fn(),
		setEnableCheckpoints: vi.fn(),
		setBrowserViewportSize: vi.fn(),
		setFuzzyMatchThreshold: vi.fn(),
		setWriteDelayMs: vi.fn(),
		setScreenshotQuality: vi.fn(),
		setTerminalOutputLineLimit: vi.fn(),
		setMcpEnabled: vi.fn(),
		setEnableMcpServerCreation: vi.fn(),
		setAlwaysApproveResubmit: vi.fn(),
		setRequestDelaySeconds: vi.fn(),
		setCurrentApiConfigName: vi.fn(),
		setListApiConfigMeta: vi.fn(),
		setMode: vi.fn(),
		setCustomModePrompts: vi.fn(),
		setCustomSupportPrompts: vi.fn(),
		setEnhancementApiConfigId: vi.fn(),
		setCommitMessageApiConfigId: vi.fn(),
		setAutocompleteApiConfigId: vi.fn(),
		setGhostServiceSettings: vi.fn(),
		setExperimentEnabled: vi.fn(),
		setAutoApprovalEnabled: vi.fn(),
		setCustomModes: vi.fn(),
		setMaxOpenTabsContext: vi.fn(),
		setMaxWorkspaceFiles: vi.fn(),
		setTelemetrySetting: vi.fn(),
		setRemoteBrowserEnabled: vi.fn(),
		setAwsUsePromptCache: vi.fn(),
		setMaxReadFileLine: vi.fn(),
		setPinnedApiConfigs: vi.fn(),
		togglePinnedApiConfig: vi.fn(),
		setTerminalCompressProgressBar: vi.fn(),
		setHistoryPreviewCollapsed: vi.fn(),
		setHasOpenedModeSelector: vi.fn(),
		setAutoCondenseContext: vi.fn(),
		setAutoCondenseContextPercent: vi.fn(),
		setCondensingApiConfigId: vi.fn(),
		setCustomCondensingPrompt: vi.fn(),
		setProfileThresholds: vi.fn(),
		setShowTaskTimeline: vi.fn(),
		setHoveringTaskTimeline: vi.fn(),
		setSystemNotificationsEnabled: vi.fn(),
		setAlwaysAllowFollowupQuestions: vi.fn(),
		setFollowupAutoApproveTimeoutMs: vi.fn(),
		setAlwaysAllowUpdateTodoList: vi.fn(),
		...overrides,
	}

	return defaultContext
}

const renderWithContext = (ui: React.ReactElement, contextValue: ExtensionStateContextType) => {
	return render(<ExtensionStateContext.Provider value={contextValue}>{ui}</ExtensionStateContext.Provider>)
}

describe("KilocodeNotifications", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		localStorageMock.getItem.mockReturnValue(null)
	})

	// Helper to simulate message from backend
	const simulateNotificationResponse = (notifications: any[]) => {
		const event = new MessageEvent("message", {
			data: {
				type: "kilocodeNotificationsResponse",
				notifications,
			},
		})
		window.dispatchEvent(event)
	}

	it("should not render when provider is not kilocode", () => {
		const context = createMockContext({
			apiConfiguration: {
				apiProvider: "anthropic",
			},
		})

		renderWithContext(<KilocodeNotifications />, context)

		expect(screen.queryByText("Admin Notification")).not.toBeInTheDocument()
		expect(mockPostMessage).not.toHaveBeenCalled()
	})

	it("should request notifications when provider is kilocode", async () => {
		const context = createMockContext()

		renderWithContext(<KilocodeNotifications />, context)

		await waitFor(() => {
			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "fetchKilocodeNotifications",
			})
		})
	})

	it("should display notifications when received from backend", async () => {
		const context = createMockContext()

		renderWithContext(<KilocodeNotifications />, context)

		// Simulate backend response
		simulateNotificationResponse(mockNotifications.notifications)

		await waitFor(() => {
			expect(screen.getByRole("heading", { name: "Admin Notification" })).toBeInTheDocument()
			expect(
				screen.getByText("You have admin privileges. Please check the admin dashboard for updates."),
			).toBeInTheDocument()
		})
	})

	it("should navigate between notifications", async () => {
		const context = createMockContext()

		renderWithContext(<KilocodeNotifications />, context)

		// Simulate backend response
		simulateNotificationResponse(mockNotifications.notifications)

		await waitFor(() => {
			expect(screen.getByRole("heading", { name: "Admin Notification" })).toBeInTheDocument()
		})

		// Click next button
		const nextButton = screen.getByTitle("Next notification")
		fireEvent.click(nextButton)

		expect(screen.getByRole("heading", { name: "Free Credits Available!" })).toBeInTheDocument()
		expect(
			screen.getByText("You can receive another $15 in free credits by adding a payment method!"),
		).toBeInTheDocument()

		// Click previous button
		const prevButton = screen.getByTitle("Previous notification")
		fireEvent.click(prevButton)

		expect(screen.getByRole("heading", { name: "Admin Notification" })).toBeInTheDocument()
	})

	it("should handle action button clicks", async () => {
		const context = createMockContext()

		renderWithContext(<KilocodeNotifications />, context)

		// Simulate backend response
		simulateNotificationResponse(mockNotifications.notifications)

		await waitFor(() => {
			expect(screen.getByRole("heading", { name: "Admin Notification" })).toBeInTheDocument()
		})

		// Navigate to notification with action
		const nextButton = screen.getByTitle("Next notification")
		fireEvent.click(nextButton)

		const actionButton = screen.getByText("Claim Free Credits")
		fireEvent.click(actionButton)

		expect(window.open).toHaveBeenCalledWith("https://kilocode.ai/free-welcome-credits", "_blank")
	})

	it("should dismiss notifications and save to localStorage", async () => {
		const context = createMockContext()

		renderWithContext(<KilocodeNotifications />, context)

		// Simulate backend response
		simulateNotificationResponse(mockNotifications.notifications)

		await waitFor(() => {
			expect(screen.getByRole("heading", { name: "Admin Notification" })).toBeInTheDocument()
		})

		const dismissButton = screen.getByTitle("Dismiss notification")
		fireEvent.click(dismissButton)

		expect(localStorageMock.setItem).toHaveBeenCalledWith(
			"kilocode-dismissed-notifications",
			JSON.stringify(["admin-notice"]),
		)

		// Should show next notification after dismissing
		expect(screen.getByRole("heading", { name: "Free Credits Available!" })).toBeInTheDocument()
	})

	it("should filter out previously dismissed notifications", async () => {
		localStorageMock.getItem.mockReturnValue(JSON.stringify(["admin-notice"]))

		const context = createMockContext()

		renderWithContext(<KilocodeNotifications />, context)

		// Request should be sent
		await waitFor(() => {
			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "fetchKilocodeNotifications",
			})
		})

		// Simulate backend response with all notifications
		simulateNotificationResponse(mockNotifications.notifications)

		await waitFor(() => {
			// Should not show dismissed notification
			expect(screen.queryByRole("heading", { name: "Admin Notification" })).not.toBeInTheDocument()
			// Should show non-dismissed notification
			expect(screen.getByRole("heading", { name: "Free Credits Available!" })).toBeInTheDocument()
		})
	})

	it("should not render when there are no notifications", async () => {
		const context = createMockContext()

		renderWithContext(<KilocodeNotifications />, context)

		// Simulate backend response with empty notifications
		simulateNotificationResponse([])

		await waitFor(() => {
			expect(mockPostMessage).toHaveBeenCalled()
		})

		// Should not render anything when no notifications
		expect(screen.queryByRole("heading")).not.toBeInTheDocument()
	})
})
