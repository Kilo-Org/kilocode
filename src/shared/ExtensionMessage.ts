import type {
	GlobalSettings,
	ProviderSettingsEntry,
	ProviderSettings,
	HistoryItem,
	ModeConfig,
	TelemetrySetting,
	Experiments,
	ClineMessage,
	MarketplaceItem,
	TodoItem,
	CloudUserInfo,
	OrganizationAllowList,
	ShareVisibility,
	QueuedMessage,
} from "@roo-code/types"

import { GitCommit } from "../utils/git"

import { McpServer } from "./mcp"
import { McpMarketplaceCatalog, McpDownloadResponse } from "./kilocode/mcp"
import { Mode } from "./modes"
import { ModelRecord, RouterModels } from "./api"
import { ProfileDataResponsePayload, BalanceDataResponsePayload } from "./WebviewMessage" // kilocode_change
import { ClineRulesToggles } from "./cline-rules" // kilocode_change
import { KiloCodeWrapperProperties } from "./kilocode/wrapper" // kilocode_change

// Command interface for frontend/backend communication
export interface Command {
	name: string
	source: "global" | "project" | "built-in"
	filePath?: string
	description?: string
	argumentHint?: string
}

// Type for marketplace installed metadata
export interface MarketplaceInstalledMetadata {
	project: Record<string, { type: string }>
	global: Record<string, { type: string }>
}

// Indexing status types
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

// Represents JSON data that is sent from extension to webview, called
// ExtensionMessage and has 'type' enum which can be 'plusButtonClicked' or
// 'settingsButtonClicked' or 'hello'. Webview will hold state.
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
		| "vsCodeLmApiAvailable"
		| "updatePrompt"
		| "systemPrompt"
		| "autoApprovalEnabled"
		| "updateCustomMode"
		| "deleteCustomMode"
		| "exportModeResult"
		| "importModeResult"
		| "checkRulesDirectoryResult"
		| "deleteCustomModeCheck"
		| "currentCheckpointUpdated"
		| "showHumanRelayDialog"
		| "humanRelayResponse"
		| "humanRelayCancel"
		| "insertTextToChatArea" // kilocode_change
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
		| "setHistoryPreviewCollapsed"
		| "commandExecutionStatus"
		| "mcpExecutionStatus"
		| "vsCodeSetting"
		| "profileDataResponse" // kilocode_change
		| "balanceDataResponse" // kilocode_change
		| "updateProfileData" // kilocode_change
		| "authenticatedUser"
		| "condenseTaskContextResponse"
		| "singleRouterModelFetchResponse"
		| "indexingStatusUpdate"
		| "indexCleared"
		| "codebaseIndexConfig"
		| "rulesData" // kilocode_change
		| "marketplaceInstallResult"
		| "marketplaceRemoveResult"
		| "marketplaceData"
		| "mermaidFixResponse" // kilocode_change
		| "shareTaskSuccess"
		| "codeIndexSettingsSaved"
		| "codeIndexSecretStatus"
		| "showDeleteMessageDialog"
		| "showEditMessageDialog"
		| "kilocodeNotificationsResponse" // kilocode_change
		| "usageDataResponse" // kilocode_change
		| "autoPurgeEnabled" // kilocode_change
		| "autoPurgeDefaultRetentionDays" // kilocode_change
		| "autoPurgeFavoritedTaskRetentionDays" // kilocode_change
		| "autoPurgeCompletedTaskRetentionDays" // kilocode_change
		| "autoPurgeIncompleteTaskRetentionDays" // kilocode_change
		| "manualPurge" // kilocode_change
		| "commands"
		| "insertTextIntoTextarea"
	text?: string
	payload?: ProfileDataResponsePayload | BalanceDataResponsePayload // kilocode_change: Add payload for profile and balance data
	action?:
		| "chatButtonClicked"
		| "mcpButtonClicked"
		| "settingsButtonClicked"
		| "historyButtonClicked"
		| "promptsButtonClicked"
		| "profileButtonClicked" // kilocode_change
		| "marketplaceButtonClicked"
		| "cloudButtonClicked"
		| "didBecomeVisible"
		| "focusInput"
		| "switchTab"
		| "focusChatInput" // kilocode_change
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
	ollamaModels?: string[]
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
	mcpServers?: McpServer[]
	commits?: GitCommit[]
	listApiConfig?: ProviderSettingsEntry[]
	mode?: Mode
	customMode?: ModeConfig
	slug?: string
	success?: boolean
	values?: Record<string, any>
	requestId?: string
	promptText?: string
	results?: { path: string; type: "file" | "folder"; label?: string }[]
	error?: string
	mcpMarketplaceCatalog?: McpMarketplaceCatalog // kilocode_change
	mcpDownloadDetails?: McpDownloadResponse // kilocode_change
	notificationOptions?: {
		title?: string
		subtitle?: string
		message: string
	} // kilocode_change
	url?: string // kilocode_change
	setting?: string
	value?: any
	hasContent?: boolean // For checkRulesDirectoryResult
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
	settings?: any
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
	queuedMessages?: QueuedMessage[]
}

export type ExtensionState = Pick<
	GlobalSettings,
	| "currentApiConfigName"
	| "listApiConfigMeta"
	| "pinnedApiConfigs"
	// | "lastShownAnnouncementId"
	| "customInstructions"
	// | "taskHistory" // Optional in GlobalSettings, required here.
	| "autoApprovalEnabled"
	| "alwaysAllowReadOnly"
	| "alwaysAllowReadOnlyOutsideWorkspace"
	| "alwaysAllowWrite"
	| "alwaysAllowWriteOutsideWorkspace"
	| "alwaysAllowWriteProtected"
	// | "writeDelayMs" // Optional in GlobalSettings, required here.
	| "alwaysAllowBrowser"
	| "alwaysApproveResubmit"
	// | "requestDelaySeconds" // Optional in GlobalSettings, required here.
	| "alwaysAllowMcp"
	| "alwaysAllowModeSwitch"
	| "alwaysAllowSubtasks"
	| "alwaysAllowFollowupQuestions"
	| "alwaysAllowExecute"
	| "alwaysAllowUpdateTodoList"
	| "followupAutoApproveTimeoutMs"
	| "allowedCommands"
	| "deniedCommands"
	| "allowedMaxRequests"
	| "allowedMaxCost"
	| "browserToolEnabled"
	| "browserViewportSize"
	| "showAutoApproveMenu" // kilocode_change
	| "screenshotQuality"
	| "remoteBrowserEnabled"
	| "cachedChromeHostUrl"
	| "remoteBrowserHost"
	// | "enableCheckpoints" // Optional in GlobalSettings, required here.
	| "ttsEnabled"
	| "ttsSpeed"
	| "soundEnabled"
	| "soundVolume"
	// | "maxOpenTabsContext" // Optional in GlobalSettings, required here.
	// | "maxWorkspaceFiles" // Optional in GlobalSettings, required here.
	// | "showRooIgnoredFiles" // Optional in GlobalSettings, required here.
	// | "maxReadFileLine" // Optional in GlobalSettings, required here.
	| "maxConcurrentFileReads" // Optional in GlobalSettings, required here.
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
	// | "experiments" // Optional in GlobalSettings, required here.
	| "language"
	// | "telemetrySetting" // Optional in GlobalSettings, required here.
	// | "mcpEnabled" // Optional in GlobalSettings, required here.
	// | "enableMcpServerCreation" // Optional in GlobalSettings, required here.
	// | "mode" // Optional in GlobalSettings, required here.
	| "modeApiConfigs"
	// | "customModes" // Optional in GlobalSettings, required here.
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
	| "codebaseIndexConfig"
	| "codebaseIndexModels"
	| "profileThresholds"
	| "systemNotificationsEnabled" // kilocode_change
	| "includeDiagnosticMessages"
	| "maxDiagnosticMessages"
	| "remoteControlEnabled"
	| "openRouterImageGenerationSelectedModel"
	| "includeTaskHistoryInEnhance"
> & {
	version: string
	clineMessages: ClineMessage[]
	currentTaskItem?: HistoryItem
	currentTaskTodos?: TodoItem[] // Initial todos for the current task
	apiConfiguration: ProviderSettings
	uriScheme?: string
	uiKind?: string // kilocode_change

	kiloCodeWrapperProperties?: KiloCodeWrapperProperties // kilocode_change: Wrapper information

	kilocodeDefaultModel: string
	shouldShowAnnouncement: boolean

	taskHistory: HistoryItem[]

	writeDelayMs: number
	requestDelaySeconds: number

	enableCheckpoints: boolean
	maxOpenTabsContext: number // Maximum number of VSCode open tabs to include in context (0-500)
	maxWorkspaceFiles: number // Maximum number of files to include in current working directory details (0-500)
	showRooIgnoredFiles: boolean // Whether to show .kilocodeignore'd files in listings
	maxReadFileLine: number // Maximum number of lines to read from a file before truncating
	showAutoApproveMenu: boolean // kilocode_change: Whether to show the auto-approve menu in the chat view
	maxImageFileSize: number // Maximum size of image files to process in MB
	maxTotalImageSize: number // Maximum total size for all images in a single read operation in MB

	experiments: Experiments // Map of experiment IDs to their enabled state

	mcpEnabled: boolean
	enableMcpServerCreation: boolean

	mode: Mode
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

	cloudUserInfo: CloudUserInfo | null
	cloudIsAuthenticated: boolean
	cloudApiUrl?: string
	sharingEnabled: boolean
	organizationAllowList: OrganizationAllowList
	organizationSettingsVersion?: number

	autoCondenseContext: boolean
	autoCondenseContextPercent: number
	marketplaceItems?: MarketplaceItem[]
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
		| "listCodeDefinitionNames"
		| "searchFiles"
		| "switchMode"
		| "newTask"
		| "finishTask"
		| "searchAndReplace"
		| "insertContent"
		| "generateImage"
		| "imageGenerated"
		| "runSlashCommand"
	path?: string
	diff?: string
	content?: string
	regex?: string
	filePattern?: string
	mode?: string
	reason?: string
	isOutsideWorkspace?: boolean
	isProtected?: boolean
	additionalFileCount?: number // Number of additional files in the same read_file request
	search?: string
	replace?: string
	useRegex?: boolean
	ignoreCase?: boolean
	startLine?: number
	endLine?: number
	lineNumber?: number
	query?: string
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
	"scroll_down",
	"scroll_up",
	"resize",
	"close",
] as const

export type BrowserAction = (typeof browserActions)[number]

export interface ClineSayBrowserAction {
	action: BrowserAction
	coordinate?: string
	size?: string
	text?: string
}

export type BrowserActionResult = {
	screenshot?: string
	logs?: string
	currentUrl?: string
	currentMousePosition?: string
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
	usageMissing?: boolean // kilocode_change
	cancelReason?: ClineApiReqCancelReason
	streamingFailedMessage?: string
	apiProtocol?: "anthropic" | "openai"
}

export type ClineApiReqCancelReason = "streaming_failed" | "user_cancelled"
