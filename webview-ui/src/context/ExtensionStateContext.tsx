import React, { createContext, useCallback, useContext, useEffect, useState } from "react"

import {
	type ProviderSettings,
	type ProviderSettingsEntry,
	type CustomModePrompts,
	type ModeConfig,
	type ExperimentId,
	AutocompleteServiceSettings, // kilocode_change
	openRouterDefaultModelId, // kilocode_change
	type TodoItem,
	type TelemetrySetting,
	type OrganizationAllowList,
	type CloudOrganizationMembership,
	type ExtensionMessage,
	type ExtensionState,
	type MarketplaceInstalledMetadata,
	type Command,
	type McpServer,
	RouterModels,
	ORGANIZATION_ALLOW_ALL,
	DEFAULT_CHECKPOINT_TIMEOUT_SECONDS,
} from "@roo-code/types"

import { findLastIndex } from "@roo/array"

import { checkExistKey } from "@roo/checkExistApiConfig"
import { Mode, defaultModeSlug, defaultPrompts } from "@roo/modes"
import { CustomSupportPrompts } from "@roo/support-prompt"
import { experimentDefault } from "@roo/experiments"
import { McpMarketplaceCatalog } from "../../../src/shared/kilocode/mcp" // kilocode_change

import { vscode } from "@src/utils/vscode"
import { convertTextMateToHljs } from "@src/utils/textMateToHljs"
import { ClineRulesToggles } from "@roo/cline-rules" // kilocode_change

export interface ExtensionStateContextType extends ExtensionState {
	historyPreviewCollapsed?: boolean
	showTaskTimeline?: boolean // kilocode_change
	sendMessageOnEnter?: boolean // kilocode_change New state property for Enter key behavior
	setShowTaskTimeline: (value: boolean) => void // kilocode_change
	setSendMessageOnEnter: (value: boolean) => void // kilocode_change
	showTimestamps?: boolean // kilocode_change
	setShowTimestamps: (value: boolean) => void // kilocode_change
	showDiffStats?: boolean // kilocode_change
	setShowDiffStats: (value: boolean) => void // kilocode_change
	hideCostBelowThreshold?: number // kilocode_change
	setHideCostBelowThreshold: (value: number) => void // kilocode_change
	hoveringTaskTimeline?: boolean // kilocode_change
	setHoveringTaskTimeline: (value: boolean) => void // kilocode_change
	systemNotificationsEnabled?: boolean // kilocode_change
	setSystemNotificationsEnabled: (value: boolean) => void // kilocode_change
	dismissedNotificationIds: string[] // kilocode_change
	yoloMode?: boolean // kilocode_change
	setYoloMode: (value: boolean) => void // kilocode_Change
	// kilocode_change start - Auto-purge settings
	autoPurgeEnabled?: boolean
	setAutoPurgeEnabled: (value: boolean) => void
	autoPurgeDefaultRetentionDays?: number
	setAutoPurgeDefaultRetentionDays: (value: number) => void
	autoPurgeFavoritedTaskRetentionDays?: number | null
	setAutoPurgeFavoritedTaskRetentionDays: (value: number | null) => void
	autoPurgeCompletedTaskRetentionDays?: number
	setAutoPurgeCompletedTaskRetentionDays: (value: number) => void
	autoPurgeIncompleteTaskRetentionDays?: number
	setAutoPurgeIncompleteTaskRetentionDays: (value: number) => void
	autoPurgeLastRunTimestamp?: number
	setAutoPurgeLastRunTimestamp: (value: number) => void
	// kilocode_change end
	didHydrateState: boolean
	showWelcome: boolean
	theme: any
	mcpServers: McpServer[]
	mcpMarketplaceCatalog: McpMarketplaceCatalog // kilocode_change
	hasSystemPromptOverride?: boolean
	currentCheckpoint?: string
	currentTaskTodos?: TodoItem[] // Initial todos for the current task
	filePaths: string[]
	openedTabs: Array<{ label: string; isActive: boolean; path?: string }>
	// kilocode_change start
	globalRules: ClineRulesToggles
	localRules: ClineRulesToggles
	globalWorkflows: ClineRulesToggles
	localWorkflows: ClineRulesToggles
	// kilocode_change start
	commands: Command[]
	organizationAllowList: OrganizationAllowList
	organizationSettingsVersion: number
	cloudIsAuthenticated: boolean
	cloudOrganizations?: CloudOrganizationMembership[]
	sharingEnabled: boolean
	publicSharingEnabled: boolean
	maxConcurrentFileReads?: number
	allowVeryLargeReads?: boolean // kilocode_change
	mdmCompliant?: boolean
	hasOpenedModeSelector: boolean // New property to track if user has opened mode selector
	setHasOpenedModeSelector: (value: boolean) => void // Setter for the new property
	hasCompletedOnboarding?: boolean // kilocode_change: Track if user has completed onboarding flow
	setHasCompletedOnboarding: (value: boolean) => void // kilocode_change
	alwaysAllowFollowupQuestions: boolean // New property for follow-up questions auto-approve
	setAlwaysAllowFollowupQuestions: (value: boolean) => void // Setter for the new property
	followupAutoApproveTimeoutMs: number | undefined // Timeout in ms for auto-approving follow-up questions
	setFollowupAutoApproveTimeoutMs: (value: number) => void // Setter for the timeout
	condensingApiConfigId?: string
	setCondensingApiConfigId: (value: string) => void
	customCondensingPrompt?: string
	setCustomCondensingPrompt: (value: string) => void
	yoloGatekeeperApiConfigId?: string // kilocode_change: AI gatekeeper for YOLO mode
	setYoloGatekeeperApiConfigId: (value: string) => void // kilocode_change: AI gatekeeper for YOLO mode
	speechToTextStatus?: { available: boolean; reason?: "openaiKeyMissing" | "ffmpegNotInstalled" } // kilocode_change: Speech-to-text availability status with failure reason
	marketplaceItems?: any[]
	marketplaceInstalledMetadata?: MarketplaceInstalledMetadata
	profileThresholds: Record<string, number>
	setProfileThresholds: (value: Record<string, number>) => void
	setApiConfiguration: (config: ProviderSettings) => void
	setCustomInstructions: (value?: string) => void
	setAlwaysAllowReadOnly: (value: boolean) => void
	setAlwaysAllowReadOnlyOutsideWorkspace: (value: boolean) => void
	setAlwaysAllowWrite: (value: boolean) => void
	setAlwaysAllowWriteOutsideWorkspace: (value: boolean) => void
	setAlwaysAllowDelete: (value: boolean) => void // kilocode_change
	setAlwaysAllowExecute: (value: boolean) => void
	setAlwaysAllowBrowser: (value: boolean) => void
	setAlwaysAllowMcp: (value: boolean) => void
	setAlwaysAllowModeSwitch: (value: boolean) => void
	setAlwaysAllowSubtasks: (value: boolean) => void
	setBrowserToolEnabled: (value: boolean) => void
	setShowRooIgnoredFiles: (value: boolean) => void
	setShowAutoApproveMenu: (value: boolean) => void // kilocode_change
	setEnableSubfolderRules: (value: boolean) => void
	setShowAnnouncement: (value: boolean) => void
	setAllowedCommands: (value: string[]) => void
	setDeniedCommands: (value: string[]) => void
	setAllowedMaxRequests: (value: number | undefined) => void
	setAllowedMaxCost: (value: number | undefined) => void
	setSoundEnabled: (value: boolean) => void
	setSoundVolume: (value: number) => void
	terminalShellIntegrationTimeout?: number
	setTerminalShellIntegrationTimeout: (value: number) => void
	terminalShellIntegrationDisabled?: boolean
	setTerminalShellIntegrationDisabled: (value: boolean) => void
	terminalZdotdir?: boolean
	setTerminalZdotdir: (value: boolean) => void
	setTtsEnabled: (value: boolean) => void
	setTtsSpeed: (value: number) => void
	setDiffEnabled: (value: boolean) => void
	setEnableCheckpoints: (value: boolean) => void
	checkpointTimeout: number
	setCheckpointTimeout: (value: number) => void
	setBrowserViewportSize: (value: string) => void
	setFuzzyMatchThreshold: (value: number) => void
	setWriteDelayMs: (value: number) => void
	screenshotQuality?: number
	setScreenshotQuality: (value: number) => void
	terminalOutputLineLimit?: number
	setTerminalOutputLineLimit: (value: number) => void
	terminalOutputCharacterLimit?: number
	setTerminalOutputCharacterLimit: (value: number) => void
	mcpEnabled: boolean
	setMcpEnabled: (value: boolean) => void
	enableMcpServerCreation: boolean
	setEnableMcpServerCreation: (value: boolean) => void
	remoteControlEnabled: boolean
	setRemoteControlEnabled: (value: boolean) => void
	taskSyncEnabled: boolean
	setTaskSyncEnabled: (value: boolean) => void
	featureRoomoteControlEnabled: boolean
	setFeatureRoomoteControlEnabled: (value: boolean) => void
	setCurrentApiConfigName: (value: string) => void
	setListApiConfigMeta: (value: ProviderSettingsEntry[]) => void
	mode: Mode
	setMode: (value: Mode) => void
	setCustomModePrompts: (value: CustomModePrompts) => void
	setCustomSupportPrompts: (value: CustomSupportPrompts) => void
	enhancementApiConfigId?: string
	setEnhancementApiConfigId: (value: string) => void
	commitMessageApiConfigId?: string // kilocode_change
	setCommitMessageApiConfigId: (value: string) => void // kilocode_change
	markNotificationAsDismissed: (notificationId: string) => void // kilocode_change
	ghostServiceSettings?: AutocompleteServiceSettings // kilocode_change
	setAutocompleteServiceSettings: (value: AutocompleteServiceSettings) => void // kilocode_change
	setExperimentEnabled: (id: ExperimentId, enabled: boolean) => void
	setAutoApprovalEnabled: (value: boolean) => void
	customModes: ModeConfig[]
	setCustomModes: (value: ModeConfig[]) => void
	setMaxOpenTabsContext: (value: number) => void
	maxWorkspaceFiles: number
	setMaxWorkspaceFiles: (value: number) => void
	setTelemetrySetting: (value: TelemetrySetting) => void
	remoteBrowserEnabled?: boolean
	setRemoteBrowserEnabled: (value: boolean) => void
	awsUsePromptCache?: boolean
	setAwsUsePromptCache: (value: boolean) => void
	maxReadFileLine: number
	setMaxReadFileLine: (value: number) => void
	maxImageFileSize: number
	setMaxImageFileSize: (value: number) => void
	maxTotalImageSize: number
	setMaxTotalImageSize: (value: number) => void
	machineId?: string
	pinnedApiConfigs?: Record<string, boolean>
	setPinnedApiConfigs: (value: Record<string, boolean>) => void
	togglePinnedApiConfig: (configName: string) => void
	terminalCompressProgressBar?: boolean
	setTerminalCompressProgressBar: (value: boolean) => void
	setHistoryPreviewCollapsed: (value: boolean) => void
	setReasoningBlockCollapsed: (value: boolean) => void
	enterBehavior?: "send" | "newline"
	setEnterBehavior: (value: "send" | "newline") => void
	autoCondenseContext: boolean
	setAutoCondenseContext: (value: boolean) => void
	autoCondenseContextPercent: number
	setAutoCondenseContextPercent: (value: number) => void
	routerModels?: RouterModels
	includeDiagnosticMessages?: boolean
	setIncludeDiagnosticMessages: (value: boolean) => void
	maxDiagnosticMessages?: number
	setMaxDiagnosticMessages: (value: number) => void
	includeTaskHistoryInEnhance?: boolean
	setIncludeTaskHistoryInEnhance: (value: boolean) => void
	includeCurrentTime?: boolean
	setIncludeCurrentTime: (value: boolean) => void
	includeCurrentCost?: boolean
	setIncludeCurrentCost: (value: boolean) => void
}

export const ExtensionStateContext = createContext<ExtensionStateContextType | undefined>(undefined)

export const mergeExtensionState = (prevState: ExtensionState, newState: ExtensionState) => {
	const { customModePrompts: prevCustomModePrompts, experiments: prevExperiments, ...prevRest } = prevState

	const {
		apiConfiguration,
		customModePrompts: newCustomModePrompts,
		customSupportPrompts,
		experiments: newExperiments,
		...newRest
	} = newState

	const customModePrompts = { ...prevCustomModePrompts, ...newCustomModePrompts }
	const experiments = { ...prevExperiments, ...newExperiments }
	const rest = { ...prevRest, ...newRest }

	// Note that we completely replace the previous apiConfiguration and customSupportPrompts objects
	// with new ones since the state that is broadcast is the entire objects so merging is not necessary.
	return { ...rest, apiConfiguration, customModePrompts, customSupportPrompts, experiments }
}

export const ExtensionStateContextProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [state, setState] = useState<ExtensionState>({
		apiConfiguration: {},
		version: "",
		clineMessages: [],
		taskHistoryFullLength: 0, // kilocode_change
		taskHistoryVersion: 0, // kilocode_change
		shouldShowAnnouncement: false,
		allowedCommands: [],
		deniedCommands: [],
		soundEnabled: false,
		soundVolume: 0.5,
		isBrowserSessionActive: false,
		ttsEnabled: false,
		ttsSpeed: 1.0,
		diffEnabled: false,
		enableCheckpoints: true,
		checkpointTimeout: DEFAULT_CHECKPOINT_TIMEOUT_SECONDS, // Default to 15 seconds
		fuzzyMatchThreshold: 1.0,
		language: "en", // Default language code
		writeDelayMs: 1000,
		browserViewportSize: "900x600",
		screenshotQuality: 75,
		terminalOutputLineLimit: 500,
		terminalOutputCharacterLimit: 50000,
		terminalShellIntegrationTimeout: 4000,
		mcpEnabled: true,
		enableMcpServerCreation: false,
		remoteControlEnabled: false,
		taskSyncEnabled: false,
		featureRoomoteControlEnabled: false,
		alwaysAllowWrite: true, // kilocode_change
		alwaysAllowReadOnly: true, // kilocode_change
		alwaysAllowDelete: false, // kilocode_change
		requestDelaySeconds: 5,
		currentApiConfigName: "default",
		listApiConfigMeta: [],
		mode: defaultModeSlug,
		customModePrompts: defaultPrompts,
		customSupportPrompts: {},
		experiments: experimentDefault,
		enhancementApiConfigId: "",
		dismissedNotificationIds: [], // kilocode_change
		commitMessageApiConfigId: "", // kilocode_change
		ghostServiceSettings: {}, // kilocode_change
		condensingApiConfigId: "", // Default empty string for condensing API config ID
		customCondensingPrompt: "", // Default empty string for custom condensing prompt
		yoloGatekeeperApiConfigId: "", // kilocode_change: Default empty string for gatekeeper API config ID
		hasOpenedModeSelector: false, // Default to false (not opened yet)
		hasCompletedOnboarding: undefined, // kilocode_change: Leave unset until extension sends value
		autoApprovalEnabled: true,
		customModes: [],
		maxOpenTabsContext: 20,
		maxWorkspaceFiles: 200,
		cwd: "",
		browserToolEnabled: true,
		telemetrySetting: "unset",
		showRooIgnoredFiles: true, // Default to showing .rooignore'd files with lock symbol (current behavior).
		showAutoApproveMenu: false, // kilocode_change
		enableSubfolderRules: false, // Default to disabled - must be enabled to load rules from subdirectories
		renderContext: "sidebar",
		maxReadFileLine: 500 /*kilocode_change*/, // Default max read file line limit
		maxImageFileSize: 5, // Default max image file size in MB
		maxTotalImageSize: 20, // Default max total image size in MB
		pinnedApiConfigs: {}, // Empty object for pinned API configs
		terminalZshOhMy: false, // Default Oh My Zsh integration setting
		maxConcurrentFileReads: 5, // Default concurrent file reads
		allowVeryLargeReads: false, // kilocode_change
		terminalZshP10k: false, // Default Powerlevel10k integration setting
		terminalZdotdir: false, // Default ZDOTDIR handling setting
		terminalCompressProgressBar: true, // Default to compress progress bar output
		historyPreviewCollapsed: false, // Initialize the new state (default to expanded)
		showTaskTimeline: true, // kilocode_change
		sendMessageOnEnter: true, // kilocode_change
		showTimestamps: true, // kilocode_change
		showDiffStats: true, // kilocode_change
		kilocodeDefaultModel: openRouterDefaultModelId,
		reasoningBlockCollapsed: true, // Default to collapsed
		enterBehavior: "send", // Default: Enter sends, Shift+Enter creates newline
		cloudUserInfo: null,
		cloudIsAuthenticated: false,
		cloudOrganizations: [],
		sharingEnabled: false,
		publicSharingEnabled: false,
		organizationAllowList: ORGANIZATION_ALLOW_ALL,
		organizationSettingsVersion: -1,
		autoCondenseContext: true,
		autoCondenseContextPercent: 100,
		profileThresholds: {},
		codebaseIndexConfig: {
			codebaseIndexEnabled: true,
			codebaseIndexQdrantUrl: "http://localhost:6333",
			codebaseIndexEmbedderProvider: "openai",
			// kilocode_change start
			codebaseIndexVectorStoreProvider: "qdrant",
			codebaseIndexLancedbVectorStoreDirectory: undefined,
			// kilocode_change end
			codebaseIndexEmbedderBaseUrl: "",
			codebaseIndexEmbedderModelId: "",
			codebaseIndexSearchMaxResults: undefined,
			codebaseIndexSearchMinScore: undefined,
		},
		codebaseIndexModels: { ollama: {}, openai: {} },
		includeDiagnosticMessages: true,
		maxDiagnosticMessages: 50,
		openRouterImageApiKey: "",
		kiloCodeImageApiKey: "",
		// kilocode_change start - Auto Purge
		autoPurgeEnabled: false,
		autoPurgeDefaultRetentionDays: 30,
		autoPurgeFavoritedTaskRetentionDays: null,
		autoPurgeCompletedTaskRetentionDays: 30,
		autoPurgeIncompleteTaskRetentionDays: 7,
		autoPurgeLastRunTimestamp: undefined,
		// kilocode_change end
		openRouterImageGenerationSelectedModel: "",
		includeCurrentTime: true,
		includeCurrentCost: true,
	})

	const [didHydrateState, setDidHydrateState] = useState(false)
	const [showWelcome, setShowWelcome] = useState(false)
	const [theme, setTheme] = useState<any>(undefined)
	const [filePaths, setFilePaths] = useState<string[]>([])
	const [openedTabs, setOpenedTabs] = useState<Array<{ label: string; isActive: boolean; path?: string }>>([])
	const [commands, setCommands] = useState<Command[]>([])
	const [mcpServers, setMcpServers] = useState<McpServer[]>([])
	const [mcpMarketplaceCatalog, setMcpMarketplaceCatalog] = useState<McpMarketplaceCatalog>({ items: [] }) // kilocode_change
	const [currentCheckpoint, setCurrentCheckpoint] = useState<string>()
	const [extensionRouterModels, setExtensionRouterModels] = useState<RouterModels | undefined>(undefined)
	// kilocode_change start
	const [globalRules, setGlobalRules] = useState<ClineRulesToggles>({})
	const [localRules, setLocalRules] = useState<ClineRulesToggles>({})
	const [globalWorkflows, setGlobalWorkflows] = useState<ClineRulesToggles>({})
	const [localWorkflows, setLocalWorkflows] = useState<ClineRulesToggles>({})
	// kilocode_change end
	const [marketplaceItems, setMarketplaceItems] = useState<any[]>([])
	const [alwaysAllowFollowupQuestions, setAlwaysAllowFollowupQuestions] = useState(false) // Add state for follow-up questions auto-approve
	const [followupAutoApproveTimeoutMs, setFollowupAutoApproveTimeoutMs] = useState<number | undefined>(undefined) // Will be set from global settings
	const [marketplaceInstalledMetadata, setMarketplaceInstalledMetadata] = useState<MarketplaceInstalledMetadata>({
		project: {},
		global: {},
	})
	const [includeTaskHistoryInEnhance, setIncludeTaskHistoryInEnhance] = useState(true)
	const [prevCloudIsAuthenticated, setPrevCloudIsAuthenticated] = useState(false)
	const [includeCurrentTime, setIncludeCurrentTime] = useState(true)
	const [includeCurrentCost, setIncludeCurrentCost] = useState(true)

	const setListApiConfigMeta = useCallback(
		(value: ProviderSettingsEntry[]) => setState((prevState) => ({ ...prevState, listApiConfigMeta: value })),
		[],
	)

	const setApiConfiguration = useCallback((value: ProviderSettings) => {
		setState((prevState) => ({
			...prevState,
			apiConfiguration: {
				...prevState.apiConfiguration,
				...value,
			},
		}))
	}, [])

	const handleMessage = useCallback(
		(event: MessageEvent) => {
			const message: ExtensionMessage = event.data
			switch (message.type) {
				case "state": {
					const newState = message.state!
					setState((prevState) => mergeExtensionState(prevState, newState))
					setShowWelcome(!checkExistKey(newState.apiConfiguration))
					setDidHydrateState(true)
					// Update alwaysAllowFollowupQuestions if present in state message
					if ((newState as any).alwaysAllowFollowupQuestions !== undefined) {
						setAlwaysAllowFollowupQuestions((newState as any).alwaysAllowFollowupQuestions)
					}
					// Update followupAutoApproveTimeoutMs if present in state message
					if ((newState as any).followupAutoApproveTimeoutMs !== undefined) {
						setFollowupAutoApproveTimeoutMs((newState as any).followupAutoApproveTimeoutMs)
					}
					// Update includeTaskHistoryInEnhance if present in state message
					if ((newState as any).includeTaskHistoryInEnhance !== undefined) {
						setIncludeTaskHistoryInEnhance((newState as any).includeTaskHistoryInEnhance)
					}
					// Update includeCurrentTime if present in state message
					if ((newState as any).includeCurrentTime !== undefined) {
						setIncludeCurrentTime((newState as any).includeCurrentTime)
					}
					// Update includeCurrentCost if present in state message
					if ((newState as any).includeCurrentCost !== undefined) {
						setIncludeCurrentCost((newState as any).includeCurrentCost)
					}
					// Handle marketplace data if present in state message
					if (newState.marketplaceItems !== undefined) {
						setMarketplaceItems(newState.marketplaceItems)
					}
					if (newState.marketplaceInstalledMetadata !== undefined) {
						setMarketplaceInstalledMetadata(newState.marketplaceInstalledMetadata)
					}
					break
				}
				case "action": {
					if (message.action === "toggleAutoApprove") {
						// Toggle the auto-approval state
						setState((prevState) => {
							const newValue = !(prevState.autoApprovalEnabled ?? false)
							// Also send the update to the extension
							vscode.postMessage({ type: "autoApprovalEnabled", bool: newValue })
							return { ...prevState, autoApprovalEnabled: newValue }
						})
					}
					break
				}
				case "theme": {
					if (message.text) {
						setTheme(convertTextMateToHljs(JSON.parse(message.text)))
					}
					break
				}
				case "workspaceUpdated": {
					const paths = message.filePaths ?? []
					const tabs = message.openedTabs ?? []

					setFilePaths(paths)
					setOpenedTabs(tabs)
					break
				}
				case "commands": {
					setCommands(message.commands ?? [])
					break
				}
				case "messageUpdated": {
					const clineMessage = message.clineMessage!
					setState((prevState) => {
						// worth noting it will never be possible for a more up-to-date message to be sent here or in normal messages post since the presentAssistantContent function uses lock
						const lastIndex = findLastIndex(prevState.clineMessages, (msg) => msg.ts === clineMessage.ts)
						if (lastIndex !== -1) {
							const newClineMessages = [...prevState.clineMessages]
							newClineMessages[lastIndex] = clineMessage
							return { ...prevState, clineMessages: newClineMessages }
						}
						return prevState
					})
					break
				}
				case "mcpServers": {
					setMcpServers(message.mcpServers ?? [])
					break
				}
				// kilocode_change
				case "mcpMarketplaceCatalog": {
					if (message.mcpMarketplaceCatalog) {
						setMcpMarketplaceCatalog(message.mcpMarketplaceCatalog)
					}
					break
				}
				case "rulesData": {
					if (message.globalRules) setGlobalRules(message.globalRules)
					if (message.localRules) setLocalRules(message.localRules)
					if (message.globalWorkflows) setGlobalWorkflows(message.globalWorkflows)
					if (message.localWorkflows) setLocalWorkflows(message.localWorkflows)
					break
				}
				// end kilocode_change
				case "currentCheckpointUpdated": {
					setCurrentCheckpoint(message.text)
					break
				}
				case "listApiConfig": {
					setListApiConfigMeta(message.listApiConfig ?? [])
					break
				}
				case "routerModels": {
					setExtensionRouterModels(message.routerModels)
					break
				}
				case "marketplaceData": {
					if (message.marketplaceItems !== undefined) {
						setMarketplaceItems(message.marketplaceItems)
					}
					if (message.marketplaceInstalledMetadata !== undefined) {
						setMarketplaceInstalledMetadata(message.marketplaceInstalledMetadata)
					}
					break
				}
			}
		},
		[setListApiConfigMeta],
	)

	useEffect(() => {
		window.addEventListener("message", handleMessage)
		return () => {
			window.removeEventListener("message", handleMessage)
		}
	}, [handleMessage])

	useEffect(() => {
		vscode.postMessage({ type: "webviewDidLaunch" })
	}, [])

	// Watch for authentication state changes and refresh Roo models
	useEffect(() => {
		const currentAuth = state.cloudIsAuthenticated ?? false
		const currentProvider = state.apiConfiguration?.apiProvider
		if (!prevCloudIsAuthenticated && currentAuth && currentProvider === "roo") {
			// User just authenticated and Roo is the active provider - refresh Roo models
			vscode.postMessage({ type: "requestRooModels" })
		}
		setPrevCloudIsAuthenticated(currentAuth)
	}, [state.cloudIsAuthenticated, prevCloudIsAuthenticated, state.apiConfiguration?.apiProvider])

	const contextValue: ExtensionStateContextType = {
		...state,
		reasoningBlockCollapsed: state.reasoningBlockCollapsed ?? true,
		didHydrateState,
		showWelcome,
		theme,
		mcpServers,
		mcpMarketplaceCatalog, // kilocode_change
		currentCheckpoint,
		filePaths,
		openedTabs,
		// kilocode_change start
		globalRules,
		localRules,
		globalWorkflows,
		localWorkflows,
		// kilocode_change end
		commands,
		soundVolume: state.soundVolume,
		ttsSpeed: state.ttsSpeed,
		fuzzyMatchThreshold: state.fuzzyMatchThreshold,
		writeDelayMs: state.writeDelayMs,
		screenshotQuality: state.screenshotQuality,
		routerModels: extensionRouterModels,
		cloudIsAuthenticated: state.cloudIsAuthenticated ?? false,
		cloudOrganizations: state.cloudOrganizations ?? [],
		organizationSettingsVersion: state.organizationSettingsVersion ?? -1,
		marketplaceItems,
		marketplaceInstalledMetadata,
		profileThresholds: state.profileThresholds ?? {},
		alwaysAllowFollowupQuestions,
		followupAutoApproveTimeoutMs,
		remoteControlEnabled: state.remoteControlEnabled ?? false,
		taskSyncEnabled: state.taskSyncEnabled,
		featureRoomoteControlEnabled: state.featureRoomoteControlEnabled ?? false,
		setExperimentEnabled: (id, enabled) =>
			setState((prevState) => ({ ...prevState, experiments: { ...prevState.experiments, [id]: enabled } })),
		setApiConfiguration,
		setCustomInstructions: (value) => setState((prevState) => ({ ...prevState, customInstructions: value })),
		setAlwaysAllowReadOnly: (value) => setState((prevState) => ({ ...prevState, alwaysAllowReadOnly: value })),
		setAlwaysAllowReadOnlyOutsideWorkspace: (value) =>
			setState((prevState) => ({ ...prevState, alwaysAllowReadOnlyOutsideWorkspace: value })),
		setAlwaysAllowWrite: (value) => setState((prevState) => ({ ...prevState, alwaysAllowWrite: value })),
		setAlwaysAllowWriteOutsideWorkspace: (value) =>
			setState((prevState) => ({ ...prevState, alwaysAllowWriteOutsideWorkspace: value })),
		setAlwaysAllowDelete: (value) => setState((prevState) => ({ ...prevState, alwaysAllowDelete: value })), // kilocode_change
		setAlwaysAllowExecute: (value) => setState((prevState) => ({ ...prevState, alwaysAllowExecute: value })),
		setAlwaysAllowBrowser: (value) => setState((prevState) => ({ ...prevState, alwaysAllowBrowser: value })),
		setAlwaysAllowMcp: (value) => setState((prevState) => ({ ...prevState, alwaysAllowMcp: value })),
		setAlwaysAllowModeSwitch: (value) => setState((prevState) => ({ ...prevState, alwaysAllowModeSwitch: value })),
		setAlwaysAllowSubtasks: (value) => setState((prevState) => ({ ...prevState, alwaysAllowSubtasks: value })),
		setAlwaysAllowFollowupQuestions,
		setFollowupAutoApproveTimeoutMs: (value) =>
			setState((prevState) => ({ ...prevState, followupAutoApproveTimeoutMs: value })),
		setShowAnnouncement: (value) => setState((prevState) => ({ ...prevState, shouldShowAnnouncement: value })),
		setAllowedCommands: (value) => setState((prevState) => ({ ...prevState, allowedCommands: value })),
		setDeniedCommands: (value) => setState((prevState) => ({ ...prevState, deniedCommands: value })),
		setAllowedMaxRequests: (value) => setState((prevState) => ({ ...prevState, allowedMaxRequests: value })),
		setAllowedMaxCost: (value) => setState((prevState) => ({ ...prevState, allowedMaxCost: value })),
		setSoundEnabled: (value) => setState((prevState) => ({ ...prevState, soundEnabled: value })),
		setSoundVolume: (value) => setState((prevState) => ({ ...prevState, soundVolume: value })),
		setTtsEnabled: (value) => setState((prevState) => ({ ...prevState, ttsEnabled: value })),
		setTtsSpeed: (value) => setState((prevState) => ({ ...prevState, ttsSpeed: value })),
		setDiffEnabled: (value) => setState((prevState) => ({ ...prevState, diffEnabled: value })),
		setEnableCheckpoints: (value) => setState((prevState) => ({ ...prevState, enableCheckpoints: value })),
		setCheckpointTimeout: (value) => setState((prevState) => ({ ...prevState, checkpointTimeout: value })),
		setBrowserViewportSize: (value: string) =>
			setState((prevState) => ({ ...prevState, browserViewportSize: value })),
		setFuzzyMatchThreshold: (value) => setState((prevState) => ({ ...prevState, fuzzyMatchThreshold: value })),
		setWriteDelayMs: (value) => setState((prevState) => ({ ...prevState, writeDelayMs: value })),
		setScreenshotQuality: (value) => setState((prevState) => ({ ...prevState, screenshotQuality: value })),
		setTerminalOutputLineLimit: (value) =>
			setState((prevState) => ({ ...prevState, terminalOutputLineLimit: value })),
		setTerminalOutputCharacterLimit: (value) =>
			setState((prevState) => ({ ...prevState, terminalOutputCharacterLimit: value })),
		setTerminalShellIntegrationTimeout: (value) =>
			setState((prevState) => ({ ...prevState, terminalShellIntegrationTimeout: value })),
		setTerminalShellIntegrationDisabled: (value) =>
			setState((prevState) => ({ ...prevState, terminalShellIntegrationDisabled: value })),
		setTerminalZdotdir: (value) => setState((prevState) => ({ ...prevState, terminalZdotdir: value })),
		setMcpEnabled: (value) => setState((prevState) => ({ ...prevState, mcpEnabled: value })),
		setEnableMcpServerCreation: (value) =>
			setState((prevState) => ({ ...prevState, enableMcpServerCreation: value })),
		setRemoteControlEnabled: (value) => setState((prevState) => ({ ...prevState, remoteControlEnabled: value })),
		setTaskSyncEnabled: (value) => setState((prevState) => ({ ...prevState, taskSyncEnabled: value }) as any),
		setFeatureRoomoteControlEnabled: (value) =>
			setState((prevState) => ({ ...prevState, featureRoomoteControlEnabled: value })),
		setCurrentApiConfigName: (value) => setState((prevState) => ({ ...prevState, currentApiConfigName: value })),
		setListApiConfigMeta,
		setMode: (value: Mode) => setState((prevState) => ({ ...prevState, mode: value })),
		setCustomModePrompts: (value) => setState((prevState) => ({ ...prevState, customModePrompts: value })),
		setCustomSupportPrompts: (value) => setState((prevState) => ({ ...prevState, customSupportPrompts: value })),
		setEnhancementApiConfigId: (value) =>
			setState((prevState) => ({ ...prevState, enhancementApiConfigId: value })),
		// kilocode_change start
		markNotificationAsDismissed: (notificationId) => {
			setState((prevState) => {
				return {
					...prevState,
					dismissedNotificationIds: [notificationId, ...(prevState.dismissedNotificationIds || [])],
				}
			})
		},
		setAutocompleteServiceSettings: (value) =>
			setState((prevState) => ({ ...prevState, ghostServiceSettings: value })),
		setCommitMessageApiConfigId: (value) =>
			setState((prevState) => ({ ...prevState, commitMessageApiConfigId: value })),
		setShowAutoApproveMenu: (value) => setState((prevState) => ({ ...prevState, showAutoApproveMenu: value })),
		setShowTaskTimeline: (value) => setState((prevState) => ({ ...prevState, showTaskTimeline: value })),
		setSendMessageOnEnter: (value) => setState((prevState) => ({ ...prevState, sendMessageOnEnter: value })), // kilocode_change
		setHideCostBelowThreshold: (value) =>
			setState((prevState) => ({ ...prevState, hideCostBelowThreshold: value })),
		setHoveringTaskTimeline: (value) => setState((prevState) => ({ ...prevState, hoveringTaskTimeline: value })),
		setShowTimestamps: (value) => setState((prevState) => ({ ...prevState, showTimestamps: value })),
		setShowDiffStats: (value) => setState((prevState) => ({ ...prevState, showDiffStats: value })), // kilocode_change
		setYoloMode: (value) => setState((prevState) => ({ ...prevState, yoloMode: value })), // kilocode_change
		// kilocode_change end
		setAutoApprovalEnabled: (value) => setState((prevState) => ({ ...prevState, autoApprovalEnabled: value })),
		setCustomModes: (value) => setState((prevState) => ({ ...prevState, customModes: value })),
		setMaxOpenTabsContext: (value) => setState((prevState) => ({ ...prevState, maxOpenTabsContext: value })),
		setMaxWorkspaceFiles: (value) => setState((prevState) => ({ ...prevState, maxWorkspaceFiles: value })),
		setBrowserToolEnabled: (value) => setState((prevState) => ({ ...prevState, browserToolEnabled: value })),
		setTelemetrySetting: (value) => setState((prevState) => ({ ...prevState, telemetrySetting: value })),
		setShowRooIgnoredFiles: (value) => setState((prevState) => ({ ...prevState, showRooIgnoredFiles: value })),
		setEnableSubfolderRules: (value) => setState((prevState) => ({ ...prevState, enableSubfolderRules: value })),
		setRemoteBrowserEnabled: (value) => setState((prevState) => ({ ...prevState, remoteBrowserEnabled: value })),
		setAwsUsePromptCache: (value) => setState((prevState) => ({ ...prevState, awsUsePromptCache: value })),
		setMaxReadFileLine: (value) => setState((prevState) => ({ ...prevState, maxReadFileLine: value })),
		setMaxImageFileSize: (value) => setState((prevState) => ({ ...prevState, maxImageFileSize: value })),
		setMaxTotalImageSize: (value) => setState((prevState) => ({ ...prevState, maxTotalImageSize: value })),
		setPinnedApiConfigs: (value) => setState((prevState) => ({ ...prevState, pinnedApiConfigs: value })),
		setTerminalCompressProgressBar: (value) =>
			setState((prevState) => ({ ...prevState, terminalCompressProgressBar: value })),
		togglePinnedApiConfig: (configId) =>
			setState((prevState) => {
				const currentPinned = prevState.pinnedApiConfigs || {}
				const newPinned = {
					...currentPinned,
					[configId]: !currentPinned[configId],
				}

				// If the config is now unpinned, remove it from the object
				if (!newPinned[configId]) {
					delete newPinned[configId]
				}

				return { ...prevState, pinnedApiConfigs: newPinned }
			}),
		setHistoryPreviewCollapsed: (value) =>
			setState((prevState) => ({ ...prevState, historyPreviewCollapsed: value })),
		setReasoningBlockCollapsed: (value) =>
			setState((prevState) => ({ ...prevState, reasoningBlockCollapsed: value })),
		enterBehavior: state.enterBehavior ?? "send",
		setEnterBehavior: (value) => setState((prevState) => ({ ...prevState, enterBehavior: value })),
		setHasOpenedModeSelector: (value) => setState((prevState) => ({ ...prevState, hasOpenedModeSelector: value })),
		hasCompletedOnboarding: state.hasCompletedOnboarding, // kilocode_change
		setHasCompletedOnboarding: (value) =>
			setState((prevState) => ({ ...prevState, hasCompletedOnboarding: value })), // kilocode_change
		setAutoCondenseContext: (value) => setState((prevState) => ({ ...prevState, autoCondenseContext: value })),
		setAutoCondenseContextPercent: (value) =>
			setState((prevState) => ({ ...prevState, autoCondenseContextPercent: value })),
		setCondensingApiConfigId: (value) => setState((prevState) => ({ ...prevState, condensingApiConfigId: value })),
		setCustomCondensingPrompt: (value) =>
			setState((prevState) => ({ ...prevState, customCondensingPrompt: value })),
		setYoloGatekeeperApiConfigId: (value) =>
			setState((prevState) => ({ ...prevState, yoloGatekeeperApiConfigId: value })), // kilocode_change: AI gatekeeper for YOLO mode
		setProfileThresholds: (value) => setState((prevState) => ({ ...prevState, profileThresholds: value })),
		// kilocode_change start
		setSystemNotificationsEnabled: (value) =>
			setState((prevState) => ({ ...prevState, systemNotificationsEnabled: value })),
		dismissedNotificationIds: state.dismissedNotificationIds || [], // kilocode_change
		// kilocode_change end
		includeDiagnosticMessages: state.includeDiagnosticMessages,
		setIncludeDiagnosticMessages: (value) => {
			setState((prevState) => ({ ...prevState, includeDiagnosticMessages: value }))
		},
		maxDiagnosticMessages: state.maxDiagnosticMessages,
		setMaxDiagnosticMessages: (value) => {
			setState((prevState) => ({ ...prevState, maxDiagnosticMessages: value }))
		},
		// kilocode_change start - Auto-purge setters
		setAutoPurgeEnabled: (value) => setState((prevState) => ({ ...prevState, autoPurgeEnabled: value })),
		setAutoPurgeDefaultRetentionDays: (value) =>
			setState((prevState) => ({ ...prevState, autoPurgeDefaultRetentionDays: value })),
		setAutoPurgeFavoritedTaskRetentionDays: (value) =>
			setState((prevState) => ({ ...prevState, autoPurgeFavoritedTaskRetentionDays: value })),
		setAutoPurgeCompletedTaskRetentionDays: (value) =>
			setState((prevState) => ({ ...prevState, autoPurgeCompletedTaskRetentionDays: value })),
		setAutoPurgeIncompleteTaskRetentionDays: (value) =>
			setState((prevState) => ({ ...prevState, autoPurgeIncompleteTaskRetentionDays: value })),
		setAutoPurgeLastRunTimestamp: (value) =>
			setState((prevState) => ({ ...prevState, autoPurgeLastRunTimestamp: value })),
		// kilocode_change end
		includeTaskHistoryInEnhance,
		setIncludeTaskHistoryInEnhance,
		includeCurrentTime,
		setIncludeCurrentTime,
		includeCurrentCost,
		setIncludeCurrentCost,
	}

	return <ExtensionStateContext.Provider value={contextValue}>{children}</ExtensionStateContext.Provider>
}

export const useExtensionState = () => {
	const context = useContext(ExtensionStateContext)

	if (context === undefined) {
		throw new Error("useExtensionState must be used within an ExtensionStateContextProvider")
	}

	return context
}
