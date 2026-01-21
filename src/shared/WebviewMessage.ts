import { z } from "zod"

import {
	type RooCodeSettings,
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
import { MicrophoneDevice } from "./sttContract" // kilocode_change: Microphone device type for STT

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
		| "requestCheckpointRestoreApproval"
		| "seeNewChanges" // kilocode_change
		| "deleteMcpServer"
		| "insertTextToChatArea" // kilocode_change
		| "humanRelayResponse"
		| "humanRelayCancel"
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
		| "setReasoningBlockCollapsed"
		| "setHistoryPreviewCollapsed" // kilocode_change
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
		| "profileThresholds" // kilocode_change
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
		| "shareTaskSuccess" // kilocode_change
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
		| "kiloCodeImageApiKey" // kilocode_change
		| "queueMessage"
		| "removeQueuedMessage"
		| "editQueuedMessage"
		| "dismissUpsell"
		| "getDismissedUpsells"
		| "updateSettings"
		| "requestManagedIndexerState" // kilocode_change
		| "allowedCommands"
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
		| "openDebugApiHistory"
		| "openDebugUiHistory"
		| "startDeviceAuth" // kilocode_change: Start device auth flow
		| "cancelDeviceAuth" // kilocode_change: Cancel device auth flow
		| "deviceAuthCompleteWithProfile" // kilocode_change: Device auth complete with specific profile
		| "requestChatCompletion" // kilocode_change: Request FIM completion for chat text area
		| "chatCompletionAccepted" // kilocode_change: User accepted a chat completion suggestion
		| "downloadErrorDiagnostics"
		| "requestClaudeCodeRateLimits"
		| "refreshCustomTools"
	text?: string
	suggestionLength?: number // kilocode_change: Length of accepted suggestion for telemetry
	completionRequestId?: string // kilocode_change
	shareId?: string // kilocode_change - for sessionFork
	sessionId?: string // kilocode_change - for sessionSelect
	editedMessageContent?: string
	tab?: "settings" | "history" | "mcp" | "modes" | "chat" | "marketplace" | "cloud" | "auth" | "skills" // kilocode_change
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
	mode?: Mode
	promptMode?: PromptMode
	customPrompt?: PromptComponent
	dataUrls?: string[]
	values?: Record<string, any>
	query?: string
	setting?: string
	slug?: string
	language?: string // User's language for speech transcription (STT)
	device?: MicrophoneDevice | null // kilocode_change: Microphone device for stt:selectDevice
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
