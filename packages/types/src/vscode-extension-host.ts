import { z } from "zod"

import type { GlobalSettings, RooCodeSettings } from "./global-settings.js"
import type { ProviderSettings, ProviderSettingsEntry } from "./provider-settings.js"
import type { HistoryItem } from "./history.js"
import type { ModeConfig, PromptComponent } from "./mode.js"
import type { TelemetrySetting } from "./telemetry.js"
import type { Experiments } from "./experiment.js"
import type { ClineMessage, QueuedMessage } from "./message.js"
import {
	type MarketplaceItem,
	type MarketplaceInstalledMetadata,
	type InstallMarketplaceItemOptions,
	marketplaceItemSchema,
} from "./marketplace.js"
import type { TodoItem } from "./todo.js"
import type { CloudUserInfo, CloudOrganizationMembership, OrganizationAllowList, ShareVisibility } from "./cloud.js"
import type { SerializedCustomToolDefinition } from "./custom-tool.js"
import type { GitCommit } from "./git.js"
import type { McpServer } from "./mcp.js"
import type { SkillMetadata } from "./skills.js"
import type { ModelRecord, RouterModels } from "./model.js"
import type { OpenAiCodexRateLimitInfo } from "./providers/openai-codex-rate-limits.js"
import type { WorktreeIncludeStatus } from "./worktree.js"

/**
 * ExtensionMessage
 * Extension -> Webview | CLI
 */
export interface ExtensionMessage {
	type:
		| "action"
		| "state"
		| "taskHistoryUpdated"
		| "taskHistoryItemUpdated"
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
		| "checkpointInitWarning"
		| "browserToolEnabled"
		| "browserConnectionResult"
		| "remoteBrowserEnabled"
		| "ttsStart"
		| "ttsStop"
		| "fileSearchResults"
		| "toggleApiConfigPin"
		| "acceptInput"
		| "setHistoryPreviewCollapsed"
		| "commandExecutionStatus"
		| "mcpExecutionStatus"
		| "vsCodeSetting"
		| "authenticatedUser"
		| "condenseTaskContextStarted"
		| "condenseTaskContextResponse"
		| "singleRouterModelFetchResponse"
		| "rooCreditBalance"
		| "indexingStatusUpdate"
		| "indexCleared"
		| "codebaseIndexConfig"
		| "marketplaceInstallResult"
		| "marketplaceRemoveResult"
		| "marketplaceData"
		| "shareTaskSuccess"
		| "codeIndexSettingsSaved"
		| "codeIndexSecretStatus"
		| "showDeleteMessageDialog"
		| "showEditMessageDialog"
		| "commands"
		| "insertTextIntoTextarea"
		| "dismissedUpsells"
		| "organizationSwitchResult"
		| "interactionRequired"
		| "browserSessionUpdate"
		| "browserSessionNavigate"
		| "customToolsResult"
		| "modes"
		| "taskWithAggregatedCosts"
		| "openAiCodexRateLimits"
		// Worktree response types
		| "worktreeList"
		| "worktreeResult"
		| "worktreeCopyProgress"
		| "branchList"
		| "worktreeDefaults"
		| "worktreeIncludeStatus"
		| "branchWorktreeIncludeResult"
		| "folderSelected"
		| "skills"
	text?: string
	payload?: any // eslint-disable-line @typescript-eslint/no-explicit-any
	checkpointWarning?: {
		type: "WAIT_TIMEOUT" | "INIT_TIMEOUT"
		timeout: number
	}
	action?:
		| "chatButtonClicked"
		| "settingsButtonClicked"
		| "historyButtonClicked"
		| "marketplaceButtonClicked"
		| "cloudButtonClicked"
		| "didBecomeVisible"
		| "focusInput"
		| "switchTab"
		| "toggleAutoApprove"
	invoke?: "newChat" | "sendMessage" | "primaryButtonClick" | "secondaryButtonClick" | "setChatBoxMessage"
	/**
	 * Partial state updates are allowed to reduce message size (e.g. omit large fields like taskHistory).
	 * The webview is responsible for merging.
	 */
	state?: Partial<ExtensionState>
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
	mcpServers?: McpServer[]
	commits?: GitCommit[]
	listApiConfig?: ProviderSettingsEntry[]
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
	setting?: string
	value?: any // eslint-disable-line @typescript-eslint/no-explicit-any
	hasContent?: boolean
	items?: MarketplaceItem[]
	userInfo?: CloudUserInfo
	organizationAllowList?: OrganizationAllowList
	tab?: string
	marketplaceItems?: MarketplaceItem[]
	organizationMcps?: MarketplaceItem[]
	marketplaceInstalledMetadata?: MarketplaceInstalledMetadata
	errors?: string[]
	visibility?: ShareVisibility
	rulesFolderPath?: string
	settings?: any // eslint-disable-line @typescript-eslint/no-explicit-any
	messageTs?: number
	hasCheckpoint?: boolean
	context?: string
	commands?: Command[]
	queuedMessages?: QueuedMessage[]
	list?: string[] // For dismissedUpsells
	organizationId?: string | null // For organizationSwitchResult
	browserSessionMessages?: ClineMessage[] // For browser session panel updates
	isBrowserSessionActive?: boolean // For browser session panel updates
	stepIndex?: number // For browserSessionNavigate: the target step index to display
	tools?: SerializedCustomToolDefinition[] // For customToolsResult
	modes?: { slug: string; name: string }[] // For modes response
	skills?: SkillMetadata[] // For skills response
	aggregatedCosts?: {
		// For taskWithAggregatedCosts response
		totalCost: number
		ownCost: number
		childrenCost: number
	}
	historyItem?: HistoryItem
	taskHistory?: HistoryItem[] // For taskHistoryUpdated: full sorted task history
	/** For taskHistoryItemUpdated: single updated/added history item */
	taskHistoryItem?: HistoryItem
	// Worktree response properties
	worktrees?: Array<{
		path: string
		branch: string
		commitHash: string
		isCurrent: boolean
		isBare: boolean
		isDetached: boolean
		isLocked: boolean
		lockReason?: string
	}>
	isGitRepo?: boolean
	isMultiRoot?: boolean
	isSubfolder?: boolean
	gitRootPath?: string
	worktreeResult?: {
		success: boolean
		message: string
		worktree?: {
			path: string
			branch: string
			commitHash: string
			isCurrent: boolean
			isBare: boolean
			isDetached: boolean
			isLocked: boolean
			lockReason?: string
		}
	}
	localBranches?: string[]
	remoteBranches?: string[]
	currentBranch?: string
	suggestedBranch?: string
	suggestedPath?: string
	worktreeIncludeExists?: boolean
	worktreeIncludeStatus?: WorktreeIncludeStatus
	hasGitignore?: boolean
	gitignoreContent?: string
	// branchWorktreeIncludeResult
	branch?: string
	hasWorktreeInclude?: boolean
	// worktreeCopyProgress (size-based)
	copyProgressBytesCopied?: number
	copyProgressTotalBytes?: number
	copyProgressItemName?: string
	// folderSelected
	path?: string
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
	| "alwaysAllowReadOnly"
	| "alwaysAllowReadOnlyOutsideWorkspace"
	| "alwaysAllowWrite"
	| "alwaysAllowWriteOutsideWorkspace"
	| "alwaysAllowWriteProtected"
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
	| "screenshotQuality"
	| "remoteBrowserEnabled"
	| "cachedChromeHostUrl"
	| "remoteBrowserHost"
	| "ttsEnabled"
	| "ttsSpeed"
	| "soundEnabled"
	| "soundVolume"
	| "terminalOutputPreviewSize"
	| "terminalShellIntegrationTimeout"
	| "terminalShellIntegrationDisabled"
	| "terminalCommandDelay"
	| "terminalPowershellCounter"
	| "terminalZshClearEolMark"
	| "terminalZshOhMy"
	| "terminalZshP10k"
	| "terminalZdotdir"
	| "diagnosticsEnabled"
	| "language"
	| "modeApiConfigs"
	| "customModePrompts"
	| "customSupportPrompts"
	| "enhancementApiConfigId"
	| "customCondensingPrompt"
	| "codebaseIndexConfig"
	| "codebaseIndexModels"
	| "profileThresholds"
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
	| "showWorktreesInHomeScreen"
> & {
	version: string
	clineMessages: ClineMessage[]
	currentTaskItem?: HistoryItem
	currentTaskTodos?: TodoItem[] // Initial todos for the current task
	apiConfiguration: ProviderSettings
	uriScheme?: string
	shouldShowAnnouncement: boolean

	taskHistory: HistoryItem[]

	writeDelayMs: number

	enableCheckpoints: boolean
	checkpointTimeout: number // Timeout for checkpoint initialization in seconds (default: 15)
	maxOpenTabsContext: number // Maximum number of VSCode open tabs to include in context (0-500)
	maxWorkspaceFiles: number // Maximum number of files to include in current working directory details (0-500)
	showRooIgnoredFiles: boolean // Whether to show .rooignore'd files in listings
	enableSubfolderRules: boolean // Whether to load rules from subdirectories
	maxImageFileSize: number // Maximum size of image files to process in MB
	maxTotalImageSize: number // Maximum total size for all images in a single read operation in MB

	experiments: Experiments // Map of experiment IDs to their enabled state

	mcpEnabled: boolean

	mode: string
	customModes: ModeConfig[]
	toolRequirements?: Record<string, boolean> // Map of tool names to their requirements (e.g. {"apply_diff": true})

	cwd?: string // Current working directory
	telemetrySetting: TelemetrySetting
	telemetryKey?: string
	machineId?: string

	renderContext: "sidebar" | "editor"
	settingsImportedAt?: number
	historyPreviewCollapsed?: boolean

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
	messageQueue?: QueuedMessage[]
	lastShownAnnouncementId?: string
	apiModelId?: string
	mcpServers?: McpServer[]
	hasSystemPromptOverride?: boolean
	mdmCompliant?: boolean
	remoteControlEnabled: boolean
	taskSyncEnabled: boolean
	featureRoomoteControlEnabled: boolean
	openAiCodexIsAuthenticated?: boolean
	debug?: boolean
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

export type ClineAskResponse = "yesButtonClicked" | "noButtonClicked" | "messageResponse" | "objectResponse"

export type AudioType = "notification" | "celebration" | "progress_loop"

export interface UpdateTodoListPayload {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	todos: any[]
}

export type EditQueuedMessagePayload = Pick<QueuedMessage, "id" | "text" | "images">

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
		| "enhancePrompt"
		| "enhancedPrompt"
		| "draggedImages"
		| "deleteMessage"
		| "deleteMessageConfirm"
		| "submitEditedMessage"
		| "editMessageConfirm"
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
		| "autoApprovalEnabled"
		| "updateCustomMode"
		| "deleteCustomMode"
		| "setopenAiCustomModelInfo"
		| "openCustomModesSettings"
		| "checkpointDiff"
		| "checkpointRestore"
		| "deleteMcpServer"
		| "codebaseIndexEnabled"
		| "telemetrySetting"
		| "testBrowserConnection"
		| "browserConnectionResult"
		| "searchFiles"
		| "toggleApiConfigPin"
		| "hasOpenedModeSelector"
		| "clearCloudAuthSkipModel"
		| "cloudButtonClicked"
		| "rooCloudSignIn"
		| "cloudLandingPageSignIn"
		| "rooCloudSignOut"
		| "rooCloudManualUrl"
		| "openAiCodexSignIn"
		| "openAiCodexSignOut"
		| "switchOrganization"
		| "condenseTaskContextRequest"
		| "requestIndexingStatus"
		| "startIndexing"
		| "clearIndexData"
		| "indexingStatusUpdate"
		| "indexCleared"
		| "focusPanelRequest"
		| "openExternal"
		| "filterMarketplaceItems"
		| "marketplaceButtonClicked"
		| "installMarketplaceItem"
		| "installMarketplaceItemWithParameters"
		| "cancelMarketplaceInstall"
		| "removeInstalledMarketplaceItem"
		| "marketplaceInstallResult"
		| "fetchMarketplaceData"
		| "switchTab"
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
		| "queueMessage"
		| "removeQueuedMessage"
		| "editQueuedMessage"
		| "dismissUpsell"
		| "getDismissedUpsells"
		| "openMarkdownPreview"
		| "updateSettings"
		| "allowedCommands"
		| "getTaskWithAggregatedCosts"
		| "deniedCommands"
		| "killBrowserSession"
		| "openBrowserSessionPanel"
		| "showBrowserSessionPanelAtStep"
		| "refreshBrowserSessionPanel"
		| "browserPanelDidLaunch"
		| "openDebugApiHistory"
		| "openDebugUiHistory"
		| "downloadErrorDiagnostics"
		| "requestOpenAiCodexRateLimits"
		| "refreshCustomTools"
		| "requestModes"
		| "switchMode"
		| "debugSetting"
		// Worktree messages
		| "listWorktrees"
		| "createWorktree"
		| "deleteWorktree"
		| "switchWorktree"
		| "getAvailableBranches"
		| "getWorktreeDefaults"
		| "getWorktreeIncludeStatus"
		| "checkBranchWorktreeInclude"
		| "createWorktreeInclude"
		| "checkoutBranch"
		| "browseForWorktreePath"
		// Skills messages
		| "requestSkills"
		| "createSkill"
		| "deleteSkill"
		| "moveSkill"
		| "updateSkillModes"
		| "openSkillFile"
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
	stepIndex?: number
	isLaunchAction?: boolean
	forceShow?: boolean
	commands?: string[]
	audioType?: AudioType
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
	modeConfig?: ModeConfig
	timeout?: number
	payload?: WebViewMessagePayload
	source?: "global" | "project" | "built-in"
	skillName?: string // For skill operations (createSkill, deleteSkill, moveSkill, openSkillFile)
	/** @deprecated Use skillModeSlugs instead */
	skillMode?: string // For skill operations (current mode restriction)
	/** @deprecated Use newSkillModeSlugs instead */
	newSkillMode?: string // For moveSkill (target mode)
	skillDescription?: string // For createSkill (skill description)
	/** Mode slugs for skill operations. undefined/empty = any mode */
	skillModeSlugs?: string[] // For skill operations (mode restrictions)
	/** Target mode slugs for updateSkillModes */
	newSkillModeSlugs?: string[] // For updateSkillModes (new mode restrictions)
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
		codebaseIndexEmbedderBaseUrl?: string
		codebaseIndexEmbedderModelId: string
		codebaseIndexEmbedderModelDimension?: number // Generic dimension for all providers
		codebaseIndexOpenAiCompatibleBaseUrl?: string
		codebaseIndexBedrockRegion?: string
		codebaseIndexBedrockProfile?: string
		codebaseIndexSearchMaxResults?: number
		codebaseIndexSearchMinScore?: number
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
	// Worktree properties
	worktreePath?: string
	worktreeBranch?: string
	worktreeBaseBranch?: string
	worktreeCreateNewBranch?: boolean
	worktreeForce?: boolean
	worktreeNewWindow?: boolean
	worktreeIncludeContent?: string
}

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
		| "readCommandOutput"
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
		| "skill"
	path?: string
	// For readCommandOutput
	readStart?: number
	readEnd?: number
	totalBytes?: number
	searchPattern?: string
	matchCount?: number
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
	startLine?: number // Starting line for read_file operations (for navigation on click)
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
		// Per-file unified diff statistics computed by the extension
		diffStats?: { added: number; removed: number }
		diffs?: Array<{
			content: string
			startLine?: number
		}>
	}>
	question?: string
	imageData?: string // Base64 encoded image data for generated images
	// Properties for runSlashCommand tool
	command?: string
	args?: string
	source?: string
	description?: string
	// Properties for skill tool
	skill?: string
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
	cancelReason?: ClineApiReqCancelReason
	streamingFailedMessage?: string
	apiProtocol?: "anthropic" | "openai"
}

export type ClineApiReqCancelReason = "streaming_failed" | "user_cancelled"
