import type {
	GlobalSettings,
	ProviderSettingsEntry,
	ProviderSettings,
	ModelInfo, // kilocode_change
	HistoryItem,
	ModeConfig,
	TelemetrySetting,
	Experiments,
	ClineMessage,
	MarketplaceItem,
	TodoItem,
	CloudUserInfo,
	CloudOrganizationMembership,
	OrganizationAllowList,
	ShareVisibility,
	QueuedMessage,
	SerializedCustomToolDefinition,
} from "@roo-code/types"

import { GitCommit } from "../utils/git"

import { McpServer } from "./mcp"
import { McpMarketplaceCatalog, McpDownloadResponse } from "./kilocode/mcp"
import { Mode } from "./modes"
import { ModelRecord, RouterModels } from "./api"
// kilocode_change start
import {
	ProfileDataResponsePayload,
	BalanceDataResponsePayload,
	TaskHistoryResponsePayload,
	TasksByIdResponsePayload,
} from "./WebviewMessage"
import { ClineRulesToggles } from "./cline-rules"
import { KiloCodeWrapperProperties } from "./kilocode/wrapper"
import { DeploymentRecord } from "../api/providers/fetchers/sap-ai-core"
import { STTSegment, MicrophoneDevice } from "./sttContract" // kilocode_change: STT segment type and microphone device
// kilocode_change end

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
		| "agenticaDeviceAuthStarted" // kilocode_change: Agentica GitHub device auth initiated
		| "agenticaDeviceAuthTick" // kilocode_change: Agentica GitHub device auth tick/countdown
		| "agenticaDeviceAuthPolling" // kilocode_change: Agentica GitHub device auth polling update
		| "agenticaDeviceAuthExchanging" // kilocode_change: Agentica GitHub device auth token exc		e started
	| "agenticaDeviceAuthComplete" // kilocode_change: Agentica GitHub dev		auth successful
	| "agenticaDeviceAuthFailed" // kilocode_change: Agentica GitHub devic		th failed
	| "agenticaDeviceAuthCancelled" // kilocode_change: Agentica GitHub devi		uth cancelled
	| "chat		letionResult" // kiloc	change: FIM co	tion result for chat text	a
	| "claudeCodeRateLimits"
	| "customToolsResult"
   	securePasswordRetrieved" // kilocode_change
  	xt?: string
	// kilocode_change start
	key?: s	g // For s		e password operations
	pas		d?: string | null // For secu		assword operations
	erro		string // Error message for s		e password retrieval
	completionRequestId?: string // Corre	on ID from request
	completionText?: string // The complet	ext
	completionError?: string // Error message if failed
   	load?:
	| ProfileDat	ponsePayload
	| BalanceData	onsePayload
	| Task		ponsePayload
	| TaskHistoryResponse		    | [string, s	g]	For file 		 events [taskId, fileP		
	agenticaApiKey?: stri		/ Agentica API key from d		e auth
	agenticaEmail?: string // Agentic		er email from device auth
	// kilocode_ch		 end
	// Checkpoint warnin		ssage
	checkpointWarning?: {
				: "WAIT_TIMEOUT" | "INI		MEOUT"
		timeou		umber
	}
   		ion?:
	| "c		uttonClicked"
	| "settingsButtonCli		"
	| "historyButton	ked"
	| "promptsButtonClicked" // kilocode_change
	| "profileButtonClicked" // kilocode_change
		arketplaceButtonClicked	  | "mcpButtonClic	 // kilocode_change
 	 "cloudButtonClicked"		didBecomeVisib		| "focusInput"
   		chTab"
	| "	sCh	put" // kilocode_change
		oggleAutoApprove"
	invoke	newChat" | "sendMessage"	primaryButtonClick" | "seco	yButtonClick" | "setChatBoxMe	e"
	state?: ExtensionState
	images?: string[]
	filePaths?: string[]
	opened	?: Array<{
		label: st		     isActi		ean
		pat		ng
	}>
	cl		ge?: ClineMessage		terModels?: RouterM			enAiModels?: stri			amaModels?: ModelRecord
	lmStudioM			lRecord
	vsCodeLmModel			?: string; family?: string; version?:			: string }[]
	hugging			 Array<{
   						object				 created: numbe			ne		rin	   	roviders: Array<{
			provider: string
  		  status: "live" | "staging" | "error"
			supp	_tools?: boolean
			supports_structured_ou	?: boolean
			context_length?: 	er
			pricing?: {
				input: number
				output: number
					  }>
   		sapAiCoreModels?: Mo	ecord // kiloc	change
	sapAiCo	ployments?: DeploymentRecord 	ilocode_change
	mcpServers?: McpServer[]
	commit	GitCommit[]
	listApiConfig?: ProviderSettingsEntry[]
	apiConfiguration?: Provid	ttings // kilocode_change: For profileConfigurationForEditing 	onse
	mode?: Mode
	customMode?: ModeConfig
	slug?	ring
	success?: boolean
	values?: Record<string, any>
	sessionId?: strin	 kilocode_change: STT session ID
	segments?: STTSegment[] // kilocode_change: STT transcript segments (complete state)
	isFinal?: boolean // kilocode_chan	STT transcript is final
	level?: number // kilocode_change: STT volume	el (0-1)
	reason?: "completed" | "cancelled" | "error" // kilocode_change: ST	op reason
	speec	extStatus?: { availa	 boolean; reason?: "openaiKeyMissing" | "ffmpegNotInstalled" } // kilo	_change: Speech	text availability status response
	devices?: MicrophoneDevice[	 kilocode_change: Microphone devices list
	device?: Micro	eDevice | null // kiloco		e: Selected mic		device
	request		ing
	promptTe	 string
	results?:	ath: string; type: "file" | "fol	; label?: string }[]
	error?: string
	mcpMarketpla	talog?: McpMarket	eCatalog // 	code_change
	mcpDownloadDetails?: McpDownloadRespon	/ kilocode_change
	noti	tionOptions?: {
		t	?: string
		subtitle?: string
		me	e: string
   	/ kilocode_change
	url?: str	// kilocode_change
	keybindin	 Record<string, string> // kilo	_change
	setting?: string
	val	 any
	hasContent?: boolean // Fo	eckRulesDirectoryResult
	items?: M	tplaceItem[]
	userInfo?: CloudUser	
	organizationAllowList?: OrganizationAllowList
	tab?:	ing
	// kilocode_change: Rules data
	globalRules?: ClineRulesTogg	    localRules?: C	RulesToggles
	globalWorkfl	: ClineRulesToggles
	l	Workflows?: Cli	lesToggles
	mark	aceItems?: MarketplaceIt	
	organization	?: MarketplaceItem[]
	marketplaceInst	dMetadata?: MarketplaceI		Metadata
  		ode?: string |		 For mermaidFixR		// kilocode			errors?: string[]
 			y?: ShareVisibilit		le	der	?: string
	settings?	y
	messageTs?: num	    hasCheckpoint?: boolean
	c	xt?: string
	// kilocode_change start	tifications
	notifications?: Array<{
		id: string
		title: string
		message: string
		action?: {
			actionTex	tring
			actionURL: s		      }
	}>
	// kiloco		e end
	commands?: Command		ueuedMessages?: QueuedMes		   list?: string[] // For		edUpsells
	organi		?: string | null // F		izationSwitchResult
	//		e_change start: Mana		xer
	ma			Enabled?: boo			agedIndexerState			       workspaceFo			ring
	   				Name: string
	 				ring | null
					tring | null
	  			: 		  	  hasManifest: boolean
		manifestFile	t: number
		hasWatcher: boolean
		error?: {
			type: str	            message: string
			timestamp: string
				ext?: {
				filePath?: string
				branch?: string
		 	   operation?: string
			}
	   	   }> // kilocode_change	: Managed Indexer
	browserSessio	sages?: ClineMessage[] // For	wser session panel updates
	is	serSessionActive?: boolea	 For browser session panel up	s
	stepIndex?: number 	or browserSessionNavigate: the target ste	dex to display
	// kilocode_change start: Device auth data
	deviceAuthCode?: string
	deviceAut	ificationUrl?: s	g
	deviceAuthExpiresIn	umber
	deviceAuthTi	maining?: number
		ceAuthToken?: string
  	viceAuthUserEmail?: s	g
	deviceAuthError?: 	ng
	// kilocode_change end: D	e auth data
	tools?: 	alizedCustomToolDefinition[] // For cust	olsResult
}
export ty	xtensionState = Pick<
	GlobalSetti	
	| "currentApiConfigName"
	| "listApiConfigMeta"
	| "pinnedApiCon	"
	| "customInstruct	"
	| "dismissedU	ls"
	| "autoApprovalEna	"
	| "yoloMode" // ki	de_change
	| "alwaysAllowReadO	
	| "alwaysAllowRead	OutsideWorkspace"
	| "alwaysAl	rite"
	| "alwaysA	WriteOutsideWorkspa	    | "alwaysAllowWrite	ected"
	| "alway	owDelete" // kilocode_c	e
	| "alwaysAllowBrow	
	| "alwaysAllowMcp"
	| "alwaysAllowM	witch"
	| "alwaysAllowSubtasks"
	| "alwa	lowFollowupQuestions"
	| "alwaysAllowExecute"
  	"followupAutoApproveTime	s"
	| "allowedComma	
	| "deniedC	nds"
	| "a	edMaxRequests"
  	"allowedMaxCost"	 | "browserToolEnabled"
   	browserViewportSize"
	| "showAutoApprove	" // kilocode_change
	| "	CostBelowThreshold" // kilocode_c	e
	| "screenshotQuality"
	| "r	eBrowserEnabled"
	| "cachedChromeH	rl"
	| "remoteBrowserH	
	| "ttsEnabled"
	| "tts	d"
	| "soundEnabled"
		oundVolume"
	| "m	ncurrentFileReads"
 	 "allowVeryLargeRead	/ kilocode_change
	| "termina	putLineLimit"
	| "te	alOutputCharacte	it"
	| "terminalShell	grationTimeout"
	| "terminalShellIntegrationDisabled"
	| "termin	mmandDelay"
	| "terminalPowershellCounter"
	| "terminalZshCl	olMark"
	| "terminalZshOhMy"
	| "terminalZshP10k"
	| "terminalZdot	
	| "terminalCompressProgressBar"
	| "diagnosticsEnabled"
 	 "diffEnabled	  | "fuzzyMatchThre	d"
	| "morphApiKey"	kilocode_change: Morph fa	pply - global setting
	|	stApplyModel" // kilocode_change: Fast Apply	el selection
	| "fastApplyApiProvider" 	ilocode_change: Fast Apply model api base	
	// | "experiments" // Optional in Global	ings, required here.
	| "language"
	| "mod	Configs"
	| "customModePrompts"
	| "customSu	tPrompts"
	| "enhancementApiConfigId"
	| "	lWorkflowToggles" // kilocode_change
	| "	alRulesToggles" // kilocode_change
	|	calRulesToggles" // kilocode_change
	| "globalWork	Toggles" // kilocode_change
	| "commitMessageApiConfigId	 kilocode_change
	| "terminalCommandApiConfigId" // kilo	_change
	| "dismissedNotificationIds" // kilocode_change
	| "ghostServiceSettings" // kilocode_change
	|	toPurgeEnabled" // kilocod	ange
	| "autoPurgeDefaul	entionDays" // kilocode_change
	| "autoPurgeFavoritedTaskRetentionDays" // 	code_change
	| "autoP	CompletedTaskRetentionDa	// kilocode_change
   	autoPurgeIncompleteTaskRetentionDays" // kilocode_	ge
	| "autoPurgeLastRunTime	p" // kilocode_change
		ondensingApiConfigId"
	| 	tomCondensingPrompt"
	| "yoloGatekeeperA	nfigId" // kilocode_change: AI g	eeper for YOLO mode
	| "c	aseIndexConfig"
  	"codebaseIndexModels"
 	 "profileThresholds"
  	"systemNotificationsEn	d" // kilocode_change
  	"includeDiagnosticMessages"
	| "maxDiagnosticMessages"
	| "imageGenerationProvider"
	| "openRouterIma	nerationSelectedModel"
	| "	udeTaskHistoryInEnhance"
	|	asoningBlockCollapsed"
	| "enterBehavior"
	| "includeCurrentTi	    | "includeCurrentCost"
	| "m	tStatusFiles"
	|	questDelaySeconds"
	| "selectedMi	honeDevice" // kilocode_change: Selected microphone device for STT
> & {
	version: string
  	ineMessages: ClineMessage[]
 	urrentTaskItem?: HistoryItem
		entTaskTodos?: TodoItem[] // Initial todos for th	rrent task
	apiConfiguration: ProviderSettin	   uriScheme?: string
	uiKind?: string // kilocode	nge

	kiloCodeWrapperProperties?: KiloCodeWrapperProperties // kilocode_change: Wrapper i	mation

	kilocodeDefaultModel: string
	shouldShowAnnouncement: boolean

	taskHistoryFu	ngth: number // kilocode_change
	taskHistoryVersion: number // kilocode_change

	writeDelayMs: number

	enableCheckpoints: boolean
	checkpointTimeout: number // Timeout for checkpoint i	alization in seconds (default: 15)
	maxOpenTabsContext: number // Maximu	mber of VSCode open tabs to include in context (0-500)
	maxWorkspaceFiles: number // M	um number of files to include in current working directory details (0-500)
	showRooIgnoredFiles: bool	// Whether to show .kilocodeignore'd files in listings
	enableSubfolde	es: boolean // Whether to load rules from subdirectories
	maxReadFileLine: number // Maximum n	r of lines to read from a file before truncating
	showAutoApproveMenu: 	ean // kilocode_chan	Whether to show the auto-approve m	in the chat	w
	maxImageFileSize: nu	 // Maximum size of image files to process in MB
	maxTotalImageSize: number // Maximum total size for all images in a single re	peration in MB

	experiments: Experimen	/ Map of experiment IDs to their en	d state

	mcpEnable	oolean
	enableMcp	erCreation: boolean

	mode: Mode
	customModes: ModeConfig[]
  	olRequirements?: Record<string, bo	n> // Map of tool names to their requirements 	. {"apply_diff": true} if diffEnabled)

	cwd?	ring // Current working directory
	telemetrySetti	TelemetrySetting
	telemetryKey?: 	ng
	machineId?: string

   	derContext: "sidebar" | "editor"
	settingsImportedAt?: number
	historyPreviewCollapsed?: boolean
	showTaskTimeline?:	lean // kilocode_chan	   sendMessageOnEnter?: boolean // kilocode_change
	hideCostBelowThreshold?:	ber // kilocode_change

	cl	serInfo: CloudUserInfo | null
	cloudIsAuth	cated: boolean
	cloudAuthSkipModel?	olean // Flag indicating auth completed without model selection (	 should pick 3rd-party provid	    cloudApiUrl?: string
	cloudO	izations?: CloudOrganizationMembershi	    sharingEnabled: boolean
	publicSharingEnabled: boolean
	organizationAllowList: Orga	tionAllowList
	organizationSettingsVers	: number

	isBrowserSessionA	e: boolean // Actual browser se	n state

	autoCondenseCont	 boolean
	autoCondenseContextPercent: n	r
	marketplaceItems?: Market	eItem[]
	marketplaceInstalledM	ata?: { project: Rec	string, any>; global: Rec	string, any> }
	profileThreshol	Record<string, number>
	hasOpenedModeSelector: boolean	 openRouterImageApiKey?: 	ng
	kiloCodeImageApiKey?: string
  	enRouterUseMiddleOutTransform?: boolean
	messageQueue?: QueuedMessage[]
	lastShownAnnouncementId?: string
	apiModelId?: string
	mcpServers?: McpServer[]
	hasSy	PromptOverride?: boolean
	mdmCompliant?: boolean
	remoteControlEnabled: 	ean
	taskSyncEnabled: boolean
	featureRoomoteControlEnabled: boolean
	virtualQuotaActiveModel?: { id: stri	info: ModelInfo;	iveProfileNumber?: number } // kilocode_change: Add virtual quota active model for UI display with profile number
	showTimestamps?: boolean // kilocode_change: Show tim	mps in chat messages
	showDiffStats?: boolean // kilocode_change: Show diff stats in task header
	claudeCodeIsAuthenticated?: b	an
   		ug?: boolean
	speech		xtStatus?: { ava		le: boolean; reason		openaiKeyMissing" |		mpegNotInstal		 } // kilocode_change:		ech-to-text availabili		tatus with failure reas		   appendSystemP		t?: string // k		ode_change: 		om text to appe		o system prompt (C		nly)
}

export inte		e ClineSayTool {
   		l:
	| "editedExi		gFile"
	| "appliedDiff"
	| "newFileCreated"
	| "codebaseSearc	   | "readFile	  | "fetchInst	ions"
	| "list	sTopLevel"
	| "listFilesRecursive"
	| "searchFi	
	| "switchMode"
	| "newTask"
	| "fini	sk"
	| "gene	Image"
	| "imageGe	ted"
	| "ru	shCommand"
	|	dateTodoList"
	| "deleteFi	// kilocode_change: Ha	s both files and directories
	path?: string
	diff?: string
	content?: string
   	Unified diff statist	computed by the	ension
	diffStats?: { added: number; removed: number }
	regex?: string
	fi	ttern?: st		 mode?: string		son?: string
	isO		rkspace?: boo		 isProtected?: boole	  	itionalFileCount?: numb	/ Number of additiona		in the same r		 request
	lineNum		mber
	query?: string
	/		de_change st		ectory stats - on	res	when deleting directo		 stats?: {
  		les: number
				ies: number
		size: number
   		omplete: boolean
	}
	// kilocode_change end
	batchFil		ay<{
		path: string
		lineSnippet: 		       isOutside			boolean
							content?: s		  }	  b	Diffs?: Array<{
  	  path: string
		ch	Count: number
	  		tring
		content		
		// Per-fi		ed diff statistics 		 by the extens	  	  diffStats?: { added: 	er; removed: number }
		diffs?: Array<{
			content: st	
			startLine?: number
	   		}>
	questi	 string
	//	ocode_change sta	   fastApplyResult?: {
		description?: string
		tokensIn?: number
		tokensOut?:	ber
	  	st?: numb	   }
		ilocode_	ge end
  	ageData?: strin	 Base64 encod	mage data 	generated	ges
	// Properties for runSlashCommand tool
	command?: string
	args?: string
	source?: string
	description?: stri	

// Must keep in sync	h system prompt.
exp	const browserA	ns = [
	"la	",
	"click",
	"hover",
	"type",
	"press",
	"scroll_d	,
	"scroll_up",
 	resize",
	"	e",
	"screenshot"	as const

export type BrowserA	n = (typeof browserActi	[number]

export interface ClineSayBrowserAction {
	action: Brow	ction
	coordinat	string
	size?: string
	text?: string
  	ecutedCoordinate?:	ing
}

export type 	serActionResu	 {
	screenshot?: string
	logs?: string
	current	: string
	curr	ousePosition?: str	    viewportWidth?:	ber
	viewportHeigh	number
}

export int	ce ClineAskUse	erver {
	serverN	 string
	type: "use_	tool" | "access_mcp_resourc	   toolName?: string
  	guments?: string
	uri?: string
	r	nse?: string
}

export interface	neApiReqInfo {
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
