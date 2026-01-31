import { z } from "zod"

import type { GlobalSettings, RooCodeSettings, GlobalState } from "./global-settings.js"
import type { ProviderSettings, ProviderSettingsEntry } from "./provider-settings.js"
import type { HistoryItem } from "./history.js"
import type { ModeConfig, PromptComponent } from "./mode.js"
import type { TelemetrySetting } from "./telemetry.js"
import type { Experiments } from "./experiment.js"
import type { ClineMessage, QueuedMessage } from "./message.js"
import {
	type MarketplaceItem,
	type InstallMarketplaceItemOptions,
	type McpMarketplaceItem,
	type MarketplaceInstalledMetadata,
	marketplaceItemSchema,
} from "./marketplace.js"
import type { TodoItem } from "./todo.js"
import type { CloudUserInfo, CloudOrganizationMembership, OrganizationAllowList, ShareVisibility } from "./cloud.js"
import type { SerializedCustomToolDefinition } from "./custom-tool.js"
import type { GitCommit } from "./git.js"
import type { McpServer } from "./mcp.js"
import type { ModelRecord, RouterModels, ModelInfo } from "./model.js"
import type { CommitRange } from "./kilocode/kilocode.js"
import type { OpenAiCodexRateLimitInfo } from "./providers/openai-codex-rate-limits.js"

// kilocode_change start: Type definitions for Kilo Code-specific features
// SAP AI Core deployment types
export type DeploymentRecord = Record<
	string,
	{
		id: string
		configurationId: string
		configurationName: string
		scenarioId: string
		status: string
		statusMessage?: string
		deploymentUrl?: string
		submissionTime: string
		modifiedTime?: string
		targetStatus?: string
	}
>

// Speech-to-text types
export interface STTSegment {
	text: string
	start: number
	end: number
	isFinal: boolean
}

export interface MicrophoneDevice {
	id: string
	name: string
	isDefault?: boolean
}

// MCP Marketplace types
export interface McpMarketplaceCatalog {
	items: McpMarketplaceItem[]
	lastUpdated?: string
}

export interface McpDownloadResponse {
	// kilocode_change: This payload is used both for the marketplace download details
	// modal and for older install flows. Keep it permissive for backwards compatibility.
	mcpId: string
	// Marketplace download details (preferred)
	githubUrl?: string
	name?: string
	author?: string
	description?: string
	readmeContent?: string
	llmsInstallationContent?: string
	requiresApiKey?: boolean
	// Legacy install response
	success?: boolean
	error?: string
	installPath?: string
}

// Rules and workflows types
export type ClineRulesToggles = Record<string, boolean>

// Wrapper properties
export interface KiloCodeWrapperProperties {
	kiloCodeWrapped: boolean
	wrapperName?: string
	wrapperVersion?: string
	wrapperTitle?: string
}
// kilocode_change end

// Command interface for frontend/backend communication
export interface Command {
	name: string
	source: "global" | "project" | "built-in"
	filePath?: string
	description?: string
	argumentHint?: string
}

// Indexing status types
export interface IndexingStatus {
	systemStatus: string
	message?: string
	processedItems: number
	totalItems: number
	currentItemUnit?: string
	workspacePath?: string
	gitBranch?: string // Current git branch being indexed
	manifest?: {
		totalFiles: number
		totalChunks: number
		lastUpdated: string
	}
}

export interface IndexingStatusUpdateMessage {
	type: "indexingStatusUpdate"
	values: IndexingStatus
}

export interface LanguageModelChatSelector {
	vendor?: string
	family?: string
	version?: string
	id?: string
}

// Represents JSON data that is sent from extension to webview, called
// ExtensionMessage and has 'type' enum which can be 'plusButtonClicked' or
// 'settingsButtonClicked' or 'hello'. Webview will hold state.
/**
 * ExtensionMessage
 * Extension -> Webview | CLI
 */
export interface ExtensionMessage {
	type:
		| "action"
		| "state"
		| "selectedImages"
		| "theme"
		| "workspaceUpdated"
		| "invoke"
		| "messageUpdated"
		| "mcpServers"
		| "enhancedPrompt"
		| "commitSearchResults"
		| "listApiConfig"
		| "routerModels"
		| "openAiModels"
		| "ollamaModels"
		| "lmStudioModels"
		| "vsCodeLmModels"
		| "huggingFaceModels"
		| "sapAiCoreModels" // kilocode_change
		| "sapAiCoreDeployments" // kilocode_change
		| "vsCodeLmApiAvailable"
		| "updatePrompt"
		| "systemPrompt"
		| "autoApprovalEnabled"
		| "yoloMode" // kilocode_change
		| "updateCustomMode"
		| "deleteCustomMode"
		| "exportModeResult"
		| "importModeResult"
		| "checkRulesDirectoryResult"
		| "deleteCustomModeCheck"
		| "currentCheckpointUpdated"
		| "checkpointInitWarning"
		| "insertTextToChatArea" // kilocode_change
		| "showHumanRelayDialog"
		| "humanRelayResponse"
		| "humanRelayCancel"
		| "browserToolEnabled"
		| "browserConnectionResult"
		| "remoteBrowserEnabled"
		| "ttsStart"
		| "ttsStop"
		| "maxReadFileLine"
		| "fileSearchResults"
		| "toggleApiConfigPin"
		| "mcpMarketplaceCatalog" // kilocode_change
		| "mcpDownloadDetails" // kilocode_change
		| "showSystemNotification" // kilocode_change
		| "openInBrowser" // kilocode_change
		| "acceptInput"
		| "focusChatInput" // kilocode_change
		| "stt:started" // kilocode_change: STT session started
		| "stt:transcript" // kilocode_change: STT transcript update
		| "stt:volume" // kilocode_change: STT volume level
		| "stt:stopped" // kilocode_change: STT session stopped
		| "stt:statusResponse" // kilocode_change: Response to stt:checkAvailability request
		| "stt:devices" // kilocode_change: Microphone devices list
		| "stt:deviceSelected" // kilocode_change: Device selection confirmation
		| "setHistoryPreviewCollapsed"
		| "commandExecutionStatus"
		| "mcpExecutionStatus"
		| "vsCodeSetting"
		| "profileDataResponse" // kilocode_change
		| "balanceDataResponse" // kilocode_change
		| "updateProfileData" // kilocode_change
		| "profileConfigurationForEditing" // kilocode_change: Response with profile config for editing
		| "authenticatedUser"
		| "condenseTaskContextStarted"
		| "condenseTaskContextResponse"
		| "singleRouterModelFetchResponse"
		| "rooCreditBalance"
		| "indexingStatusUpdate"
		| "indexCleared"
		| "codebaseIndexConfig"
		| "rulesData" // kilocode_change
		| "marketplaceInstallResult"
		| "marketplaceRemoveResult"
		| "marketplaceData"
		| "mermaidFixResponse" // kilocode_change
		| "tasksByIdResponse" // kilocode_change
		| "taskHistoryResponse" // kilocode_change
		| "shareTaskSuccess"
		| "codeIndexSettingsSaved"
		| "codeIndexSecretStatus"
		| "showDeleteMessageDialog"
		| "showEditMessageDialog"
		| "kilocodeNotificationsResponse" // kilocode_change
		| "usageDataResponse" // kilocode_change
		| "keybindingsResponse" // kilocode_change
		| "autoPurgeEnabled" // kilocode_change
		| "autoPurgeDefaultRetentionDays" // kilocode_change
		| "autoPurgeFavoritedTaskRetentionDays" // kilocode_change
		| "autoPurgeCompletedTaskRetentionDays" // kilocode_change
		| "autoPurgeIncompleteTaskRetentionDays" // kilocode_change
		| "manualPurge" // kilocode_change
		| "commands"
		| "insertTextIntoTextarea"
		| "dismissedUpsells"
		| "interactionRequired"
		| "managedIndexerState" // kilocode_change
		| "managedIndexerEnabled" // kilocode_change
		| "browserSessionUpdate"
		| "browserSessionNavigate"
		| "organizationSwitchResult"
		| "showTimestamps" // kilocode_change
		| "showDiffStats" // kilocode_change
		| "apiMessagesSaved" // kilocode_change: File save event for API messages
		| "taskMessagesSaved" // kilocode_change: File save event for task messages
		| "taskMetadataSaved" // kilocode_change: File save event for task metadata
		| "managedIndexerState" // kilocode_change
		| "singleCompletionResult" // kilocode_change
		| "deviceAuthStarted" // kilocode_change: Device auth initiated
		| "deviceAuthPolling" // kilocode_change: Device auth polling update
		| "deviceAuthComplete" // kilocode_change: Device auth successful
		| "deviceAuthFailed" // kilocode_change: Device auth failed
		| "deviceAuthCancelled" // kilocode_change: Device auth cancelled
		| "chatCompletionResult" // kilocode_change: FIM completion result for chat text area
		| "claudeCodeRateLimits"
		| "customToolsResult"
		| "modes"
		| "taskWithAggregatedCosts"
		| "skillsData"
		| "askReviewScope" // kilocode_change: Review mode scope selection
		| "openAiCodexRateLimits"
	text?: string
	// kilocode_change start
	completionRequestId?: string // Correlation ID from request
	completionText?: string // The completed text
	completionError?: string // Error message if failed
	payload?:
		| ProfileDataResponsePayload
		| BalanceDataResponsePayload
		| TasksByIdResponsePayload
		| TaskHistoryResponsePayload
		| [string, string] // For file save events [taskId, filePath]
	// kilocode_change end
	// Checkpoint warning message
	checkpointWarning?: {
		type: "WAIT_TIMEOUT" | "INIT_TIMEOUT"
		timeout: number
	}
	action?:
		| "chatButtonClicked"
		| "settingsButtonClicked"
		| "historyButtonClicked"
		| "promptsButtonClicked" // kilocode_change
		| "profileButtonClicked" // kilocode_change
		| "marketplaceButtonClicked"
		| "cloudButtonClicked"
		| "didBecomeVisible"
		| "focusInput"
		| "switchTab"
		| "focusChatInput" // kilocode_change
		| "toggleAutoApprove"
	invoke?: "newChat" | "sendMessage" | "primaryButtonClick" | "secondaryButtonClick" | "setChatBoxMessage"
	state?: ExtensionState
	images?: string[]
	filePaths?: string[]
	openedTabs?: Array<{
		label: string
		isActive: boolean
		path?: string
	}>
	clineMessage?: ClineMessage
	routerModels?: RouterModels
	openAiModels?: string[]
	ollamaModels?: ModelRecord
	lmStudioModels?: ModelRecord
	vsCodeLmModels?: { vendor?: string; family?: string; version?: string; id?: string }[]
	huggingFaceModels?: Array<{
		id: string
		object: string
		created: number
		owned_by: string
		providers: Array<{
			provider: string
			status: "live" | "staging" | "error"
			supports_tools?: boolean
			supports_structured_output?: boolean
			context_length?: number
			pricing?: {
				input: number
				output: number
			}
		}>
	}>
	sapAiCoreModels?: ModelRecord // kilocode_change
	sapAiCoreDeployments?: DeploymentRecord // kilocode_change
	mcpServers?: McpServer[]
	commits?: GitCommit[]
	listApiConfig?: ProviderSettingsEntry[]
	apiConfiguration?: ProviderSettings // kilocode_change: For profileConfigurationForEditing response
	sessionId?: string // kilocode_change: STT session ID
	segments?: STTSegment[] // kilocode_change: STT transcript segments (complete state)
	isFinal?: boolean // kilocode_change: STT transcript is final
	level?: number // kilocode_change: STT volume level (0-1)
	reason?: "completed" | "cancelled" | "error" // kilocode_change: STT stop reason
	speechToTextStatus?: { available: boolean; reason?: "openaiKeyMissing" | "ffmpegNotInstalled" } // kilocode_change: Speech-to-text availability status response
	devices?: MicrophoneDevice[] // kilocode_change: Microphone devices list
	device?: MicrophoneDevice | null // kilocode_change: Selected microphone device
	mode?: string
	customMode?: ModeConfig
	slug?: string
	success?: boolean
	/** Generic payload for extension messages that use `values` */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	values?: Record<string, any>
	requestId?: string
	promptText?: string
	results?:
		| { path: string; type: "file" | "folder"; label?: string }[]
		| { name: string; description?: string; argumentHint?: string; source: "global" | "project" | "built-in" }[]
	error?: string
	mcpMarketplaceCatalog?: McpMarketplaceCatalog // kilocode_change
	mcpDownloadDetails?: McpDownloadResponse // kilocode_change
	notificationOptions?: {
		title?: string
		subtitle?: string
		message: string
	} // kilocode_change
	url?: string // kilocode_change
	keybindings?: Record<string, string> // kilocode_change
	setting?: string
	value?: any // eslint-disable-line @typescript-eslint/no-explicit-any
	hasContent?: boolean
	items?: MarketplaceItem[]
	userInfo?: CloudUserInfo
	organizationAllowList?: OrganizationAllowList
	tab?: string
	// kilocode_change: Rules data
	globalRules?: ClineRulesToggles
	localRules?: ClineRulesToggles
	globalWorkflows?: ClineRulesToggles
	localWorkflows?: ClineRulesToggles
	marketplaceItems?: MarketplaceItem[]
	organizationMcps?: MarketplaceItem[]
	marketplaceInstalledMetadata?: MarketplaceInstalledMetadata
	fixedCode?: string | null // For mermaidFixResponse // kilocode_change
	errors?: string[]
	visibility?: ShareVisibility
	rulesFolderPath?: string
	settings?: any // eslint-disable-line @typescript-eslint/no-explicit-any
	messageTs?: number
	hasCheckpoint?: boolean
	context?: string
	// kilocode_change start: Notifications
	notifications?: Array<{
		id: string
		title: string
		message: string
		action?: {
			actionText: string
			actionURL: string
		}
	}>
	// kilocode_change end
	commands?: Command[]
	skills?: Array<{
		// kilocode_change: Skills data
		name: string
		description: string
		path: string
		source: "global" | "project"
		mode?: string
	}>
	queuedMessages?: QueuedMessage[]
	list?: string[] // For dismissedUpsells
	organizationId?: string | null // For organizationSwitchResult
	// kilocode_change start: Managed Indexer
	managedIndexerEnabled?: boolean
	managedIndexerState?: Array<{
		workspaceFolderPath: string
		workspaceFolderName: string
		gitBranch: string | null
		projectId: string | null
		isIndexing: boolean
		hasManifest: boolean
		manifestFileCount: number
		hasWatcher: boolean
		error?: {
			type: string
			message: string
			timestamp: string
			context?: {
				filePath?: string
				branch?: string
				operation?: string
			}
		}
	}> // kilocode_change end: Managed Indexer
	browserSessionMessages?: ClineMessage[] // For browser session panel updates
	isBrowserSessionActive?: boolean // For browser session panel updates
	stepIndex?: number // For browserSessionNavigate: the target step index to display
	// kilocode_change start: Device auth data
	deviceAuthCode?: string
	deviceAuthVerificationUrl?: string
	deviceAuthExpiresIn?: number
	deviceAuthTimeRemaining?: number
	deviceAuthToken?: string
	deviceAuthUserEmail?: string
	deviceAuthError?: string
	// kilocode_change end: Device auth data
	tools?: SerializedCustomToolDefinition[] // For customToolsResult
	modes?: { slug: string; name: string }[] // For modes response
	aggregatedCosts?: {
		// For taskWithAggregatedCosts response
		totalCost: number
		ownCost: number
		childrenCost: number
	}
	historyItem?: HistoryItem
	// kilocode_change start: Review mode
	reviewScopeInfo?: {
		uncommitted: {
			available: boolean
			fileCount: number
			filePreview?: string[]
		}
		branch: {
			available: boolean
			currentBranch: string
			baseBranch: string
			fileCount: number
			filePreview?: string[]
		}
		error?: string
	}
	// kilocode_change end: Review mode
}

export interface OpenAiCodexRateLimitsMessage {
	type: "openAiCodexRateLimits"
	values?: OpenAiCodexRateLimitInfo
	error?: string
}

export type ExtensionState = Pick<
	GlobalSettings,
	| "currentApiConfigName"
	| "listApiConfigMeta"
	| "pinnedApiConfigs"
	| "customInstructions"
	| "dismissedUpsells"
	| "autoApprovalEnabled"
	| "yoloMode" // kilocode_change
	| "alwaysAllowReadOnly"
	| "alwaysAllowReadOnlyOutsideWorkspace"
	| "alwaysAllowWrite"
	| "alwaysAllowWriteOutsideWorkspace"
	| "alwaysAllowWriteProtected"
	| "alwaysAllowDelete" // kilocode_change
	| "alwaysAllowBrowser"
	| "alwaysAllowMcp"
	| "alwaysAllowModeSwitch"
	| "alwaysAllowSubtasks"
	| "alwaysAllowFollowupQuestions"
	| "alwaysAllowExecute"
	| "followupAutoApproveTimeoutMs"
	| "allowedCommands"
	| "deniedCommands"
	| "allowedMaxRequests"
	| "allowedMaxCost"
	| "browserToolEnabled"
	| "browserViewportSize"
	| "showAutoApproveMenu" // kilocode_change
	| "hideCostBelowThreshold" // kilocode_change
	| "screenshotQuality"
	| "remoteBrowserEnabled"
	| "cachedChromeHostUrl"
	| "remoteBrowserHost"
	| "ttsEnabled"
	| "ttsSpeed"
	| "soundEnabled"
	| "soundVolume"
	| "maxConcurrentFileReads"
	| "allowVeryLargeReads" // kilocode_change
	| "terminalOutputLineLimit"
	| "terminalOutputCharacterLimit"
	| "terminalShellIntegrationTimeout"
	| "terminalShellIntegrationDisabled"
	| "terminalCommandDelay"
	| "terminalPowershellCounter"
	| "terminalZshClearEolMark"
	| "terminalZshOhMy"
	| "terminalZshP10k"
	| "terminalZdotdir"
	| "terminalCompressProgressBar"
	| "diagnosticsEnabled"
	| "diffEnabled"
	| "fuzzyMatchThreshold"
	| "morphApiKey" // kilocode_change: Morph fast apply - global setting
	| "fastApplyModel" // kilocode_change: Fast Apply model selection
	| "fastApplyApiProvider" // kilocode_change: Fast Apply model api base url
	// | "experiments" // Optional in GlobalSettings, required here.
	| "language"
	| "modeApiConfigs"
	| "customModePrompts"
	| "customSupportPrompts"
	| "enhancementApiConfigId"
	| "localWorkflowToggles" // kilocode_change
	| "globalRulesToggles" // kilocode_change
	| "localRulesToggles" // kilocode_change
	| "globalWorkflowToggles" // kilocode_change
	| "commitMessageApiConfigId" // kilocode_change
	| "terminalCommandApiConfigId" // kilocode_change
	| "dismissedNotificationIds" // kilocode_change
	| "ghostServiceSettings" // kilocode_change
	| "autoPurgeEnabled" // kilocode_change
	| "autoPurgeDefaultRetentionDays" // kilocode_change
	| "autoPurgeFavoritedTaskRetentionDays" // kilocode_change
	| "autoPurgeCompletedTaskRetentionDays" // kilocode_change
	| "autoPurgeIncompleteTaskRetentionDays" // kilocode_change
	| "autoPurgeLastRunTimestamp" // kilocode_change
	| "condensingApiConfigId"
	| "customCondensingPrompt"
	| "yoloGatekeeperApiConfigId" // kilocode_change: AI gatekeeper for YOLO mode
	| "codebaseIndexConfig"
	| "codebaseIndexModels"
	| "profileThresholds"
	| "systemNotificationsEnabled" // kilocode_change
	| "includeDiagnosticMessages"
	| "maxDiagnosticMessages"
	| "imageGenerationProvider"
	| "openRouterImageGenerationSelectedModel"
	| "includeTaskHistoryInEnhance"
	| "reasoningBlockCollapsed"
	| "enterBehavior"
	| "includeCurrentTime"
	| "includeCurrentCost"
	| "maxGitStatusFiles"
	| "requestDelaySeconds"
	| "selectedMicrophoneDevice" // kilocode_change: Selected microphone device for STT
> & {
	version: string
	clineMessages: ClineMessage[]
	currentTaskItem?: HistoryItem
	currentTaskTodos?: TodoItem[] // Initial todos for the current task
	currentTaskCumulativeCost?: number // cumulative cost including deleted messages
	apiConfiguration: ProviderSettings
	uriScheme?: string
	uiKind?: string // kilocode_change

	kiloCodeWrapperProperties?: KiloCodeWrapperProperties // kilocode_change: Wrapper information

	kilocodeDefaultModel: string
	shouldShowAnnouncement: boolean

	taskHistory?: HistoryItem[] // kilocode_change: Task history items
	taskHistoryFullLength: number // kilocode_change
	taskHistoryVersion: number // kilocode_change

	writeDelayMs: number

	enableCheckpoints: boolean
	checkpointTimeout: number // Timeout for checkpoint initialization in seconds (default: 15)
	maxOpenTabsContext: number // Maximum number of VSCode open tabs to include in context (0-500)
	maxWorkspaceFiles: number // Maximum number of files to include in current working directory details (0-500)
	showRooIgnoredFiles: boolean // Whether to show .kilocodeignore'd files in listings
	enableSubfolderRules: boolean // Whether to load rules from subdirectories
	maxReadFileLine: number // Maximum number of lines to read from a file before truncating
	showAutoApproveMenu: boolean // kilocode_change: Whether to show the auto-approve menu in the chat view
	maxImageFileSize: number // Maximum size of image files to process in MB
	maxTotalImageSize: number // Maximum total size for all images in a single read operation in MB

	experiments: Experiments // Map of experiment IDs to their enabled state

	mcpEnabled: boolean
	enableMcpServerCreation: boolean

	mode: string
	customModes: ModeConfig[]
	toolRequirements?: Record<string, boolean> // Map of tool names to their requirements (e.g. {"apply_diff": true} if diffEnabled)

	cwd?: string // Current working directory
	telemetrySetting: TelemetrySetting
	telemetryKey?: string
	machineId?: string

	renderContext: "sidebar" | "editor"
	settingsImportedAt?: number
	historyPreviewCollapsed?: boolean
	showTaskTimeline?: boolean // kilocode_change
	sendMessageOnEnter?: boolean // kilocode_change
	hideCostBelowThreshold?: number // kilocode_change

	cloudUserInfo: CloudUserInfo | null
	cloudIsAuthenticated: boolean
	cloudAuthSkipModel?: boolean // Flag indicating auth completed without model selection (user should pick 3rd-party provider)
	cloudApiUrl?: string
	cloudOrganizations?: CloudOrganizationMembership[]
	sharingEnabled: boolean
	publicSharingEnabled: boolean
	organizationAllowList: OrganizationAllowList
	organizationSettingsVersion?: number

	isBrowserSessionActive: boolean // Actual browser session state

	autoCondenseContext: boolean
	autoCondenseContextPercent: number
	marketplaceItems?: MarketplaceItem[]
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	marketplaceInstalledMetadata?: { project: Record<string, any>; global: Record<string, any> }
	profileThresholds: Record<string, number>
	hasOpenedModeSelector: boolean
	openRouterImageApiKey?: string
	kiloCodeImageApiKey?: string
	openRouterUseMiddleOutTransform?: boolean
	messageQueue?: QueuedMessage[]
	lastShownAnnouncementId?: string
	apiModelId?: string
	mcpServers?: McpServer[]
	hasSystemPromptOverride?: boolean
	mdmCompliant?: boolean
	remoteControlEnabled: boolean
	taskSyncEnabled: boolean
	featureRoomoteControlEnabled: boolean
	virtualQuotaActiveModel?: { id: string; info: ModelInfo; activeProfileNumber?: number } // kilocode_change: Add virtual quota active model for UI display with profile number
	showTimestamps?: boolean // kilocode_change: Show timestamps in chat messages
	showDiffStats?: boolean // kilocode_change: Show diff stats in task header
	claudeCodeIsAuthenticated?: boolean
	openAiCodexIsAuthenticated?: boolean
	debug?: boolean
	speechToTextStatus?: { available: boolean; reason?: "openaiKeyMissing" | "ffmpegNotInstalled" } // kilocode_change: Speech-to-text availability status with failure reason
	appendSystemPrompt?: string // kilocode_change: Custom text to append to system prompt (CLI only)
}

export interface Command {
	name: string
	source: "global" | "project" | "built-in"
	filePath?: string
	description?: string
	argumentHint?: string
}

/**
 * WebviewMessage
 * Webview | CLI -> Extension
 */

export type ClineAskResponse =
	| "yesButtonClicked"
	| "noButtonClicked"
	| "messageResponse"
	| "objectResponse"
	| "retry_clicked" // kilocode_change: Added retry_clicked for payment required dialog

export type AudioType = "notification" | "celebration" | "progress_loop"

export interface UpdateTodoListPayload {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	todos: any[]
}

export type EditQueuedMessagePayload = Pick<QueuedMessage, "id" | "text" | "images">

// kilocode_change start: Type-safe global state update message
export type GlobalStateValue<K extends keyof GlobalState> = GlobalState[K]
export type UpdateGlobalStateMessage<K extends keyof GlobalState = keyof GlobalState> = {
	type: "updateGlobalState"
	stateKey: K
	stateValue: GlobalStateValue<K>
}
// kilocode_change end: Type-safe global state update message

export interface WebviewMessage {
	type:
		| "updateTodoList"
		| "deleteMultipleTasksWithIds"
		| "currentApiConfigName"
		| "saveApiConfiguration"
		| "upsertApiConfiguration"
		| "deleteApiConfiguration"
		| "loadApiConfiguration"
		| "loadApiConfigurationById"
		| "getProfileConfigurationForEditing" // kilocode_change: Request to get profile config without activating
		| "renameApiConfiguration"
		| "getListApiConfiguration"
		| "customInstructions"
		| "webviewDidLaunch"
		| "newTask"
		| "askResponse"
		| "terminalOperation"
		| "clearTask"
		| "didShowAnnouncement"
		| "selectImages"
		| "exportCurrentTask"
		| "shareCurrentTask"
		| "showTaskWithId"
		| "deleteTaskWithId"
		| "exportTaskWithId"
		| "importSettings"
		| "exportSettings"
		| "resetState"
		| "flushRouterModels"
		| "requestRouterModels"
		| "requestOpenAiModels"
		| "requestOllamaModels"
		| "requestLmStudioModels"
		| "requestRooModels"
		| "requestRooCreditBalance"
		| "requestVsCodeLmModels"
		| "requestHuggingFaceModels"
		| "requestSapAiCoreModels" // kilocode_change
		| "requestSapAiCoreDeployments" // kilocode_change
		| "openImage"
		| "saveImage"
		| "openFile"
		| "openMention"
		| "cancelTask"
		| "cancelAutoApproval"
		| "updateVSCodeSetting"
		| "getVSCodeSetting"
		| "vsCodeSetting"
		| "updateCondensingPrompt"
		| "yoloGatekeeperApiConfigId" // kilocode_change: AI gatekeeper for YOLO mode
		| "playSound"
		| "playTts"
		| "stopTts"
		| "ttsEnabled"
		| "ttsSpeed"
		| "openKeyboardShortcuts"
		| "openMcpSettings"
		| "openProjectMcpSettings"
		| "restartMcpServer"
		| "refreshAllMcpServers"
		| "toggleToolAlwaysAllow"
		| "toggleToolEnabledForPrompt"
		| "toggleMcpServer"
		| "updateMcpTimeout"
		| "fuzzyMatchThreshold" // kilocode_change
		| "morphApiKey" // kilocode_change: Morph fast apply - global setting
		| "fastApplyModel" // kilocode_change: Fast Apply model selection
		| "fastApplyApiProvider" // kilocode_change: Fast Apply model api base url
		| "writeDelayMs" // kilocode_change
		| "diagnosticsEnabled" // kilocode_change
		| "enhancePrompt"
		| "enhancedPrompt"
		| "draggedImages"
		| "deleteMessage"
		| "deleteMessageConfirm"
		| "submitEditedMessage"
		| "editMessageConfirm"
		| "enableMcpServerCreation"
		| "remoteControlEnabled"
		| "taskSyncEnabled"
		| "searchCommits"
		| "setApiConfigPassword"
		| "mode"
		| "updatePrompt"
		| "getSystemPrompt"
		| "copySystemPrompt"
		| "systemPrompt"
		| "enhancementApiConfigId"
		| "commitMessageApiConfigId" // kilocode_change
		| "terminalCommandApiConfigId" // kilocode_change
		| "ghostServiceSettings" // kilocode_change
		| "stt:start" // kilocode_change: Start STT recording
		| "stt:stop" // kilocode_change: Stop STT recording
		| "stt:cancel" // kilocode_change: Cancel STT recording
		| "stt:checkAvailability" // kilocode_change: Check STT availability on demand
		| "stt:listDevices" // kilocode_change: List microphone devices
		| "stt:selectDevice" // kilocode_change: Select microphone device
		| "includeTaskHistoryInEnhance" // kilocode_change
		| "snoozeAutocomplete" // kilocode_change
		| "autoApprovalEnabled"
		| "yoloMode" // kilocode_change
		| "updateCustomMode"
		| "deleteCustomMode"
		| "setopenAiCustomModelInfo"
		| "openCustomModesSettings"
		| "checkpointDiff"
		| "checkpointRestore"
		| "requestCheckpointRestoreApproval" // kilocode_change: Request approval for checkpoint restore
		| "seeNewChanges" // kilocode_change
		| "deleteMcpServer"
		| "mcpServerOAuthSignIn" // kilocode_change: Initiate OAuth sign-in for an MCP server
		| "insertTextToChatArea" // kilocode_change
		| "humanRelayResponse" // kilocode_change
		| "humanRelayCancel" // kilocode_change
		| "codebaseIndexEnabled"
		| "telemetrySetting"
		| "testBrowserConnection"
		| "browserConnectionResult"
		| "allowVeryLargeReads" // kilocode_change
		| "showFeedbackOptions" // kilocode_change
		| "fetchMcpMarketplace" // kilocode_change
		| "silentlyRefreshMcpMarketplace" // kilocode_change
		| "fetchLatestMcpServersFromHub" // kilocode_change
		| "downloadMcp" // kilocode_change
		| "showSystemNotification" // kilocode_change
		| "showAutoApproveMenu" // kilocode_change
		| "reportBug" // kilocode_change
		| "profileButtonClicked" // kilocode_change
		| "fetchProfileDataRequest" // kilocode_change
		| "profileDataResponse" // kilocode_change
		| "fetchBalanceDataRequest" // kilocode_change
		| "shopBuyCredits" // kilocode_change
		| "balanceDataResponse" // kilocode_change
		| "updateProfileData" // kilocode_change
		| "condense" // kilocode_change
		| "toggleWorkflow" // kilocode_change
		| "refreshRules" // kilocode_change
		| "toggleRule" // kilocode_change
		| "createRuleFile" // kilocode_change
		| "deleteRuleFile" // kilocode_change
		| "searchFiles"
		| "toggleApiConfigPin"
		| "hasOpenedModeSelector"
		| "clearCloudAuthSkipModel"
		| "cloudButtonClicked"
		| "rooCloudSignIn"
		| "cloudLandingPageSignIn"
		| "rooCloudSignOut"
		| "rooCloudManualUrl"
		| "claudeCodeSignIn"
		| "claudeCodeSignOut"
		| "openAiCodexSignIn"
		| "openAiCodexSignOut"
		| "switchOrganization"
		| "condenseTaskContextRequest"
		| "requestIndexingStatus"
		| "startIndexing"
		| "cancelIndexing" // kilocode_change
		| "clearIndexData"
		| "indexingStatusUpdate"
		| "indexCleared"
		| "focusPanelRequest"
		| "clearUsageData" // kilocode_change
		| "getUsageData" // kilocode_change
		| "usageDataResponse" // kilocode_change
		| "showTaskTimeline" // kilocode_change
		| "sendMessageOnEnter" // kilocode_change
		| "showTimestamps" // kilocode_change
		| "showDiffStats" // kilocode_change
		| "hideCostBelowThreshold" // kilocode_change
		| "toggleTaskFavorite" // kilocode_change
		| "fixMermaidSyntax" // kilocode_change
		| "mermaidFixResponse" // kilocode_change
		| "openGlobalKeybindings" // kilocode_change
		| "getKeybindings" // kilocode_change
		| "setHistoryPreviewCollapsed" // kilocode_change
		| "setReasoningBlockCollapsed" // kilocode_change
		| "openExternal"
		| "openInBrowser" // kilocode_change
		| "filterMarketplaceItems"
		| "marketplaceButtonClicked"
		| "installMarketplaceItem"
		| "installMarketplaceItemWithParameters"
		| "cancelMarketplaceInstall"
		| "removeInstalledMarketplaceItem"
		| "marketplaceInstallResult"
		| "fetchMarketplaceData"
		| "switchTab"
		| "profileThresholds" // kilocode_change
		| "editMessage" // kilocode_change
		| "systemNotificationsEnabled" // kilocode_change
		| "dismissNotificationId" // kilocode_change
		| "fetchKilocodeNotifications" // kilocode_change
		| "tasksByIdRequest" // kilocode_change
		| "taskHistoryRequest" // kilocode_change
		| "updateGlobalState" // kilocode_change
		| "autoPurgeEnabled" // kilocode_change
		| "autoPurgeDefaultRetentionDays" // kilocode_change
		| "autoPurgeFavoritedTaskRetentionDays" // kilocode_change
		| "autoPurgeCompletedTaskRetentionDays" // kilocode_change
		| "autoPurgeIncompleteTaskRetentionDays" // kilocode_change
		| "manualPurge" // kilocode_change
		| "shareTaskSuccess" // kilocode_change
		| "shareTaskSuccess"
		| "exportMode"
		| "exportModeResult"
		| "importMode"
		| "importModeResult"
		| "checkRulesDirectory"
		| "checkRulesDirectoryResult"
		| "saveCodeIndexSettingsAtomic"
		| "requestCodeIndexSecretStatus"
		| "requestCommands"
		| "openCommandFile"
		| "deleteCommand"
		| "createCommand"
		| "insertTextIntoTextarea"
		| "showMdmAuthRequiredNotification"
		| "imageGenerationSettings"
		| "kiloCodeImageApiKey" // kilocode_change
		| "queueMessage"
		| "removeQueuedMessage"
		| "editQueuedMessage"
		| "dismissUpsell"
		| "getDismissedUpsells"
		| "openMarkdownPreview"
		| "updateSettings"
		| "requestManagedIndexerState" // kilocode_change
		| "allowedCommands"
		| "getTaskWithAggregatedCosts"
		| "deniedCommands"
		| "killBrowserSession"
		| "openBrowserSessionPanel"
		| "showBrowserSessionPanelAtStep"
		| "refreshBrowserSessionPanel"
		| "browserPanelDidLaunch"
		| "addTaskToHistory" // kilocode_change
		| "sessionShare" // kilocode_change
		| "shareTaskSession" // kilocode_change
		| "sessionFork" // kilocode_change
		| "sessionShow" // kilocode_change
		| "sessionSelect" // kilocode_change
		| "singleCompletion" // kilocode_change
		| "openExtensionSettings" // kilocode_change: Open extension settings from CLI
		| "openDebugApiHistory"
		| "openDebugUiHistory"
		| "startDeviceAuth" // kilocode_change: Start device auth flow
		| "cancelDeviceAuth" // kilocode_change: Cancel device auth flow
		| "deviceAuthCompleteWithProfile" // kilocode_change: Device auth complete with specific profile
		| "requestChatCompletion" // kilocode_change: Request FIM completion for chat text area
		| "chatCompletionAccepted" // kilocode_change: User accepted a chat completion suggestion
		| "downloadErrorDiagnostics"
		| "requestClaudeCodeRateLimits"
		| "requestOpenAiCodexRateLimits"
		| "refreshCustomTools"
		| "requestModes"
		| "switchMode"
		| "debugSetting"
		| "refreshSkills"
		| "reviewScopeSelected" // kilocode_change: Review mode scope selection
	text?: string
	suggestionLength?: number // kilocode_change: Length of accepted suggestion for telemetry
	completionRequestId?: string // kilocode_change
	shareId?: string // kilocode_change - for sessionFork
	sessionId?: string // kilocode_change - for sessionSelect
	editedMessageContent?: string
	tab?: "settings" | "history" | "mcp" | "modes" | "chat" | "marketplace" | "cloud" | "auth" // kilocode_change
	disabled?: boolean
	context?: string
	dataUri?: string
	askResponse?: ClineAskResponse
	apiConfiguration?: ProviderSettings
	images?: string[]
	bool?: boolean
	value?: number
	stepIndex?: number
	isLaunchAction?: boolean
	forceShow?: boolean
	commands?: string[]
	audioType?: AudioType
	// kilocode_change begin
	notificationOptions?: {
		title?: string
		subtitle?: string
		message: string
	}
	mcpId?: string
	toolNames?: string[]
	autoApprove?: boolean
	workflowPath?: string // kilocode_change
	enabled?: boolean // kilocode_change
	rulePath?: string // kilocode_change
	isGlobal?: boolean // kilocode_change
	filename?: string // kilocode_change
	ruleType?: string // kilocode_change
	notificationId?: string // kilocode_change
	commandIds?: string[] // kilocode_change: For getKeybindings
	// kilocode_change end
	serverName?: string
	toolName?: string
	alwaysAllow?: boolean
	isEnabled?: boolean
	mode?: string
	promptMode?: string | "enhance"
	customPrompt?: PromptComponent
	dataUrls?: string[]
	/** Generic payload for webview messages that use `values` */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	values?: Record<string, any>
	query?: string
	setting?: string
	slug?: string
	device?: MicrophoneDevice | null // kilocode_change: Microphone device for stt:selectDevice
	language?: string // kilocode_change: Optional language hint for stt:start
	modeConfig?: ModeConfig
	timeout?: number
	payload?: WebViewMessagePayload
	source?: "global" | "project"
	requestId?: string
	ids?: string[]
	hasSystemPromptOverride?: boolean
	terminalOperation?: "continue" | "abort"
	messageTs?: number
	restoreCheckpoint?: boolean
	historyPreviewCollapsed?: boolean
	filters?: { type?: string; search?: string; tags?: string[] }
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	settings?: any
	url?: string // For openExternal
	mpItem?: MarketplaceItem
	mpInstallOptions?: InstallMarketplaceItemOptions
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	config?: Record<string, any> // Add config to the payload
	visibility?: ShareVisibility // For share visibility
	hasContent?: boolean // For checkRulesDirectoryResult
	checkOnly?: boolean // For deleteCustomMode check
	upsellId?: string // For dismissUpsell
	list?: string[] // For dismissedUpsells response
	organizationId?: string | null // For organization switching
	useProviderSignup?: boolean // For rooCloudSignIn to use provider signup flow
	historyItem?: HistoryItem // kilocode_change For addTaskToHistory
	codeIndexSettings?: {
		// Global state settings
		codebaseIndexEnabled: boolean
		codebaseIndexQdrantUrl: string
		codebaseIndexEmbedderProvider:
			| "openai"
			| "ollama"
			| "openai-compatible"
			| "gemini"
			| "mistral"
			| "vercel-ai-gateway"
			| "bedrock"
			| "openrouter"
		codebaseIndexVectorStoreProvider?: "lancedb" | "qdrant" // kilocode_change
		codebaseIndexLancedbVectorStoreDirectory?: string // kilocode_change
		codebaseIndexEmbedderBaseUrl?: string
		codebaseIndexEmbedderModelId: string
		codebaseIndexEmbedderModelDimension?: number // Generic dimension for all providers
		codebaseIndexOpenAiCompatibleBaseUrl?: string
		codebaseIndexBedrockRegion?: string
		codebaseIndexBedrockProfile?: string
		codebaseIndexSearchMaxResults?: number
		codebaseIndexSearchMinScore?: number
		// kilocode_change start
		codebaseIndexEmbeddingBatchSize?: number
		codebaseIndexScannerMaxBatchRetries?: number
		// kilocode_change end
		codebaseIndexOpenRouterSpecificProvider?: string // OpenRouter provider routing

		// Secret settings
		codeIndexOpenAiKey?: string
		codeIndexQdrantApiKey?: string
		codebaseIndexOpenAiCompatibleApiKey?: string
		codebaseIndexGeminiApiKey?: string
		codebaseIndexMistralApiKey?: string
		codebaseIndexVercelAiGatewayApiKey?: string
		codebaseIndexOpenRouterApiKey?: string
	}
	updatedSettings?: RooCodeSettings
	// kilocode_change start: Review mode
	reviewScope?: "uncommitted" | "branch"
	// kilocode_change end: Review mode
}

// kilocode_change: Create discriminated union for type-safe messages
export type MaybeTypedWebviewMessage = WebviewMessage | UpdateGlobalStateMessage

// kilocode_change begin
export type OrganizationRole = "owner" | "admin" | "member"

export type UserOrganizationWithApiKey = {
	id: string
	name: string
	balance: number
	role: OrganizationRole
	apiKey: string
}

export type ProfileData = {
	kilocodeToken: string
	user: {
		id: string
		name: string
		email: string
		image: string
	}
	organizations?: UserOrganizationWithApiKey[]
}

export interface ProfileDataResponsePayload {
	success: boolean
	data?: ProfileData
	error?: string
}

export interface BalanceDataResponsePayload {
	// New: Payload for balance data
	success: boolean
	data?: unknown
	error?: string
}

export interface SeeNewChangesPayload {
	commitRange: CommitRange
}

export interface TasksByIdRequestPayload {
	requestId: string
	taskIds: string[]
}

export interface TaskHistoryRequestPayload {
	requestId: string
	workspace: "current" | "all"
	sort: "newest" | "oldest" | "mostExpensive" | "mostTokens" | "mostRelevant"
	favoritesOnly: boolean
	pageIndex: number
	search?: string
}

export interface TasksByIdResponsePayload {
	requestId: string
	tasks: HistoryItem[]
}

export interface TaskHistoryResponsePayload {
	requestId: string
	historyItems: HistoryItem[]
	pageIndex: number
	pageCount: number
}
// kilocode_change end

export interface RequestOpenAiCodexRateLimitsMessage {
	type: "requestOpenAiCodexRateLimits"
}

export const checkoutDiffPayloadSchema = z.object({
	ts: z.number().optional(),
	previousCommitHash: z.string().optional(),
	commitHash: z.string(),
	mode: z.enum(["full", "checkpoint", "from-init", "to-current"]),
})

export type CheckpointDiffPayload = z.infer<typeof checkoutDiffPayloadSchema>

export const checkoutRestorePayloadSchema = z.object({
	ts: z.number(),
	commitHash: z.string(),
	mode: z.enum(["preview", "restore"]),
})

export type CheckpointRestorePayload = z.infer<typeof checkoutRestorePayloadSchema>

// kilocode_change start
export const requestCheckpointRestoreApprovalPayloadSchema = z.object({
	commitHash: z.string(),
	checkpointTs: z.number(),
	messagesToRemove: z.number(),
	confirmationText: z.string(),
})

export type RequestCheckpointRestoreApprovalPayload = z.infer<typeof requestCheckpointRestoreApprovalPayloadSchema>
// kilocode_change end

export interface IndexingStatusPayload {
	state: "Standby" | "Indexing" | "Indexed" | "Error"
	message: string
}

export interface IndexClearedPayload {
	success: boolean
	error?: string
}

export const installMarketplaceItemWithParametersPayloadSchema = z.object({
	item: marketplaceItemSchema,
	parameters: z.record(z.string(), z.any()),
})

export type InstallMarketplaceItemWithParametersPayload = z.infer<
	typeof installMarketplaceItemWithParametersPayloadSchema
>

export type WebViewMessagePayload =
	// kilocode_change start
	| ProfileDataResponsePayload
	| BalanceDataResponsePayload
	| SeeNewChangesPayload
	| TasksByIdRequestPayload
	| TaskHistoryRequestPayload
	| RequestCheckpointRestoreApprovalPayload
	// kilocode_change end
	| CheckpointDiffPayload
	| CheckpointRestorePayload
	| IndexingStatusPayload
	| IndexClearedPayload
	| InstallMarketplaceItemWithParametersPayload
	| UpdateTodoListPayload
	| EditQueuedMessagePayload

export interface IndexingStatus {
	systemStatus: string
	message?: string
	processedItems: number
	totalItems: number
	currentItemUnit?: string
	workspacePath?: string
}

export interface IndexingStatusUpdateMessage {
	type: "indexingStatusUpdate"
	values: IndexingStatus
}

export interface LanguageModelChatSelector {
	vendor?: string
	family?: string
	version?: string
	id?: string
}

export interface ClineSayTool {
	tool:
		| "editedExistingFile"
		| "appliedDiff"
		| "newFileCreated"
		| "codebaseSearch"
		| "readFile"
		| "fetchInstructions"
		| "listFilesTopLevel"
		| "listFilesRecursive"
		| "searchFiles"
		| "switchMode"
		| "newTask"
		| "finishTask"
		| "generateImage"
		| "imageGenerated"
		| "runSlashCommand"
		| "updateTodoList"
		| "deleteFile" // kilocode_change: Handles both files and directories
	path?: string
	diff?: string
	content?: string
	// Unified diff statistics computed by the extension
	diffStats?: { added: number; removed: number }
	regex?: string
	filePattern?: string
	mode?: string
	reason?: string
	isOutsideWorkspace?: boolean
	isProtected?: boolean
	additionalFileCount?: number // Number of additional files in the same read_file request
	lineNumber?: number
	query?: string
	// kilocode_change start: Directory stats - only present when deleting directories
	stats?: {
		files: number
		directories: number
		size: number
		isComplete: boolean
	}
	// kilocode_change end
	batchFiles?: Array<{
		path: string
		lineSnippet: string
		isOutsideWorkspace?: boolean
		key: string
		content?: string
	}>
	batchDiffs?: Array<{
		path: string
		changeCount: number
		key: string
		content: string
		// Per-file unified diff statistics computed by the extension
		diffStats?: { added: number; removed: number }
		diffs?: Array<{
			content: string
			startLine?: number
		}>
	}>
	question?: string
	// kilocode_change start
	fastApplyResult?: {
		description?: string
		tokensIn?: number
		tokensOut?: number
		cost?: number
	}
	// kilocode_change end
	imageData?: string // Base64 encoded image data for generated images
	// Properties for runSlashCommand tool
	command?: string
	args?: string
	source?: string
	description?: string
}

// Must keep in sync with system prompt.
export const browserActions = [
	"launch",
	"click",
	"hover",
	"type",
	"press",
	"scroll_down",
	"scroll_up",
	"resize",
	"close",
	"screenshot",
] as const

export type BrowserAction = (typeof browserActions)[number]

export interface ClineSayBrowserAction {
	action: BrowserAction
	coordinate?: string
	size?: string
	text?: string
	executedCoordinate?: string
}

export type BrowserActionResult = {
	screenshot?: string
	logs?: string
	currentUrl?: string
	currentMousePosition?: string
	viewportWidth?: number
	viewportHeight?: number
}

export interface ClineAskUseMcpServer {
	serverName: string
	type: "use_mcp_tool" | "access_mcp_resource"
	toolName?: string
	arguments?: string
	uri?: string
	response?: string
}

export interface ClineApiReqInfo {
	request?: string
	tokensIn?: number
	tokensOut?: number
	cacheWrites?: number
	cacheReads?: number
	cost?: number
	// kilocode_change
	usageMissing?: boolean
	inferenceProvider?: string
	// kilocode_change end
	cancelReason?: ClineApiReqCancelReason
	streamingFailedMessage?: string
	apiProtocol?: "anthropic" | "openai"
}

export type ClineApiReqCancelReason = "streaming_failed" | "user_cancelled"
