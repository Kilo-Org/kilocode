import { z } from "zod"

import {
	type ProviderSettings,
	type PromptComponent,
	type ModeConfig,
	type InstallMarketplaceItemOptions,
	type MarketplaceItem,
	type ShareVisibility,
	type QueuedMessage,
	marketplaceItemSchema,
	// kilocode_change start
	CommitRange,
	HistoryItem,
	GlobalState,
	// kilocode_change end
} from "@roo-code/types"

import { Mode } from "./modes"

export type ClineAskResponse =
	| "yesButtonClicked"
	| "noButtonClicked"
	| "messageResponse"
	| "objectResponse"
	| "retry_clicked" // kilocode_change: Added retry_clicked for payment required dialog

export type PromptMode = Mode | "enhance"

export type AudioType = "notification" | "celebration" | "progress_loop"

export interface UpdateTodoListPayload {
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
		| "allowedCommands"
		| "deniedCommands"
		| "alwaysAllowReadOnly"
		| "alwaysAllowReadOnlyOutsideWorkspace"
		| "alwaysAllowWrite"
		| "alwaysAllowWriteOutsideWorkspace"
		| "alwaysAllowWriteProtected"
		| "alwaysAllowExecute"
		| "alwaysAllowFollowupQuestions"
		| "alwaysAllowUpdateTodoList"
		| "followupAutoApproveTimeoutMs"
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
		| "toggleToolAutoApprove"
		| "openExtensionSettings"
		| "openInBrowser"
		| "fetchOpenGraphData"
		| "checkIsImageUrl"
		| "exportSettings"
		| "resetState"
		| "flushRouterModels"
		| "requestRouterModels"
		| "requestOpenAiModels"
		| "requestOllamaModels"
		| "requestLmStudioModels"
		| "requestRooModels"
		| "requestVsCodeLmModels"
		| "requestHuggingFaceModels"
		| "openImage"
		| "saveImage"
		| "openFile"
		| "openMention"
		| "cancelTask"
		| "updateVSCodeSetting"
		| "getVSCodeSetting"
		| "vsCodeSetting"
		| "alwaysAllowBrowser"
		| "alwaysAllowMcp"
		| "alwaysAllowModeSwitch"
		| "allowedMaxRequests"
		| "allowedMaxCost"
		| "alwaysAllowSubtasks"
		| "alwaysAllowUpdateTodoList"
		| "autoCondenseContext"
		| "autoCondenseContextPercent"
		| "condensingApiConfigId"
		| "updateCondensingPrompt"
		| "yoloGatekeeperApiConfigId" // kilocode_change: AI gatekeeper for YOLO mode
		| "playSound"
		| "playTts"
		| "stopTts"
		| "soundEnabled"
		| "ttsEnabled"
		| "ttsSpeed"
		| "soundVolume"
		| "diffEnabled"
		| "enableCheckpoints"
		| "checkpointTimeout"
		| "browserViewportSize"
		| "screenshotQuality"
		| "remoteBrowserHost"
		| "openKeyboardShortcuts"
		| "openMcpSettings"
		| "openProjectMcpSettings"
		| "restartMcpServer"
		| "refreshAllMcpServers"
		| "toggleToolAlwaysAllow"
		| "toggleToolEnabledForPrompt"
		| "toggleMcpServer"
		| "updateMcpTimeout"
		| "fuzzyMatchThreshold"
		| "morphApiKey" // kilocode_change: Morph fast apply - global setting
		| "fastApplyModel" // kilocode_change: Fast Apply model selection
		| "fastApplyApiProvider" // kilocode_change: Fast Apply model api base url
		| "writeDelayMs"
		| "diagnosticsEnabled"
		| "enhancePrompt"
		| "enhancedPrompt"
		| "draggedImages"
		| "deleteMessage"
		| "deleteMessageConfirm"
		| "submitEditedMessage"
		| "editMessageConfirm"
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
		| "mcpEnabled"
		| "enableMcpServerCreation"
		| "remoteControlEnabled"
		| "taskSyncEnabled"
		| "searchCommits"
		| "alwaysApproveResubmit"
		| "requestDelaySeconds"
		| "setApiConfigPassword"
		| "mode"
		| "updatePrompt"
		| "updateSupportPrompt"
		| "getSystemPrompt"
		| "copySystemPrompt"
		| "systemPrompt"
		| "enhancementApiConfigId"
		| "commitMessageApiConfigId" // kilocode_change
		| "terminalCommandApiConfigId" // kilocode_change
		| "ghostServiceSettings" // kilocode_change
		| "includeTaskHistoryInEnhance"
		| "updateExperimental"
		| "autoApprovalEnabled"
		| "yoloMode" // kilocode_change
		| "updateCustomMode"
		| "deleteCustomMode"
		| "setopenAiCustomModelInfo"
		| "openCustomModesSettings"
		| "checkpointDiff"
		| "checkpointRestore"
		| "requestCheckpointRestoreApproval"
		| "seeNewChanges" // kilocode_change
		| "deleteMcpServer"
		| "maxOpenTabsContext"
		| "maxWorkspaceFiles"
		| "humanRelayResponse"
		| "humanRelayCancel"
		| "insertTextToChatArea" // kilocode_change
		| "browserToolEnabled"
		| "codebaseIndexEnabled"
		| "telemetrySetting"
		| "showRooIgnoredFiles"
		| "testBrowserConnection"
		| "browserConnectionResult"
		| "remoteBrowserEnabled"
		| "language"
		| "maxReadFileLine"
		| "maxImageFileSize"
		| "maxTotalImageSize"
		| "maxConcurrentFileReads"
		| "allowVeryLargeReads" // kilocode_change
		| "includeDiagnosticMessages"
		| "maxDiagnosticMessages"
		| "includeCurrentTime"
		| "includeCurrentCost"
		| "searchFiles"
		| "setHistoryPreviewCollapsed"
		| "showFeedbackOptions" // kilocode_change
		| "toggleApiConfigPin"
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
		| "hasOpenedModeSelector"
		| "cloudButtonClicked"
		| "rooCloudSignIn"
		| "cloudLandingPageSignIn"
		| "rooCloudSignOut"
		| "rooCloudManualUrl"
		| "switchOrganization"
		| "condenseTaskContextRequest"
		| "requestIndexingStatus"
		| "startIndexing"
		| "cancelIndexing" // kilocode_change
		| "clearIndexData"
		| "indexingStatusUpdate"
		| "indexCleared"
		| "focusPanelRequest"
		| "profileThresholds"
		| "setHistoryPreviewCollapsed"
		| "clearUsageData" // kilocode_change
		| "getUsageData" // kilocode_change
		| "usageDataResponse" // kilocode_change
		| "showTaskTimeline" // kilocode_change
		| "sendMessageOnEnter" // kilocode_change
		| "showTimestamps" // kilocode_change
		| "hideCostBelowThreshold" // kilocode_change
		| "toggleTaskFavorite" // kilocode_change
		| "fixMermaidSyntax" // kilocode_change
		| "mermaidFixResponse" // kilocode_change
		| "openGlobalKeybindings" // kilocode_change
		| "getKeybindings" // kilocode_change
		| "setReasoningBlockCollapsed"
		| "openExternal"
		| "filterMarketplaceItems"
		| "mcpButtonClicked"
		| "marketplaceButtonClicked"
		| "installMarketplaceItem"
		| "installMarketplaceItemWithParameters"
		| "cancelMarketplaceInstall"
		| "removeInstalledMarketplaceItem"
		| "marketplaceInstallResult"
		| "fetchMarketplaceData"
		| "switchTab"
		| "profileThresholds"
		| "editMessage" // kilocode_change
		| "systemNotificationsEnabled" // kilocode_change
		| "dismissNotificationId" // kilocode_change
		| "tasksByIdRequest" // kilocode_change
		| "taskHistoryRequest" // kilocode_change
		| "updateGlobalState" // kilocode_change
		| "autoPurgeEnabled" // kilocode_change
		| "autoPurgeDefaultRetentionDays" // kilocode_change
		| "autoPurgeFavoritedTaskRetentionDays" // kilocode_change
		| "autoPurgeCompletedTaskRetentionDays" // kilocode_change
		| "autoPurgeIncompleteTaskRetentionDays" // kilocode_change
		| "manualPurge" // kilocode_change
		| "shareTaskSuccess"
		| "exportMode"
		| "exportModeResult"
		| "importMode"
		| "importModeResult"
		| "checkRulesDirectory"
		| "checkRulesDirectoryResult"
		| "saveCodeIndexSettingsAtomic"
		| "requestCodeIndexSecretStatus"
		| "fetchKilocodeNotifications"
		| "requestCommands"
		| "openCommandFile"
		| "deleteCommand"
		| "createCommand"
		| "insertTextIntoTextarea"
		| "showMdmAuthRequiredNotification"
		| "imageGenerationSettings"
		| "openRouterImageApiKey"
		| "kiloCodeImageApiKey"
		| "openRouterImageGenerationSelectedModel"
		| "queueMessage"
		| "removeQueuedMessage"
		| "editQueuedMessage"
		| "dismissUpsell"
		| "getDismissedUpsells"
		| "requestManagedIndexerState" // kilocode_change
	text?: string
	editedMessageContent?: string
	tab?: "settings" | "history" | "mcp" | "modes" | "chat" | "marketplace" | "cloud"
	disabled?: boolean
	context?: string
	dataUri?: string
	askResponse?: ClineAskResponse
	apiConfiguration?: ProviderSettings
	images?: string[]
	bool?: boolean
	value?: number
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
	mode?: Mode
	promptMode?: PromptMode
	customPrompt?: PromptComponent
	dataUrls?: string[]
	values?: Record<string, any>
	query?: string
	setting?: string
	slug?: string
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
	settings?: any
	url?: string // For openExternal
	mpItem?: MarketplaceItem
	mpInstallOptions?: InstallMarketplaceItemOptions
	config?: Record<string, any> // Add config to the payload
	visibility?: ShareVisibility // For share visibility
	hasContent?: boolean // For checkRulesDirectoryResult
	checkOnly?: boolean // For deleteCustomMode check
	upsellId?: string // For dismissUpsell
	list?: string[] // For dismissedUpsells response
	organizationId?: string | null // For organization switching
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
			| "openrouter"
		codebaseIndexEmbedderBaseUrl?: string
		codebaseIndexEmbedderModelId: string
		codebaseIndexEmbedderModelDimension?: number // Generic dimension for all providers
		codebaseIndexOpenAiCompatibleBaseUrl?: string
		codebaseIndexSearchMaxResults?: number
		codebaseIndexSearchMinScore?: number

		// Secret settings
		codeIndexOpenAiKey?: string
		codeIndexQdrantApiKey?: string
		codebaseIndexOpenAiCompatibleApiKey?: string
		codebaseIndexGeminiApiKey?: string
		codebaseIndexMistralApiKey?: string
		codebaseIndexVercelAiGatewayApiKey?: string
		codebaseIndexOpenRouterApiKey?: string
	}
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
	data?: any // Replace 'any' with a more specific type if known for balance
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

export const requestCheckpointRestoreApprovalPayloadSchema = z.object({
	commitHash: z.string(),
	checkpointTs: z.number(),
	messagesToRemove: z.number(),
	confirmationText: z.string(),
})

export type RequestCheckpointRestoreApprovalPayload = z.infer<typeof requestCheckpointRestoreApprovalPayloadSchema>

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
