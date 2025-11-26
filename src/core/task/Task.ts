import * as path from "path"
import * as vscode from "vscode"
import os from "os"
import crypto from "crypto"
import EventEmitter from "events"

import { Anthropic } from "@anthropic-ai/sdk"
import delay from "delay"
import pWaitFor from "p-wait-for"
import { serializeError } from "serialize-error"

import {
	type TaskLike,
	type TaskMetadata,
	type TaskEvents,
	type ProviderSettings,
	type TokenUsage,
	type ToolUsage,
	type ToolName,
	type ContextCondense,
	type ClineMessage,
	type ClineSay,
	type ClineAsk,
	type ToolProgressStatus,
	type HistoryItem,
	type CreateTaskOptions,
	RooCodeEventName,
	TelemetryEventName,
	TaskStatus,
	TodoItem,
	DEFAULT_CONSECUTIVE_MISTAKE_LIMIT,
	getApiProtocol,
	getModelId,
	isIdleAsk,
	isInteractiveAsk,
	isResumableAsk,
	QueuedMessage,
	getActiveToolUseStyle, // kilocode_change
	DEFAULT_CHECKPOINT_TIMEOUT_SECONDS,
	MAX_CHECKPOINT_TIMEOUT_SECONDS,
	MIN_CHECKPOINT_TIMEOUT_SECONDS,
} from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"
import { CloudService, BridgeOrchestrator } from "@roo-code/cloud"

// api
import { ApiHandler, ApiHandlerCreateMessageMetadata, buildApiHandler } from "../../api"
import { ApiStream, GroundingSource } from "../../api/transform/stream"
import { maybeRemoveImageBlocks } from "../../api/transform/image-cleaning"
import { VirtualQuotaFallbackHandler } from "../../api/providers/virtual-quota-fallback" // kilocode_change: Import VirtualQuotaFallbackHandler for model change notifications

// shared
import { findLastIndex } from "../../shared/array"
import { combineApiRequests } from "../../shared/combineApiRequests"
import { combineCommandSequences } from "../../shared/combineCommandSequences"
import { t } from "../../i18n"
import { ClineApiReqCancelReason, ClineApiReqInfo } from "../../shared/ExtensionMessage"
import { getApiMetrics, hasTokenUsageChanged } from "../../shared/getApiMetrics"
import { ClineAskResponse } from "../../shared/WebviewMessage"
import { defaultModeSlug, getModeBySlug, getGroupName } from "../../shared/modes"
import { DiffStrategy } from "../../shared/tools"
import { EXPERIMENT_IDS, experiments } from "../../shared/experiments"
import { getModelMaxOutputTokens } from "../../shared/api"

// services
import { UrlContentFetcher } from "../../services/browser/UrlContentFetcher"
import { BrowserSession } from "../../services/browser/BrowserSession"
import { McpHub } from "../../services/mcp/McpHub"
import { McpServerManager } from "../../services/mcp/McpServerManager"
import { RepoPerTaskCheckpointService } from "../../services/checkpoints"

// integrations
import { DiffViewProvider } from "../../integrations/editor/DiffViewProvider"
import { findToolName, formatContentBlockToMarkdown } from "../../integrations/misc/export-markdown"
import { RooTerminalProcess } from "../../integrations/terminal/types"
import { TerminalRegistry } from "../../integrations/terminal/TerminalRegistry"

// utils
import { calculateApiCostAnthropic, calculateApiCostOpenAI } from "../../shared/cost"
import { getWorkspacePath } from "../../utils/path"

// prompts
import { formatResponse } from "../prompts/responses"
import { SYSTEM_PROMPT } from "../prompts/system"
import { getAllowedJSONToolsForMode } from "../prompts/tools/native-tools/getAllowedJSONToolsForMode" // kilocode_change

// core modules
import { ToolRepetitionDetector } from "../tools/ToolRepetitionDetector"
import { restoreTodoListForTask } from "../tools/updateTodoListTool"
import { FileContextTracker } from "../context-tracking/FileContextTracker"
import { RooIgnoreController } from "../ignore/RooIgnoreController"
import { RooProtectedController } from "../protect/RooProtectedController"
import { type AssistantMessageContent, presentAssistantMessage } from "../assistant-message"
import { AssistantMessageParser } from "../assistant-message/AssistantMessageParser"
import { truncateConversationIfNeeded } from "../sliding-window"
import { ClineProvider } from "../webview/ClineProvider"
import { MultiSearchReplaceDiffStrategy } from "../diff/strategies/multi-search-replace"
import { MultiFileSearchReplaceDiffStrategy } from "../diff/strategies/multi-file-search-replace"
import {
	type ApiMessage,
	readApiMessages,
	saveApiMessages,
	readTaskMessages,
	saveTaskMessages,
	taskMetadata,
} from "../task-persistence"
import { getEnvironmentDetails } from "../environment/getEnvironmentDetails"
import { checkContextWindowExceededError } from "../context/context-management/context-error-handling"
import {
	type CheckpointDiffOptions,
	type CheckpointRestoreOptions,
	getCheckpointService,
	checkpointSave,
	checkpointRestore,
	checkpointDiff,
} from "../checkpoints"
import { processKiloUserContentMentions } from "../mentions/processKiloUserContentMentions" // kilocode_change
import { refreshWorkflowToggles } from "../context/instructions/workflows" // kilocode_change
import { parseMentions } from "../mentions" // kilocode_change
import { parseKiloSlashCommands } from "../slash-commands/kilo" // kilocode_change
import { GlobalFileNames } from "../../shared/globalFileNames" // kilocode_change
import { ensureLocalKilorulesDirExists } from "../context/instructions/kilo-rules" // kilocode_change
import { getMessagesSinceLastSummary, summarizeConversation } from "../condense"
import { Gpt5Metadata, ClineMessageWithMetadata } from "./types"
import { MessageQueueService } from "../message-queue/MessageQueueService"

import { AutoApprovalHandler } from "./AutoApprovalHandler"
import { isAnyRecognizedKiloCodeError, isPaymentRequiredError } from "../../shared/kilocode/errorUtils"
import { getAppUrl } from "@roo-code/types"
import { maybeRemoveReasoningDetails_kilocode, ReasoningDetail } from "../../api/transform/kilocode/reasoning-details"
import { mergeApiMessages } from "./kilocode"
import { mergeEnvironmentDetailsIntoUserContent } from "../environment/kilocode/mergeEnvironmentDetailsIntoUserContent"

const MAX_EXPONENTIAL_BACKOFF_SECONDS = 600 // 10 minutes
const DEFAULT_USAGE_COLLECTION_TIMEOUT_MS = 5000 // 5 seconds
const FORCED_CONTEXT_REDUCTION_PERCENT = 75 // Keep 75% of context (remove 25%) on context window errors
const MAX_CONTEXT_WINDOW_RETRIES = 3 // Maximum retries for context window errors

export interface TaskOptions extends CreateTaskOptions {
	context: vscode.ExtensionContext // kilocode_change
	provider: ClineProvider
	apiConfiguration: ProviderSettings
	enableDiff?: boolean
	enableCheckpoints?: boolean
	checkpointTimeout?: number
	enableBridge?: boolean
	fuzzyMatchThreshold?: number
	consecutiveMistakeLimit?: number
	task?: string
	images?: string[]
	historyItem?: HistoryItem
	experiments?: Record<string, boolean>
	startTask?: boolean
	rootTask?: Task
	parentTask?: Task
	taskNumber?: number
	onCreated?: (task: Task) => void
	initialTodos?: TodoItem[]
	workspacePath?: string
}

type UserContent = Array<Anthropic.ContentBlockParam> // kilocode_change

export class Task extends EventEmitter<TaskEvents> implements TaskLike {
	private context: vscode.ExtensionContext // kilocode_change

	readonly taskId: string
	private taskIsFavorited?: boolean // kilocode_change
	readonly rootTaskId?: string
	readonly parentTaskId?: string
	childTaskId?: string

	readonly instanceId: string
	readonly metadata: TaskMetadata

	todoList?: TodoItem[]

	readonly rootTask: Task | undefined
	readonly parentTask: Task | undefined
	readonly taskNumber: number
	readonly workspacePath: string

	/**
	 * The mode associated with this task. Persisted across sessions
	 * to maintain user context when reopening tasks from history.
	 *
	 * ## Lifecycle
	 *
	 * ### For new tasks:
	 * 1. Initially `undefined` during construction
	 * 2. Asynchronously initialized from provider state via `initializeTaskMode()`
	 * 3. Falls back to `defaultModeSlug` if provider state is unavailable
	 *
	 * ### For history items:
	 * 1. Immediately set from `historyItem.mode` during construction
	 * 2. Falls back to `defaultModeSlug` if mode is not stored in history
	 *
	 * ## Important
	 * This property should NOT be accessed directly until `taskModeReady` promise resolves.
	 * Use `getTaskMode()` for async access or `taskMode` getter for sync access after initialization.
	 *
	 * @private
	 * @see {@link getTaskMode} - For safe async access
	 * @see {@link taskMode} - For sync access after initialization
	 * @see {@link waitForModeInitialization} - To ensure initialization is complete
	 */
	private _taskMode: string | undefined

	/**
	 * Promise that resolves when the task mode has been initialized.
	 * This ensures async mode initialization completes before the task is used.
	 *
	 * ## Purpose
	 * - Prevents race conditions when accessing task mode
	 * - Ensures provider state is properly loaded before mode-dependent operations
	 * - Provides a synchronization point for async initialization
	 *
	 * ## Resolution timing
	 * - For history items: Resolves immediately (sync initialization)
	 * - For new tasks: Resolves after provider state is fetched (async initialization)
	 *
	 * @private
	 * @see {@link waitForModeInitialization} - Public method to await this promise
	 */
	private taskModeReady: Promise<void>

	providerRef: WeakRef<ClineProvider>
	private readonly globalStoragePath: string
	abort: boolean = false

	// TaskStatus
	idleAsk?: ClineMessage
	resumableAsk?: ClineMessage
	interactiveAsk?: ClineMessage

	didFinishAbortingStream = false
	abandoned = false
	abortReason?: ClineApiReqCancelReason
	isInitialized = false
	isPaused: boolean = false
	pausedModeSlug: string = defaultModeSlug
	private pauseInterval: NodeJS.Timeout | undefined

	// API
	readonly apiConfiguration: ProviderSettings
	api: ApiHandler
	private static lastGlobalApiRequestTime?: number
	private autoApprovalHandler: AutoApprovalHandler

	/**
	 * Reset the global API request timestamp. This should only be used for testing.
	 * @internal
	 */
	static resetGlobalApiRequestTime(): void {
		Task.lastGlobalApiRequestTime = undefined
	}

	toolRepetitionDetector: ToolRepetitionDetector
	rooIgnoreController?: RooIgnoreController
	rooProtectedController?: RooProtectedController
	fileContextTracker: FileContextTracker
	urlContentFetcher: UrlContentFetcher
	terminalProcess?: RooTerminalProcess

	// Computer User
	browserSession: BrowserSession

	// Editing
	diffViewProvider: DiffViewProvider
	diffStrategy?: DiffStrategy
	diffEnabled: boolean = false
	fuzzyMatchThreshold: number
	didEditFile: boolean = false

	// LLM Messages & Chat Messages
	apiConversationHistory: ApiMessage[] = []
	clineMessages: ClineMessage[] = []

	// Ask
	private askResponse?: ClineAskResponse
	private askResponseText?: string
	private askResponseImages?: string[]
	public lastMessageTs?: number

	// Tool Use
	consecutiveMistakeCount: number = 0
	consecutiveMistakeLimit: number
	consecutiveMistakeCountForApplyDiff: Map<string, number> = new Map()
	toolUsage: ToolUsage = {}

	// Checkpoints
	enableCheckpoints: boolean
	checkpointTimeout: number
	checkpointService?: RepoPerTaskCheckpointService
	checkpointServiceInitializing = false

	// Task Bridge
	enableBridge: boolean

	// Message Queue Service
	public readonly messageQueueService: MessageQueueService
	private messageQueueStateChangedHandler: (() => void) | undefined

	// Streaming
	isWaitingForFirstChunk = false
	isStreaming = false
	currentStreamingContentIndex = 0
	currentStreamingDidCheckpoint = false
	assistantMessageContent: AssistantMessageContent[] = []
	presentAssistantMessageLocked = false
	presentAssistantMessageHasPendingUpdates = false
	userMessageContent: (
		| Anthropic.TextBlockParam
		| Anthropic.ImageBlockParam
		| Anthropic.ToolResultBlockParam // kilocode_change
	)[] = []
	userMessageContentReady = false
	didRejectTool = false
	didAlreadyUseTool = false
	didCompleteReadingStream = false
	assistantMessageParser: AssistantMessageParser
	private lastUsedInstructions?: string
	private skipPrevResponseIdOnce: boolean = false

	// Token Usage Cache
	private tokenUsageSnapshot?: TokenUsage
	private tokenUsageSnapshotAt?: number

	constructor({
		context, // kilocode_change
		provider,
		apiConfiguration,
		enableDiff = false,
		enableCheckpoints = true,
		checkpointTimeout = DEFAULT_CHECKPOINT_TIMEOUT_SECONDS,
		enableBridge = false,
		fuzzyMatchThreshold = 1.0,
		consecutiveMistakeLimit = DEFAULT_CONSECUTIVE_MISTAKE_LIMIT,
		task,
		images,
		historyItem,
		startTask = true,
		rootTask,
		parentTask,
		taskNumber = -1,
		onCreated,
		initialTodos,
		workspacePath,
	}: TaskOptions) {
		super()
		this.context = context // kilocode_change

		if (startTask && !task && !images && !historyItem) {
			throw new Error("Either historyItem or task/images must be provided")
		}

		if (
			!checkpointTimeout ||
			checkpointTimeout > MAX_CHECKPOINT_TIMEOUT_SECONDS ||
			checkpointTimeout < MIN_CHECKPOINT_TIMEOUT_SECONDS
		) {
			throw new Error(
				"checkpointTimeout must be between " +
					MIN_CHECKPOINT_TIMEOUT_SECONDS +
					" and " +
					MAX_CHECKPOINT_TIMEOUT_SECONDS +
					" seconds",
			)
		}

		this.taskId = historyItem ? historyItem.id : crypto.randomUUID()
		this.taskIsFavorited = historyItem?.isFavorited // kilocode_change
		this.rootTaskId = historyItem ? historyItem.rootTaskId : rootTask?.taskId
		this.parentTaskId = historyItem ? historyItem.parentTaskId : parentTask?.taskId
		this.childTaskId = undefined

		this.metadata = {
			task: historyItem ? historyItem.task : task,
			images: historyItem ? [] : images,
		}

		// Normal use-case is usually retry similar history task with new workspace.
		this.workspacePath = parentTask
			? parentTask.workspacePath
			: (workspacePath ?? getWorkspacePath(path.join(os.homedir(), "Documents"))) // kilocode_change: use Documents instead of Desktop as default

		this.instanceId = crypto.randomUUID().slice(0, 8)
		this.taskNumber = -1

		this.rooIgnoreController = new RooIgnoreController(this.cwd)
		this.rooProtectedController = new RooProtectedController(this.cwd)
		this.fileContextTracker = new FileContextTracker(provider, this.taskId)

		this.rooIgnoreController.initialize().catch((error) => {
			console.error("Failed to initialize RooIgnoreController:", error)
		})

		this.apiConfiguration = apiConfiguration
		this.api = buildApiHandler(apiConfiguration)
		// kilocode_change start: Listen for model changes in virtual quota fallback
		if (this.api instanceof VirtualQuotaFallbackHandler) {
			this.api.on("handlerChanged", () => {
				this.emit("modelChanged")
			})
		}
		// kilocode_change end
		this.autoApprovalHandler = new AutoApprovalHandler()

		this.urlContentFetcher = new UrlContentFetcher(provider.context)
		this.browserSession = new BrowserSession(provider.context)
		this.diffEnabled = enableDiff
		this.fuzzyMatchThreshold = fuzzyMatchThreshold
		this.consecutiveMistakeLimit = consecutiveMistakeLimit ?? DEFAULT_CONSECUTIVE_MISTAKE_LIMIT
		this.providerRef = new WeakRef(provider)
		this.globalStoragePath = provider.context.globalStorageUri.fsPath
		this.diffViewProvider = new DiffViewProvider(this.cwd, this)
		this.enableCheckpoints = enableCheckpoints
		this.checkpointTimeout = checkpointTimeout
		this.enableBridge = enableBridge

		this.parentTask = parentTask
		this.taskNumber = taskNumber

		// Store the task's mode when it's created.
		// For history items, use the stored mode; for new tasks, we'll set it
		// after getting state.
		if (historyItem) {
			this._taskMode = historyItem.mode || defaultModeSlug
			this.taskModeReady = Promise.resolve()
			TelemetryService.instance.captureTaskRestarted(this.taskId)
		} else {
			// For new tasks, don't set the mode yet - wait for async initialization.
			this._taskMode = undefined
			this.taskModeReady = this.initializeTaskMode(provider)
			TelemetryService.instance.captureTaskCreated(this.taskId)
		}

		// Initialize the assistant message parser.
		this.assistantMessageParser = new AssistantMessageParser()

		this.messageQueueService = new MessageQueueService()

		this.messageQueueStateChangedHandler = () => {
			this.emit(RooCodeEventName.TaskUserMessage, this.taskId)
			this.providerRef.deref()?.postStateToWebview()
			this.emit("modelChanged") // kilocode_change: Emit modelChanged for virtual quota fallback UI updates
		}

		this.messageQueueService.on("stateChanged", this.messageQueueStateChangedHandler)

		// Only set up diff strategy if diff is enabled.
		if (this.diffEnabled) {
			// Default to old strategy, will be updated if experiment is enabled.
			this.diffStrategy = new MultiSearchReplaceDiffStrategy(this.fuzzyMatchThreshold)

			// Check experiment asynchronously and update strategy if needed.
			provider.getState().then((state) => {
				const isMultiFileApplyDiffEnabled = experiments.isEnabled(
					state.experiments ?? {},
					EXPERIMENT_IDS.MULTI_FILE_APPLY_DIFF,
				)

				if (isMultiFileApplyDiffEnabled) {
					this.diffStrategy = new MultiFileSearchReplaceDiffStrategy(this.fuzzyMatchThreshold)
				}
			})
		}

		this.toolRepetitionDetector = new ToolRepetitionDetector(this.consecutiveMistakeLimit)

		// Initialize todo list if provided
		if (initialTodos && initialTodos.length > 0) {
			this.todoList = initialTodos
		}

		onCreated?.(this)

		if (startTask) {
			if (task || images) {
				this.startTask(task, images)
			} else if (historyItem) {
				this.resumeTaskFromHistory()
			} else {
				throw new Error("Either historyItem or task/images must be provided")
			}
		}
	}

	// kilocode_change start
	private getContext(): vscode.ExtensionContext {
		const context = this.context
		if (!context) {
			throw new Error("Unable to access extension context")
		}
		return context
	}
	// kilocode_change end
	/**
	 * Initialize the task mode from the provider state.
	 * This method handles async initialization with proper error handling.
	 *
	 * ## Flow
	 * 1. Attempts to fetch the current mode from provider state
	 * 2. Sets `_taskMode` to the fetched mode or `defaultModeSlug` if unavailable
	 * 3. Handles errors gracefully by falling back to default mode
	 * 4. Logs any initialization errors for debugging
	 *
	 * ## Error handling
	 * - Network failures when fetching provider state
	 * - Provider not yet initialized
	 * - Invalid state structure
	 *
	 * All errors result in fallback to `defaultModeSlug` to ensure task can proceed.
	 *
	 * @private
	 * @param provider - The ClineProvider instance to fetch state from
	 * @returns Promise that resolves when initialization is complete
	 */
	private async initializeTaskMode(provider: ClineProvider): Promise<void> {
		try {
			const state = await provider.getState()
			this._taskMode = state?.mode || defaultModeSlug
		} catch (error) {
			// If there's an error getting state, use the default mode
			this._taskMode = defaultModeSlug
			// Use the provider's log method for better error visibility
			const errorMessage = `Failed to initialize task mode: ${error instanceof Error ? error.message : String(error)}`
			provider.log(errorMessage)
		}
	}

	/**
	 * Wait for the task mode to be initialized before proceeding.
	 * This method ensures that any operations depending on the task mode
	 * will have access to the correct mode value.
	 *
	 * ## When to use
	 * - Before accessing mode-specific configurations
	 * - When switching between tasks with different modes
	 * - Before operations that depend on mode-based permissions
	 *
	 * ## Example usage
	 * ```typescript
	 * // Wait for mode initialization before mode-dependent operations
	 * await task.waitForModeInitialization();
	 * const mode = task.taskMode; // Now safe to access synchronously
	 *
	 * // Or use with getTaskMode() for a one-liner
	 * const mode = await task.getTaskMode(); // Internally waits for initialization
	 * ```
	 *
	 * @returns Promise that resolves when the task mode is initialized
	 * @public
	 */
	public async waitForModeInitialization(): Promise<void> {
		return this.taskModeReady
	}

	/**
	 * Get the task mode asynchronously, ensuring it's properly initialized.
	 * This is the recommended way to access the task mode as it guarantees
	 * the mode is available before returning.
	 *
	 * ## Async behavior
	 * - Internally waits for `taskModeReady` promise to resolve
	 * - Returns the initialized mode or `defaultModeSlug` as fallback
	 * - Safe to call multiple times - subsequent calls return immediately if already initialized
	 *
	 * ## Example usage
	 * ```typescript
	 * // Safe async access
	 * const mode = await task.getTaskMode();
	 * console.log(`Task is running in ${mode} mode`);
	 *
	 * // Use in conditional logic
	 * if (await task.getTaskMode() === 'architect') {
	 *   // Perform architect-specific operations
	 * }
	 * ```
	 *
	 * @returns Promise resolving to the task mode string
	 * @public
	 */
	public async getTaskMode(): Promise<string> {
		await this.taskModeReady
		return this._taskMode || defaultModeSlug
	}

	/**
	 * Get the task mode synchronously. This should only be used when you're certain
	 * that the mode has already been initialized (e.g., after waitForModeInitialization).
	 *
	 * ## When to use
	 * - In synchronous contexts where async/await is not available
	 * - After explicitly waiting for initialization via `waitForModeInitialization()`
	 * - In event handlers or callbacks where mode is guaranteed to be initialized
	 *
	 * ## Example usage
	 * ```typescript
	 * // After ensuring initialization
	 * await task.waitForModeInitialization();
	 * const mode = task.taskMode; // Safe synchronous access
	 *
	 * // In an event handler after task is started
	 * task.on('taskStarted', () => {
	 *   console.log(`Task started in ${task.taskMode} mode`); // Safe here
	 * });
	 * ```
	 *
	 * @throws {Error} If the mode hasn't been initialized yet
	 * @returns The task mode string
	 * @public
	 */
	public get taskMode(): string {
		if (this._taskMode === undefined) {
			throw new Error("Task mode accessed before initialization. Use getTaskMode() or wait for taskModeReady.")
		}

		return this._taskMode
	}

	static create(options: TaskOptions): [Task, Promise<void>] {
		const instance = new Task({ ...options, startTask: false })
		const { images, task, historyItem } = options
		let promise

		if (images || task) {
			promise = instance.startTask(task, images)
		} else if (historyItem) {
			promise = instance.resumeTaskFromHistory()
		} else {
			throw new Error("Either historyItem or task/images must be provided")
		}

		return [instance, promise]
	}

	// API Messages

	private async getSavedApiConversationHistory(): Promise<ApiMessage[]> {
		return readApiMessages({ taskId: this.taskId, globalStoragePath: this.globalStoragePath })
	}

	private async addToApiConversationHistory(message: Anthropic.MessageParam) {
		// kilocode_change start: prevent consecutive same-role messages, this happens when returning from subtask
		const lastMessage = this.apiConversationHistory.at(-1)
		if (lastMessage && lastMessage.role === message.role) {
			this.apiConversationHistory[this.apiConversationHistory.length - 1] = mergeApiMessages(lastMessage, message)
			await this.saveApiConversationHistory()
			return
		}
		// kilocode_change end

		const messageWithTs = { ...message, ts: Date.now() }
		this.apiConversationHistory.push(messageWithTs)
		await this.saveApiConversationHistory()
	}

	async overwriteApiConversationHistory(newHistory: ApiMessage[]) {
		this.apiConversationHistory = newHistory
		await this.saveApiConversationHistory()
	}

	private async saveApiConversationHistory() {
		try {
			await saveApiMessages({
				messages: this.apiConversationHistory,
				taskId: this.taskId,
				globalStoragePath: this.globalStoragePath,
			})
		} catch (error) {
			// In the off chance this fails, we don't want to stop the task.
			console.error("Failed to save API conversation history:", error)
		}
	}

	// Cline Messages

	private async getSavedClineMessages(): Promise<ClineMessage[]> {
		return readTaskMessages({ taskId: this.taskId, globalStoragePath: this.globalStoragePath })
	}

	private async addToClineMessages(message: ClineMessage) {
		this.clineMessages.push(message)
		const provider = this.providerRef.deref()
		await provider?.postStateToWebview()
		this.emit(RooCodeEventName.Message, { action: "created", message })
		await this.saveClineMessages()

		// kilocode_change start: no cloud service
		// const shouldCaptureMessage = message.partial !== true && CloudService.isEnabled()

		// if (shouldCaptureMessage) {
		// 	CloudService.instance.captureEvent({
		// 		event: TelemetryEventName.TASK_MESSAGE,
		// 		properties: { taskId: this.taskId, message },
		// 	})
		// }
		// kilocode_change end
	}

	public async overwriteClineMessages(newMessages: ClineMessage[]) {
		this.clineMessages = newMessages

		// If deletion or history truncation leaves a condense_context as the last message,
		// ensure the next API call suppresses previous_response_id so the condensed context is respected.
		try {
			const last = this.clineMessages.at(-1)
			if (last && last.type === "say" && last.say === "condense_context") {
				this.skipPrevResponseIdOnce = true
			}
		} catch {
			// non-fatal
		}

		restoreTodoListForTask(this)
		await this.saveClineMessages()
	}

	private async updateClineMessage(message: ClineMessage) {
		const provider = this.providerRef.deref()
		await provider?.postMessageToWebview({ type: "messageUpdated", clineMessage: message })
		this.emit(RooCodeEventName.Message, { action: "updated", message })

		const shouldCaptureMessage = message.partial !== true && CloudService.isEnabled()

		// kilocode_change start: no cloud service
		// if (shouldCaptureMessage) {
		// 	CloudService.instance.captureEvent({
		// 		event: TelemetryEventName.TASK_MESSAGE,
		// 		properties: { taskId: this.taskId, message },
		// 	})
		// }
		// kilocode_change end
	}

	private async saveClineMessages() {
		try {
			await saveTaskMessages({
				messages: this.clineMessages,
				taskId: this.taskId,
				globalStoragePath: this.globalStoragePath,
			})

			const { historyItem, tokenUsage } = await taskMetadata({
				taskId: this.taskId,
				rootTaskId: this.rootTaskId,
				parentTaskId: this.parentTaskId,
				taskNumber: this.taskNumber,
				messages: this.clineMessages,
				globalStoragePath: this.globalStoragePath,
				workspace: this.cwd,
				mode: this._taskMode || defaultModeSlug, // Use the task's own mode, not the current provider mode.
			})

			if (hasTokenUsageChanged(tokenUsage, this.tokenUsageSnapshot)) {
				this.emit(RooCodeEventName.TaskTokenUsageUpdated, this.taskId, tokenUsage)
				this.tokenUsageSnapshot = undefined
				this.tokenUsageSnapshotAt = undefined
			}

			await this.providerRef.deref()?.updateTaskHistory(historyItem)
		} catch (error) {
			console.error("Failed to save messages:", error)
		}
	}

	private findMessageByTimestamp(ts: number): ClineMessage | undefined {
		for (let i = this.clineMessages.length - 1; i >= 0; i--) {
			if (this.clineMessages[i].ts === ts) {
				return this.clineMessages[i]
			}
		}

		return undefined
	}

	async nextClineMessageTimestamp_kilocode() {
		let ts = Date.now()
		while (ts <= (this.clineMessages?.at(-1)?.ts ?? 0)) {
			console.warn("nextClineMessageTimeStamp: timestamp already taken", ts)
			await new Promise<void>((resolve) => setTimeout(() => resolve(), 1))
			ts = Date.now()
		}
		return ts
	}

	// Note that `partial` has three valid states true (partial message),
	// false (completion of partial message), undefined (individual complete
	// message).
	async ask(
		type: ClineAsk,
		text?: string,
		partial?: boolean,
		progressStatus?: ToolProgressStatus,
		isProtected?: boolean,
	): Promise<{ response: ClineAskResponse; text?: string; images?: string[] }> {
		// If this Cline instance was aborted by the provider, then the only
		// thing keeping us alive is a promise still running in the background,
		// in which case we don't want to send its result to the webview as it
		// is attached to a new instance of Cline now. So we can safely ignore
		// the result of any active promises, and this class will be
		// deallocated. (Although we set Cline = undefined in provider, that
		// simply removes the reference to this instance, but the instance is
		// still alive until this promise resolves or rejects.)
		if (this.abort) {
			throw new Error(`[KiloCode#ask] task ${this.taskId}.${this.instanceId} aborted`)
		}

		let askTs: number

		if (partial !== undefined) {
			const lastMessage = this.clineMessages.at(-1)

			const isUpdatingPreviousPartial =
				lastMessage && lastMessage.partial && lastMessage.type === "ask" && lastMessage.ask === type

			if (partial) {
				if (isUpdatingPreviousPartial) {
					// Existing partial message, so update it.
					lastMessage.text = text
					lastMessage.partial = partial
					lastMessage.progressStatus = progressStatus
					lastMessage.isProtected = isProtected
					// TODO: Be more efficient about saving and posting only new
					// data or one whole message at a time so ignore partial for
					// saves, and only post parts of partial message instead of
					// whole array in new listener.
					this.updateClineMessage(lastMessage)
					throw new Error("Current ask promise was ignored (#1)")
				} else {
					// This is a new partial message, so add it with partial
					// state.
					askTs = await this.nextClineMessageTimestamp_kilocode()
					this.lastMessageTs = askTs
					await this.addToClineMessages({ ts: askTs, type: "ask", ask: type, text, partial, isProtected })
					throw new Error("Current ask promise was ignored (#2)")
				}
			} else {
				if (isUpdatingPreviousPartial) {
					// This is the complete version of a previously partial
					// message, so replace the partial with the complete version.
					this.askResponse = undefined
					this.askResponseText = undefined
					this.askResponseImages = undefined

					// Bug for the history books:
					// In the webview we use the ts as the chatrow key for the
					// virtuoso list. Since we would update this ts right at the
					// end of streaming, it would cause the view to flicker. The
					// key prop has to be stable otherwise react has trouble
					// reconciling items between renders, causing unmounting and
					// remounting of components (flickering).
					// The lesson here is if you see flickering when rendering
					// lists, it's likely because the key prop is not stable.
					// So in this case we must make sure that the message ts is
					// never altered after first setting it.
					askTs = lastMessage.ts
					this.lastMessageTs = askTs
					lastMessage.text = text
					lastMessage.partial = false
					lastMessage.progressStatus = progressStatus
					lastMessage.isProtected = isProtected
					await this.saveClineMessages()
					this.updateClineMessage(lastMessage)
				} else {
					// This is a new and complete message, so add it like normal.
					this.askResponse = undefined
					this.askResponseText = undefined
					this.askResponseImages = undefined
					askTs = await this.nextClineMessageTimestamp_kilocode()
					this.lastMessageTs = askTs
					await this.addToClineMessages({ ts: askTs, type: "ask", ask: type, text, isProtected })
				}
			}
		} else {
			// This is a new non-partial message, so add it like normal.
			this.askResponse = undefined
			this.askResponseText = undefined
			this.askResponseImages = undefined
			askTs = await this.nextClineMessageTimestamp_kilocode()
			this.lastMessageTs = askTs
			await this.addToClineMessages({ ts: askTs, type: "ask", ask: type, text, isProtected })
		}

		// kilocode_change start: YOLO mode auto-answer for follow-up questions
		// Check if this is a follow-up question with suggestions in YOLO mode
		if (type === "followup" && text && !partial) {
			try {
				const state = await this.providerRef.deref()?.getState()
				if (state?.yoloMode) {
					// Parse the follow-up JSON to extract suggestions
					const followUpData = JSON.parse(text)
					if (
						followUpData.suggest &&
						Array.isArray(followUpData.suggest) &&
						followUpData.suggest.length > 0
					) {
						// Auto-select the first suggestion
						const firstSuggestion = followUpData.suggest[0]
						const autoAnswer = firstSuggestion.answer || firstSuggestion

						// Immediately set the response as if the user clicked the first suggestion
						this.handleWebviewAskResponse("messageResponse", autoAnswer, undefined)

						// Return immediately with the auto-selected answer
						const result = { response: this.askResponse!, text: autoAnswer, images: undefined }
						this.askResponse = undefined
						this.askResponseText = undefined
						this.askResponseImages = undefined
						return result
					}
				}
			} catch (error) {
				// If parsing fails or YOLO check fails, continue with normal flow
				console.warn("Failed to auto-answer follow-up question in YOLO mode:", error)
			}
		}
		// kilocode_change end

		// The state is mutable if the message is complete and the task will
		// block (via the `pWaitFor`).
		const isBlocking = !(this.askResponse !== undefined || this.lastMessageTs !== askTs)
		const isMessageQueued = !this.messageQueueService.isEmpty()
		const isStatusMutable = !partial && isBlocking && !isMessageQueued
		let statusMutationTimeouts: NodeJS.Timeout[] = []
		const statusMutationTimeout = 5_000

		if (isStatusMutable) {
			console.log(`Task#ask will block -> type: ${type}`)

			if (isInteractiveAsk(type)) {
				statusMutationTimeouts.push(
					setTimeout(() => {
						const message = this.findMessageByTimestamp(askTs)

						if (message) {
							this.interactiveAsk = message
							this.emit(RooCodeEventName.TaskInteractive, this.taskId)
						}
					}, statusMutationTimeout),
				)
			} else if (isResumableAsk(type)) {
				statusMutationTimeouts.push(
					setTimeout(() => {
						const message = this.findMessageByTimestamp(askTs)

						if (message) {
							this.resumableAsk = message
							this.emit(RooCodeEventName.TaskResumable, this.taskId)
						}
					}, statusMutationTimeout),
				)
			} else if (isIdleAsk(type)) {
				statusMutationTimeouts.push(
					setTimeout(() => {
						const message = this.findMessageByTimestamp(askTs)

						if (message) {
							this.idleAsk = message
							this.emit(RooCodeEventName.TaskIdle, this.taskId)
						}
					}, statusMutationTimeout),
				)
			}
		} else if (isMessageQueued) {
			console.log("Task#ask will process message queue")

			const message = this.messageQueueService.dequeueMessage()

			if (message) {
				// Check if this is a tool approval ask that needs to be handled.
				if (
					type === "tool" ||
					type === "command" ||
					type === "browser_action_launch" ||
					type === "use_mcp_server"
				) {
					// For tool approvals, we need to approve first, then send
					// the message if there's text/images.
					this.handleWebviewAskResponse("yesButtonClicked", message.text, message.images)
				} else {
					// For other ask types (like followup), fulfill the ask
					// directly.
					this.setMessageResponse(message.text, message.images)
				}
			}
		}

		// Wait for askResponse to be set.
		await pWaitFor(() => this.askResponse !== undefined || this.lastMessageTs !== askTs, { interval: 100 })

		if (this.lastMessageTs !== askTs) {
			// Could happen if we send multiple asks in a row i.e. with
			// command_output. It's important that when we know an ask could
			// fail, it is handled gracefully.
			throw new Error("Current ask promise was ignored")
		}

		const result = { response: this.askResponse!, text: this.askResponseText, images: this.askResponseImages }
		this.askResponse = undefined
		this.askResponseText = undefined
		this.askResponseImages = undefined

		// Cancel the timeouts if they are still running.
		statusMutationTimeouts.forEach((timeout) => clearTimeout(timeout))

		// Switch back to an active state.
		if (this.idleAsk || this.resumableAsk || this.interactiveAsk) {
			this.idleAsk = undefined
			this.resumableAsk = undefined
			this.interactiveAsk = undefined
			this.emit(RooCodeEventName.TaskActive, this.taskId)
		}

		this.emit(RooCodeEventName.TaskAskResponded)
		return result
	}

	public setMessageResponse(text: string, images?: string[]) {
		this.handleWebviewAskResponse("messageResponse", text, images)
	}

	handleWebviewAskResponse(askResponse: ClineAskResponse, text?: string, images?: string[]) {
		// this.askResponse = askResponse kilocode_change
		this.askResponseText = text
		this.askResponseImages = images

		// kilocode_change start
		// the askResponse assignment needs to happen last to avoid the async
		// callbacks triggering before we assign the data above
		this.askResponse = askResponse // this triggers async callbacks
		// kilocode_change end

		// Create a checkpoint whenever the user sends a message.
		// Use allowEmpty=true to ensure a checkpoint is recorded even if there are no file changes.
		// Suppress the checkpoint_saved chat row for this particular checkpoint to keep the timeline clean.
		if (askResponse === "messageResponse") {
			void this.checkpointSave(false, true)
		}

		// Mark the last follow-up question as answered
		if (askResponse === "messageResponse" || askResponse === "yesButtonClicked") {
			// Find the last unanswered follow-up message using findLastIndex
			const lastFollowUpIndex = findLastIndex(
				this.clineMessages,
				(msg) => msg.type === "ask" && msg.ask === "followup" && !msg.isAnswered,
			)

			if (lastFollowUpIndex !== -1) {
				// Mark this follow-up as answered
				this.clineMessages[lastFollowUpIndex].isAnswered = true
				// Save the updated messages
				this.saveClineMessages().catch((error) => {
					console.error("Failed to save answered follow-up state:", error)
				})
			}
		}
	}

	public approveAsk({ text, images }: { text?: string; images?: string[] } = {}) {
		this.handleWebviewAskResponse("yesButtonClicked", text, images)
	}

	public denyAsk({ text, images }: { text?: string; images?: string[] } = {}) {
		this.handleWebviewAskResponse("noButtonClicked", text, images)
	}

	public async submitUserMessage(
		text: string,
		images?: string[],
		mode?: string,
		providerProfile?: string,
	): Promise<void> {
		try {
			text = (text ?? "").trim()
			images = images ?? []

			if (text.length === 0 && images.length === 0) {
				return
			}

			const provider = this.providerRef.deref()

			if (provider) {
				if (mode) {
					await provider.setMode(mode)
				}

				if (providerProfile) {
					await provider.setProviderProfile(providerProfile)
				}

				this.emit(RooCodeEventName.TaskUserMessage, this.taskId)

				provider.postMessageToWebview({ type: "invoke", invoke: "sendMessage", text, images })
			} else {
				console.error("[Task#submitUserMessage] Provider reference lost")
			}
		} catch (error) {
			console.error("[Task#submitUserMessage] Failed to submit user message:", error)
		}
	}

	async handleTerminalOperation(terminalOperation: "continue" | "abort") {
		if (terminalOperation === "continue") {
			this.terminalProcess?.continue()
		} else if (terminalOperation === "abort") {
			this.terminalProcess?.abort()
		}
	}

	public async condenseContext(): Promise<void> {
		const systemPrompt = await this.getSystemPrompt()

		// Get condensing configuration
		const state = await this.providerRef.deref()?.getState()
		// These properties may not exist in the state type yet, but are used for condensing configuration
		const customCondensingPrompt = state?.customCondensingPrompt
		const condensingApiConfigId = state?.condensingApiConfigId
		const listApiConfigMeta = state?.listApiConfigMeta

		// Determine API handler to use
		let condensingApiHandler: ApiHandler | undefined
		if (condensingApiConfigId && listApiConfigMeta && Array.isArray(listApiConfigMeta)) {
			// Find matching config by ID
			const matchingConfig = listApiConfigMeta.find((config) => config.id === condensingApiConfigId)
			if (matchingConfig) {
				const profile = await this.providerRef.deref()?.providerSettingsManager.getProfile({
					id: condensingApiConfigId,
				})
				// Ensure profile and apiProvider exist before trying to build handler
				if (profile && profile.apiProvider) {
					condensingApiHandler = buildApiHandler(profile)
				}
			}
		}

		const { contextTokens: prevContextTokens } = this.getTokenUsage()

		const {
			messages,
			summary,
			cost,
			newContextTokens = 0,
			error,
		} = await summarizeConversation(
			this.apiConversationHistory,
			this.api, // Main API handler (fallback)
			systemPrompt, // Default summarization prompt (fallback)
			this.taskId,
			prevContextTokens,
			false, // manual trigger
			customCondensingPrompt, // User's custom prompt
			condensingApiHandler, // Specific handler for condensing
		)
		if (error) {
			this.say(
				"condense_context_error",
				error,
				undefined /* images */,
				false /* partial */,
				undefined /* checkpoint */,
				undefined /* progressStatus */,
				{ isNonInteractive: true } /* options */,
			)
			return
		}
		await this.overwriteApiConversationHistory(messages)

		// Set flag to skip previous_response_id on the next API call after manual condense
		this.skipPrevResponseIdOnce = true

		const contextCondense: ContextCondense = { summary, cost, newContextTokens, prevContextTokens }
		await this.say(
			"condense_context",
			undefined /* text */,
			undefined /* images */,
			false /* partial */,
			undefined /* checkpoint */,
			undefined /* progressStatus */,
			{ isNonInteractive: true } /* options */,
			contextCondense,
		)

		// Process any queued messages after condensing completes
		this.processQueuedMessages()
	}

	async say(
		type: ClineSay,
		text?: string,
		images?: string[],
		partial?: boolean,
		checkpoint?: Record<string, unknown>,
		progressStatus?: ToolProgressStatus,
		options: {
			isNonInteractive?: boolean
			metadata?: Record<string, unknown>
		} = {},
		contextCondense?: ContextCondense,
	): Promise<undefined> {
		if (this.abort) {
			throw new Error(`[Kilo Code#say] task ${this.taskId}.${this.instanceId} aborted`)
		}

		if (partial !== undefined) {
			const lastMessage = this.clineMessages.at(-1)

			const isUpdatingPreviousPartial =
				lastMessage && lastMessage.partial && lastMessage.type === "say" && lastMessage.say === type

			if (partial) {
				if (isUpdatingPreviousPartial) {
					// Existing partial message, so update it.
					lastMessage.text = text
					lastMessage.images = images
					lastMessage.partial = partial
					lastMessage.progressStatus = progressStatus
					this.updateClineMessage(lastMessage)
				} else {
					// This is a new partial message, so add it with partial state.
					const sayTs = await this.nextClineMessageTimestamp_kilocode()

					if (!options.isNonInteractive) {
						this.lastMessageTs = sayTs
					}

					await this.addToClineMessages({
						ts: sayTs,
						type: "say",
						say: type,
						text,
						images,
						partial,
						contextCondense,
						metadata: options.metadata,
					})
				}
			} else {
				// New now have a complete version of a previously partial message.
				// This is the complete version of a previously partial
				// message, so replace the partial with the complete version.
				if (isUpdatingPreviousPartial) {
					if (!options.isNonInteractive) {
						this.lastMessageTs = lastMessage.ts
					}

					lastMessage.text = text
					lastMessage.images = images
					lastMessage.partial = false
					lastMessage.progressStatus = progressStatus
					if (options.metadata) {
						// Add metadata to the message
						const messageWithMetadata = lastMessage as ClineMessage & ClineMessageWithMetadata
						if (!messageWithMetadata.metadata) {
							messageWithMetadata.metadata = {}
						}
						Object.assign(messageWithMetadata.metadata, options.metadata)
					}

					// Instead of streaming partialMessage events, we do a save
					// and post like normal to persist to disk.
					await this.saveClineMessages()

					// More performant than an entire `postStateToWebview`.
					this.updateClineMessage(lastMessage)
				} else {
					// This is a new and complete message, so add it like normal.
					const sayTs = await this.nextClineMessageTimestamp_kilocode()

					if (!options.isNonInteractive) {
						this.lastMessageTs = sayTs
					}

					await this.addToClineMessages({
						ts: sayTs,
						type: "say",
						say: type,
						text,
						images,
						contextCondense,
						metadata: options.metadata,
					})
				}
			}
		} else {
			// This is a new non-partial message, so add it like normal.
			const sayTs = await this.nextClineMessageTimestamp_kilocode()

			// A "non-interactive" message is a message is one that the user
			// does not need to respond to. We don't want these message types
			// to trigger an update to `lastMessageTs` since they can be created
			// asynchronously and could interrupt a pending ask.
			if (!options.isNonInteractive) {
				this.lastMessageTs = sayTs
			}

			await this.addToClineMessages({
				ts: sayTs,
				type: "say",
				say: type,
				text,
				images,
				checkpoint,
				contextCondense,
			})
		}
	}

	async sayAndCreateMissingParamError(toolName: ToolName, paramName: string, relPath?: string) {
		const kilocodeExtraText = (() => {
			switch (toolName) {
				case "apply_diff":
					return t("kilocode:task.disableApplyDiff") + " "
				case "edit_file":
					return t("kilocode:task.disableEditFile") + " "
				default:
					return ""
			}
		})()
		await this.say(
			"error",
			`Kilo Code tried to use ${toolName}${
				relPath ? ` for '${relPath.toPosix()}'` : ""
			} without value for required parameter '${paramName}'. ${kilocodeExtraText}Retrying...`,
		)
		return formatResponse.toolError(
			formatResponse.missingToolParameterError(
				paramName,
				getActiveToolUseStyle(this.apiConfiguration), // kilocode_change
			),
		)
	}

	// Lifecycle
	// Start / Resume / Abort / Dispose

	private async startTask(task?: string, images?: string[]): Promise<void> {
		if (this.enableBridge) {
			try {
				await BridgeOrchestrator.subscribeToTask(this)
			} catch (error) {
				console.error(
					`[Task#startTask] BridgeOrchestrator.subscribeToTask() failed: ${error instanceof Error ? error.message : String(error)}`,
				)
			}
		}

		// `conversationHistory` (for API) and `clineMessages` (for webview)
		// need to be in sync.
		// If the extension process were killed, then on restart the
		// `clineMessages` might not be empty, so we need to set it to [] when
		// we create a new Cline client (otherwise webview would show stale
		// messages from previous session).
		this.clineMessages = []
		this.apiConversationHistory = []

		// The todo list is already set in the constructor if initialTodos were provided
		// No need to add any messages - the todoList property is already set

		await this.providerRef.deref()?.postStateToWebview()

		await this.say("text", task, images)
		this.isInitialized = true

		let imageBlocks: Anthropic.ImageBlockParam[] = formatResponse.imageBlocks(images)

		// Task starting

		await this.initiateTaskLoop([
			{
				type: "text",
				text: `<task>\n${task}\n</task>`,
			},
			...imageBlocks,
		])
	}

	private async resumeTaskFromHistory() {
		if (this.enableBridge) {
			try {
				await BridgeOrchestrator.subscribeToTask(this)
			} catch (error) {
				console.error(
					`[Task#resumeTaskFromHistory] BridgeOrchestrator.subscribeToTask() failed: ${error instanceof Error ? error.message : String(error)}`,
				)
			}
		}

		const modifiedClineMessages = await this.getSavedClineMessages()

		// Check for any stored GPT-5 response IDs in the message history.
		const gpt5Messages = modifiedClineMessages.filter(
			(m): m is ClineMessage & ClineMessageWithMetadata =>
				m.type === "say" &&
				m.say === "text" &&
				!!(m as ClineMessageWithMetadata).metadata?.gpt5?.previous_response_id,
		)

		if (gpt5Messages.length > 0) {
			const lastGpt5Message = gpt5Messages[gpt5Messages.length - 1]
			// The lastGpt5Message contains the previous_response_id that can be
			// used for continuity.
		}

		// Remove any resume messages that may have been added before.
		const lastRelevantMessageIndex = findLastIndex(
			modifiedClineMessages,
			(m) => !(m.ask === "resume_task" || m.ask === "resume_completed_task"),
		)

		if (lastRelevantMessageIndex !== -1) {
			modifiedClineMessages.splice(lastRelevantMessageIndex + 1)
		}

		// Remove any trailing reasoning-only UI messages that were not part of the persisted API conversation
		while (modifiedClineMessages.length > 0) {
			const last = modifiedClineMessages[modifiedClineMessages.length - 1]
			if (last.type === "say" && last.say === "reasoning") {
				modifiedClineMessages.pop()
			} else {
				break
			}
		}

		// Since we don't use `api_req_finished` anymore, we need to check if the
		// last `api_req_started` has a cost value, if it doesn't and no
		// cancellation reason to present, then we remove it since it indicates
		// an api request without any partial content streamed.
		const lastApiReqStartedIndex = findLastIndex(
			modifiedClineMessages,
			(m) => m.type === "say" && m.say === "api_req_started",
		)

		if (lastApiReqStartedIndex !== -1) {
			const lastApiReqStarted = modifiedClineMessages[lastApiReqStartedIndex]
			const { cost, cancelReason }: ClineApiReqInfo = JSON.parse(lastApiReqStarted.text || "{}")

			if (cost === undefined && cancelReason === undefined) {
				modifiedClineMessages.splice(lastApiReqStartedIndex, 1)
			}
		}

		await this.overwriteClineMessages(modifiedClineMessages)
		this.clineMessages = await this.getSavedClineMessages()

		// Now present the cline messages to the user and ask if they want to
		// resume (NOTE: we ran into a bug before where the
		// apiConversationHistory wouldn't be initialized when opening a old
		// task, and it was because we were waiting for resume).
		// This is important in case the user deletes messages without resuming
		// the task first.
		this.apiConversationHistory = await this.getSavedApiConversationHistory()

		const lastClineMessage = this.clineMessages
			.slice()
			.reverse()
			.find((m) => !(m.ask === "resume_task" || m.ask === "resume_completed_task")) // Could be multiple resume tasks.

		let askType: ClineAsk
		if (lastClineMessage?.ask === "completion_result") {
			askType = "resume_completed_task"
		} else {
			askType = "resume_task"
		}

		this.isInitialized = true

		const { response, text, images } = await this.ask(askType) // Calls `postStateToWebview`.

		let responseText: string | undefined
		let responseImages: string[] | undefined

		if (response === "messageResponse") {
			await this.say("user_feedback", text, images)
			responseText = text
			responseImages = images
		}

		// Make sure that the api conversation history can be resumed by the API,
		// even if it goes out of sync with cline messages.
		let existingApiConversationHistory: ApiMessage[] = await this.getSavedApiConversationHistory()

		// v2.0 xml tags refactor caveat: since we don't use tools anymore, we need to replace all tool use blocks with a text block since the API disallows conversations with tool uses and no tool schema
		// kilocode_change start
		//const conversationWithoutToolBlocks = existingApiConversationHistory.map((message) => {
		//	if (Array.isArray(message.content)) {
		//		const newContent = message.content.map((block) => {
		//			if (block.type === "tool_use") {
		//				// It's important we convert to the new tool schema
		//				// format so the model doesn't get confused about how to
		//				// invoke tools.
		//				const inputAsXml = Object.entries(block.input as Record<string, string>)
		//					.map(([key, value]) => `<${key}>\n${value}\n</${key}>`)
		//					.join("\n")
		//				return {
		//					type: "text",
		//					text: `<${block.name}>\n${inputAsXml}\n</${block.name}>`,
		//				} as Anthropic.Messages.TextBlockParam
		//			} else if (block.type === "tool_result") {
		//				// Convert block.content to text block array, removing images
		//				const contentAsTextBlocks = Array.isArray(block.content)
		//					? block.content.filter((item) => item.type === "text")
		//					: [{ type: "text", text: block.content }]
		//				const textContent = contentAsTextBlocks.map((item) => item.text).join("\n\n")
		//				const toolName = findToolName(block.tool_use_id, existingApiConversationHistory)
		//				return {
		//					type: "text",
		//					text: `[${toolName} Result]\n\n${textContent}`,
		//				} as Anthropic.Messages.TextBlockParam
		//			}
		//			return block
		//		})
		//		return { ...message, content: newContent }
		//	}
		//	return message
		//})
		//existingApiConversationHistory = conversationWithoutToolBlocks
		// kilocode_change end

		// FIXME: remove tool use blocks altogether

		// if the last message is an assistant message, we need to check if there's tool use since every tool use has to have a tool response
		// if there's no tool use and only a text block, then we can just add a user message
		// (note this isn't relevant anymore since we use custom tool prompts instead of tool use blocks, but this is here for legacy purposes in case users resume old tasks)

		// if the last message is a user message, we can need to get the assistant message before it to see if it made tool calls, and if so, fill in the remaining tool responses with 'interrupted'

		let modifiedOldUserContent: Anthropic.Messages.ContentBlockParam[] // either the last message if its user message, or the user message before the last (assistant) message
		let modifiedApiConversationHistory: ApiMessage[] // need to remove the last user message to replace with new modified user message
		if (existingApiConversationHistory.length > 0) {
			const lastMessage = existingApiConversationHistory[existingApiConversationHistory.length - 1]

			if (lastMessage.role === "assistant") {
				const content = Array.isArray(lastMessage.content)
					? lastMessage.content
					: [{ type: "text", text: lastMessage.content }]
				const hasToolUse = content.some((block) => block.type === "tool_use")

				if (hasToolUse) {
					const toolUseBlocks = content.filter(
						(block) => block.type === "tool_use",
					) as Anthropic.Messages.ToolUseBlock[]
					const toolResponses: Anthropic.ToolResultBlockParam[] = toolUseBlocks.map((block) => ({
						type: "tool_result",
						tool_use_id: block.id,
						content: "Task was interrupted before this tool call could be completed.",
					}))
					modifiedApiConversationHistory = [...existingApiConversationHistory] // no changes
					modifiedOldUserContent = [...toolResponses]
				} else {
					modifiedApiConversationHistory = [...existingApiConversationHistory]
					modifiedOldUserContent = []
				}
			} else if (lastMessage.role === "user") {
				const previousAssistantMessage: ApiMessage | undefined =
					existingApiConversationHistory[existingApiConversationHistory.length - 2]

				const existingUserContent: Anthropic.Messages.ContentBlockParam[] = Array.isArray(lastMessage.content)
					? lastMessage.content
					: [{ type: "text", text: lastMessage.content }]
				if (previousAssistantMessage && previousAssistantMessage.role === "assistant") {
					const assistantContent = Array.isArray(previousAssistantMessage.content)
						? previousAssistantMessage.content
						: [{ type: "text", text: previousAssistantMessage.content }]

					const toolUseBlocks = assistantContent.filter(
						(block) => block.type === "tool_use",
					) as Anthropic.Messages.ToolUseBlock[]

					if (toolUseBlocks.length > 0) {
						const existingToolResults = existingUserContent.filter(
							(block) => block.type === "tool_result",
						) as Anthropic.ToolResultBlockParam[]

						const missingToolResponses: Anthropic.ToolResultBlockParam[] = toolUseBlocks
							.filter(
								(toolUse) => !existingToolResults.some((result) => result.tool_use_id === toolUse.id),
							)
							.map((toolUse) => ({
								type: "tool_result",
								tool_use_id: toolUse.id,
								content: "Task was interrupted before this tool call could be completed.",
							}))

						modifiedApiConversationHistory = existingApiConversationHistory.slice(0, -1) // removes the last user message
						modifiedOldUserContent = [...existingUserContent, ...missingToolResponses]
					} else {
						modifiedApiConversationHistory = existingApiConversationHistory.slice(0, -1)
						modifiedOldUserContent = [...existingUserContent]
					}
				} else {
					modifiedApiConversationHistory = existingApiConversationHistory.slice(0, -1)
					modifiedOldUserContent = [...existingUserContent]
				}
			} else {
				throw new Error("Unexpected: Last message is not a user or assistant message")
			}
		} else {
			throw new Error("Unexpected: No existing API conversation history")
		}

		let newUserContent: Anthropic.Messages.ContentBlockParam[] = [...modifiedOldUserContent]

		const agoText = ((): string => {
			const timestamp = lastClineMessage?.ts ?? Date.now()
			const now = Date.now()
			const diff = now - timestamp
			const minutes = Math.floor(diff / 60000)
			const hours = Math.floor(minutes / 60)
			const days = Math.floor(hours / 24)

			if (days > 0) {
				return `${days} day${days > 1 ? "s" : ""} ago`
			}
			if (hours > 0) {
				return `${hours} hour${hours > 1 ? "s" : ""} ago`
			}
			if (minutes > 0) {
				return `${minutes} minute${minutes > 1 ? "s" : ""} ago`
			}
			return "just now"
		})()

		if (responseText) {
			newUserContent.push({
				type: "text",
				text: `\n\nNew instructions for task continuation:\n<user_message>\n${responseText}\n</user_message>`,
			})
		}

		if (responseImages && responseImages.length > 0) {
			newUserContent.push(...formatResponse.imageBlocks(responseImages))
		}

		// Ensure we have at least some content to send to the API.
		// If newUserContent is empty, add a minimal resumption message.
		if (newUserContent.length === 0) {
			newUserContent.push({
				type: "text",
				text: "[TASK RESUMPTION] Resuming task...",
			})
		}

		await this.overwriteApiConversationHistory(modifiedApiConversationHistory)

		// Task resuming from history item.
		await this.initiateTaskLoop(newUserContent)
	}

	public async abortTask(isAbandoned = false) {
		// Aborting task

		// Will stop any autonomously running promises.
		if (isAbandoned) {
			this.abandoned = true
		}

		this.abort = true
		this.emit(RooCodeEventName.TaskAborted)

		try {
			this.dispose() // Call the centralized dispose method
		} catch (error) {
			console.error(`Error during task ${this.taskId}.${this.instanceId} disposal:`, error)
			// Don't rethrow - we want abort to always succeed
		}
		// Save the countdown message in the automatic retry or other content.
		try {
			// Save the countdown message in the automatic retry or other content.
			await this.saveClineMessages()
		} catch (error) {
			console.error(`Error saving messages during abort for task ${this.taskId}.${this.instanceId}:`, error)
		}
	}

	public dispose(): void {
		console.log(`[Task#dispose] disposing task ${this.taskId}.${this.instanceId}`)

		// Dispose message queue and remove event listeners.
		try {
			if (this.messageQueueStateChangedHandler) {
				this.messageQueueService.removeListener("stateChanged", this.messageQueueStateChangedHandler)
				this.messageQueueStateChangedHandler = undefined
			}

			this.messageQueueService.dispose()
		} catch (error) {
			console.error("Error disposing message queue:", error)
		}

		// Remove all event listeners to prevent memory leaks.
		try {
			this.removeAllListeners()
		} catch (error) {
			console.error("Error removing event listeners:", error)
		}

		// Stop waiting for child task completion.
		if (this.pauseInterval) {
			clearInterval(this.pauseInterval)
			this.pauseInterval = undefined
		}

		if (this.enableBridge) {
			BridgeOrchestrator.getInstance()
				?.unsubscribeFromTask(this.taskId)
				.catch((error) =>
					console.error(
						`[Task#dispose] BridgeOrchestrator#unsubscribeFromTask() failed: ${error instanceof Error ? error.message : String(error)}`,
					),
				)
		}

		// Release any terminals associated with this task.
		try {
			// Release any terminals associated with this task.
			TerminalRegistry.releaseTerminalsForTask(this.taskId)
		} catch (error) {
			console.error("Error releasing terminals:", error)
		}

		try {
			this.urlContentFetcher.closeBrowser()
		} catch (error) {
			console.error("Error closing URL content fetcher browser:", error)
		}

		try {
			this.browserSession.closeBrowser()
		} catch (error) {
			console.error("Error closing browser session:", error)
		}

		try {
			if (this.rooIgnoreController) {
				this.rooIgnoreController.dispose()
				this.rooIgnoreController = undefined
			}
		} catch (error) {
			console.error("Error disposing RooIgnoreController:", error)
			// This is the critical one for the leak fix.
		}

		try {
			this.fileContextTracker.dispose()
		} catch (error) {
			console.error("Error disposing file context tracker:", error)
		}

		try {
			// If we're not streaming then `abortStream` won't be called.
			if (this.isStreaming && this.diffViewProvider.isEditing) {
				this.diffViewProvider.revertChanges().catch(console.error)
			}
		} catch (error) {
			console.error("Error reverting diff changes:", error)
		}
	}

	// Subtasks
	// Spawn / Wait / Complete

	public async startSubtask(message: string, initialTodos: TodoItem[], mode: string) {
		const provider = this.providerRef.deref()

		if (!provider) {
			throw new Error("Provider not available")
		}

		const newTask = await provider.createTask(message, undefined, this, { initialTodos })

		if (newTask) {
			this.isPaused = true // Pause parent.
			this.childTaskId = newTask.taskId

			await provider.handleModeSwitch(mode) // Set child's mode.
			await delay(500) // Allow mode change to take effect.

			this.emit(RooCodeEventName.TaskPaused, this.taskId)
			this.emit(RooCodeEventName.TaskSpawned, newTask.taskId)
		}

		return newTask
	}

	// Used when a sub-task is launched and the parent task is waiting for it to
	// finish.
	// TBD: Add a timeout to prevent infinite waiting.
	public async waitForSubtask() {
		await new Promise<void>((resolve) => {
			this.pauseInterval = setInterval(() => {
				if (!this.isPaused) {
					clearInterval(this.pauseInterval)
					this.pauseInterval = undefined
					resolve()
				}
			}, 1000)
		})
	}

	public async completeSubtask(lastMessage: string) {
		this.isPaused = false
		this.childTaskId = undefined

		this.emit(RooCodeEventName.TaskUnpaused, this.taskId)

		// Fake an answer from the subtask that it has completed running and
		// this is the result of what it has done add the message to the chat
		// history and to the webview ui.
		try {
			await this.say("subtask_result", lastMessage)

			await this.addToApiConversationHistory({
				role: "user",
				content: [{ type: "text", text: `[new_task completed] Result: ${lastMessage}` }],
			})

			// Set skipPrevResponseIdOnce to ensure the next API call sends the full conversation
			// including the subtask result, not just from before the subtask was created
			this.skipPrevResponseIdOnce = true
		} catch (error) {
			this.providerRef
				.deref()
				?.log(`Error failed to add reply from subtask into conversation of parent task, error: ${error}`)

			throw error
		}
	}

	// Task Loop

	private async initiateTaskLoop(userContent: Anthropic.Messages.ContentBlockParam[]): Promise<void> {
		// Kicks off the checkpoints initialization process in the background.
		getCheckpointService(this)

		let nextUserContent = userContent
		let includeFileDetails = true

		this.emit(RooCodeEventName.TaskStarted)

		while (!this.abort) {
			const didEndLoop = await this.recursivelyMakeClineRequests(nextUserContent, includeFileDetails)
			includeFileDetails = false // We only need file details the first time.

			// The way this agentic loop works is that cline will be given a
			// task that he then calls tools to complete. Unless there's an
			// attempt_completion call, we keep responding back to him with his
			// tool's responses until he either attempt_completion or does not
			// use anymore tools. If he does not use anymore tools, we ask him
			// to consider if he's completed the task and then call
			// attempt_completion, otherwise proceed with completing the task.
			// There is a MAX_REQUESTS_PER_TASK limit to prevent infinite
			// requests, but Cline is prompted to finish the task as efficiently
			// as he can.

			if (didEndLoop) {
				// For now a task never 'completes'. This will only happen if
				// the user hits max requests and denies resetting the count.
				break
			} else {
				nextUserContent = [
					{
						type: "text",
						text: formatResponse.noToolsUsed(
							getActiveToolUseStyle(this.apiConfiguration), // kilocode_change
						),
					},
				]
				this.consecutiveMistakeCount++
			}
		}
	}

	public async recursivelyMakeClineRequests(
		userContent: Anthropic.Messages.ContentBlockParam[],
		includeFileDetails: boolean = false,
	): Promise<boolean> {
		interface StackItem {
			userContent: Anthropic.Messages.ContentBlockParam[]
			includeFileDetails: boolean
			retryAttempt?: number
		}

		const stack: StackItem[] = [{ userContent, includeFileDetails, retryAttempt: 0 }]

		while (stack.length > 0) {
			const currentItem = stack.pop()!
			const currentUserContent = currentItem.userContent
			const currentIncludeFileDetails = currentItem.includeFileDetails

			if (this.abort) {
				throw new Error(
					`[KiloCode#recursivelyMakeClineRequests] task ${this.taskId}.${this.instanceId} aborted`,
				)
			}

			if (this.consecutiveMistakeLimit > 0 && this.consecutiveMistakeCount >= this.consecutiveMistakeLimit) {
				const { response, text, images } = await this.ask(
					"mistake_limit_reached",
					t("common:errors.mistake_limit_guidance"),
				)

				if (response === "messageResponse") {
					currentUserContent.push(
						...[
							{ type: "text" as const, text: formatResponse.tooManyMistakes(text) },
							...formatResponse.imageBlocks(images),
						],
					)

					await this.say("user_feedback", text, images)

					// Track consecutive mistake errors in telemetry.
					TelemetryService.instance.captureConsecutiveMistakeError(this.taskId)
				}

				this.consecutiveMistakeCount = 0
			}

			// In this Cline request loop, we need to check if this task instance
			// has been asked to wait for a subtask to finish before continuing.
			const provider = this.providerRef.deref()

			if (this.isPaused && provider) {
				provider.log(`[subtasks] paused ${this.taskId}.${this.instanceId}`)
				await this.waitForSubtask()
				provider.log(`[subtasks] resumed ${this.taskId}.${this.instanceId}`)
				const currentMode = (await provider.getState())?.mode ?? defaultModeSlug

				if (currentMode !== this.pausedModeSlug) {
					// The mode has changed, we need to switch back to the paused mode.
					await provider.handleModeSwitch(this.pausedModeSlug)

					// Delay to allow mode change to take effect before next tool is executed.
					await delay(500)

					provider.log(
						`[subtasks] task ${this.taskId}.${this.instanceId} has switched back to '${this.pausedModeSlug}' from '${currentMode}'`,
					)
				}
			}

			// Getting verbose details is an expensive operation, it uses ripgrep to
			// top-down build file structure of project which for large projects can
			// take a few seconds. For the best UX we show a placeholder api_req_started
			// message with a loading spinner as this happens.

			// Determine API protocol based on provider and model
			const modelId = getModelId(this.apiConfiguration)
			const apiProtocol = getApiProtocol(this.apiConfiguration.apiProvider, modelId)

			await this.say(
				"api_req_started",
				JSON.stringify({
					apiProtocol,
				}),
			)

			const {
				showRooIgnoredFiles = false,
				includeDiagnosticMessages = true,
				maxDiagnosticMessages = 50,
				maxReadFileLine = -1,
			} = (await this.providerRef.deref()?.getState()) ?? {}

			// kilocode_change start
			const [parsedUserContent, needsRulesFileCheck] = await processKiloUserContentMentions({
				context: this.getContext(),
				userContent: currentUserContent,
				cwd: this.cwd,
				urlContentFetcher: this.urlContentFetcher,
				fileContextTracker: this.fileContextTracker,
				rooIgnoreController: this.rooIgnoreController,
				showRooIgnoredFiles,
				includeDiagnosticMessages,
				maxDiagnosticMessages,
				maxReadFileLine,
			})

			if (needsRulesFileCheck) {
				await this.say(
					"error",
					"Issue with processing the /newrule command. Double check that, if '.kilocode/rules' already exists, it's a directory and not a file. Otherwise there was an issue referencing this file/directory",
				)
			}
			// kilocode_change end

			const environmentDetails = await getEnvironmentDetails(this, currentIncludeFileDetails)

			// Add environment details as its own text block, separate from tool
			// results.
			const finalUserContent = mergeEnvironmentDetailsIntoUserContent(parsedUserContent, environmentDetails) // kilocode_change: support interleaved thinking for environment details
			await this.addToApiConversationHistory({ role: "user", content: finalUserContent })
			TelemetryService.instance.captureConversationMessage(this.taskId, "user")

			// Since we sent off a placeholder api_req_started message to update the
			// webview while waiting to actually start the API request (to load
			// potential details for example), we need to update the text of that
			// message.
			const lastApiReqIndex = findLastIndex(this.clineMessages, (m) => m.say === "api_req_started")

			this.clineMessages[lastApiReqIndex].text = JSON.stringify({
				apiProtocol,
			} satisfies ClineApiReqInfo)

			await this.saveClineMessages()
			await provider?.postStateToWebview()

			try {
				let cacheWriteTokens = 0
				let cacheReadTokens = 0
				let inputTokens = 0
				let outputTokens = 0
				let totalCost: number | undefined

				// kilocode_change start
				let inferenceProvider: string | undefined
				let usageMissing = false
				const apiRequestStartTime = performance.now()
				// kilocode_change end

				// We can't use `api_req_finished` anymore since it's a unique case
				// where it could come after a streaming message (i.e. in the middle
				// of being updated or executed).
				// Fortunately `api_req_finished` was always parsed out for the GUI
				// anyways, so it remains solely for legacy purposes to keep track
				// of prices in tasks from history (it's worth removing a few months
				// from now).
				const updateApiReqMsg = (cancelReason?: ClineApiReqCancelReason, streamingFailedMessage?: string) => {
					if (lastApiReqIndex < 0 || !this.clineMessages[lastApiReqIndex]) {
						return
					}

					const existingData = JSON.parse(this.clineMessages[lastApiReqIndex].text || "{}")

					// Calculate total tokens and cost using provider-aware function
					const modelId = getModelId(this.apiConfiguration)
					const apiProtocol = getApiProtocol(this.apiConfiguration.apiProvider, modelId)

					const costResult =
						apiProtocol === "anthropic"
							? calculateApiCostAnthropic(
									this.api.getModel().info,
									inputTokens,
									outputTokens,
									cacheWriteTokens,
									cacheReadTokens,
								)
							: calculateApiCostOpenAI(
									this.api.getModel().info,
									inputTokens,
									outputTokens,
									cacheWriteTokens,
									cacheReadTokens,
								)

					this.clineMessages[lastApiReqIndex].text = JSON.stringify({
						...existingData,
						tokensIn: costResult.totalInputTokens,
						tokensOut: costResult.totalOutputTokens,
						cacheWrites: cacheWriteTokens,
						cacheReads: cacheReadTokens,
						cost: totalCost ?? costResult.totalCost,
						// kilocode_change start
						usageMissing,
						inferenceProvider,
						// kilocode_change end
						cancelReason,
						streamingFailedMessage,
					} satisfies ClineApiReqInfo)
				}

				const abortStream = async (cancelReason: ClineApiReqCancelReason, streamingFailedMessage?: string) => {
					if (this.diffViewProvider.isEditing) {
						await this.diffViewProvider.revertChanges() // closes diff view
					}

					// if last message is a partial we need to update and save it
					const lastMessage = this.clineMessages.at(-1)

					if (lastMessage && lastMessage.partial) {
						// lastMessage.ts = Date.now() DO NOT update ts since it is used as a key for virtuoso list
						lastMessage.partial = false
						// instead of streaming partialMessage events, we do a save and post like normal to persist to disk
						console.log("updating partial message", lastMessage)
					}

					// Update `api_req_started` to have cancelled and cost, so that
					// we can display the cost of the partial stream and the cancellation reason
					updateApiReqMsg(cancelReason, streamingFailedMessage)
					await this.saveClineMessages()

					// Signals to provider that it can retrieve the saved messages
					// from disk, as abortTask can not be awaited on in nature.
					this.didFinishAbortingStream = true
				}

				// Reset streaming state for each new API request
				this.currentStreamingContentIndex = 0
				this.currentStreamingDidCheckpoint = false
				this.assistantMessageContent = []
				this.didCompleteReadingStream = false
				this.userMessageContent = []
				this.userMessageContentReady = false
				this.didRejectTool = false
				this.didAlreadyUseTool = false
				this.presentAssistantMessageLocked = false
				this.presentAssistantMessageHasPendingUpdates = false
				this.assistantMessageParser.reset()

				await this.diffViewProvider.reset()

				// Yields only if the first chunk is successful, otherwise will
				// allow the user to retry the request (most likely due to rate
				// limit error, which gets thrown on the first chunk).
				const stream = this.attemptApiRequest()
				let assistantMessage = ""
				let reasoningMessage = ""
				let pendingGroundingSources: GroundingSource[] = []
				this.isStreaming = true

				// kilocode_change start
				const assistantToolUses = new Array<Anthropic.Messages.ToolUseBlockParam>()
				const reasoningDetails = new Array<ReasoningDetail>()
				const antThinkingContent = new Array<
					Anthropic.Messages.RedactedThinkingBlock | Anthropic.Messages.ThinkingBlock
				>()
				// kilocode_change end

				try {
					const iterator = stream[Symbol.asyncIterator]()
					let item = await iterator.next()
					while (!item.done) {
						const chunk = item.value
						item = await iterator.next()
						if (!chunk) {
							// Sometimes chunk is undefined, no idea that can cause
							// it, but this workaround seems to fix it.
							continue
						}

						switch (chunk.type) {
							case "reasoning": {
								reasoningMessage += chunk.text
								// Only apply formatting if the message contains sentence-ending punctuation followed by **
								let formattedReasoning = reasoningMessage
								if (reasoningMessage.includes("**")) {
									// Add line breaks before **Title** patterns that appear after sentence endings
									// This targets section headers like "...end of sentence.**Title Here**"
									// Handles periods, exclamation marks, and question marks
									formattedReasoning = reasoningMessage.replace(
										/([.!?])\*\*([^*\n]+)\*\*/g,
										"$1\n\n**$2**",
									)
								}
								await this.say("reasoning", formattedReasoning, undefined, true)
								break
							}
							case "usage":
								inputTokens += chunk.inputTokens
								outputTokens += chunk.outputTokens
								cacheWriteTokens += chunk.cacheWriteTokens ?? 0
								cacheReadTokens += chunk.cacheReadTokens ?? 0
								totalCost = chunk.totalCost
								inferenceProvider = chunk.inferenceProvider // kilocode_change
								break
							case "grounding":
								// Handle grounding sources separately from regular content
								// to prevent state persistence issues - store them separately
								if (chunk.sources && chunk.sources.length > 0) {
									pendingGroundingSources.push(...chunk.sources)
								}
								break
							// kilocode_change start
							case "reasoning_details":
								// reasoning_details may be an array of 0 or 1 items depending on how openrouter returns it
								if (Array.isArray(chunk.reasoning_details)) {
									reasoningDetails.push(...chunk.reasoning_details)
								} else {
									reasoningDetails.push(chunk.reasoning_details)
								}
								break
							case "native_tool_calls": {
								// Handle native OpenAI-format tool calls
								// Process native tool calls through the parser
								for (const toolUse of this.assistantMessageParser.processNativeToolCalls(
									chunk.toolCalls,
								)) {
									assistantToolUses.push(toolUse)
								}

								// Update content blocks after processing native tool calls
								const prevLength = this.assistantMessageContent.length
								this.assistantMessageContent = this.assistantMessageParser.getContentBlocks()

								if (this.assistantMessageContent.length > prevLength) {
									// New content we need to present
									this.userMessageContentReady = false
								}

								// Present content to user
								presentAssistantMessage(this)
								break
							}
							case "ant_thinking":
								antThinkingContent.push({
									type: "thinking",
									thinking: chunk.thinking,
									signature: chunk.signature,
								})
								break
							case "ant_redacted_thinking":
								antThinkingContent.push({
									type: "redacted_thinking",
									data: chunk.data,
								})
								break
							// kilocode_change end
							case "text": {
								assistantMessage += chunk.text

								// Parse raw assistant message chunk into content blocks.
								const prevLength = this.assistantMessageContent.length
								this.assistantMessageContent = this.assistantMessageParser.processChunk(chunk.text)

								if (this.assistantMessageContent.length > prevLength) {
									// New content we need to present, reset to
									// false in case previous content set this to true.
									this.userMessageContentReady = false
								}

								// Present content to user.
								presentAssistantMessage(this)
								break
							}
						}

						if (this.abort) {
							console.log(`aborting stream, this.abandoned = ${this.abandoned}`)

							if (!this.abandoned) {
								// Only need to gracefully abort if this instance
								// isn't abandoned (sometimes OpenRouter stream
								// hangs, in which case this would affect future
								// instances of Cline).
								await abortStream("user_cancelled")
							}

							break // Aborts the stream.
						}

						if (this.didRejectTool) {
							// `userContent` has a tool rejection, so interrupt the
							// assistant's response to present the user's feedback.
							assistantMessage += "\n\n[Response interrupted by user feedback]"
							// Instead of setting this preemptively, we allow the
							// present iterator to finish and set
							// userMessageContentReady when its ready.
							// this.userMessageContentReady = true
							break
						}

						if (this.didAlreadyUseTool) {
							assistantMessage +=
								"\n\n[Response interrupted by a tool use result. Only one tool may be used at a time and should be placed at the end of the message.]"
							break
						}
					}

					// Create a copy of current token values to avoid race conditions
					const currentTokens = {
						input: inputTokens,
						output: outputTokens,
						cacheWrite: cacheWriteTokens,
						cacheRead: cacheReadTokens,
						total: totalCost,
					}

					const drainStreamInBackgroundToFindAllUsage = async (apiReqIndex: number) => {
						const timeoutMs = DEFAULT_USAGE_COLLECTION_TIMEOUT_MS
						const startTime = performance.now()
						const modelId = getModelId(this.apiConfiguration)

						// Local variables to accumulate usage data without affecting the main flow
						let bgInputTokens = currentTokens.input
						let bgOutputTokens = currentTokens.output
						let bgCacheWriteTokens = currentTokens.cacheWrite
						let bgCacheReadTokens = currentTokens.cacheRead
						let bgTotalCost = currentTokens.total

						// kilocode_change start
						const refreshApiReqMsg = async (messageIndex: number) => {
							// Update the API request message with the latest usage data
							updateApiReqMsg()
							await this.saveClineMessages()

							// Update the specific message in the webview
							const apiReqMessage = this.clineMessages[messageIndex]
							if (apiReqMessage) {
								await this.updateClineMessage(apiReqMessage)
							}
						}
						// kilocode_change end

						// Helper function to capture telemetry and update messages
						const captureUsageData = async (
							tokens: {
								input: number
								output: number
								cacheWrite: number
								cacheRead: number
								total?: number
							},
							messageIndex: number = apiReqIndex,
						) => {
							if (
								tokens.input > 0 ||
								tokens.output > 0 ||
								tokens.cacheWrite > 0 ||
								tokens.cacheRead > 0
							) {
								// Update the shared variables atomically
								inputTokens = tokens.input
								outputTokens = tokens.output
								cacheWriteTokens = tokens.cacheWrite
								cacheReadTokens = tokens.cacheRead
								totalCost = tokens.total

								// Update the API request message with the latest usage data
								updateApiReqMsg()
								await this.saveClineMessages()

								// Update the specific message in the webview
								const apiReqMessage = this.clineMessages[messageIndex]
								if (apiReqMessage) {
									await this.updateClineMessage(apiReqMessage)
								}

								// Capture telemetry with provider-aware cost calculation
								const modelId = getModelId(this.apiConfiguration)
								const apiProtocol = getApiProtocol(this.apiConfiguration.apiProvider, modelId)

								// Use the appropriate cost function based on the API protocol
								const costResult =
									apiProtocol === "anthropic"
										? calculateApiCostAnthropic(
												this.api.getModel().info,
												tokens.input,
												tokens.output,
												tokens.cacheWrite,
												tokens.cacheRead,
											)
										: calculateApiCostOpenAI(
												this.api.getModel().info,
												tokens.input,
												tokens.output,
												tokens.cacheWrite,
												tokens.cacheRead,
											)

								TelemetryService.instance.captureLlmCompletion(this.taskId, {
									inputTokens: costResult.totalInputTokens,
									outputTokens: costResult.totalOutputTokens,
									cacheWriteTokens: tokens.cacheWrite,
									cacheReadTokens: tokens.cacheRead,
									cost: tokens.total ?? costResult.totalCost,
									// kilocode_change start
									completionTime: performance.now() - apiRequestStartTime,
									inferenceProvider,
									// kilocode_change end
								})
							}
						}

						try {
							// Continue processing the original stream from where the main loop left off
							let usageFound = false
							let chunkCount = 0

							// Use the same iterator that the main loop was using
							while (!item.done) {
								// Check for timeout
								if (performance.now() - startTime > timeoutMs) {
									console.warn(
										`[Background Usage Collection] Timed out after ${timeoutMs}ms for model: ${modelId}, processed ${chunkCount} chunks`,
									)
									// Clean up the iterator before breaking
									if (iterator.return) {
										await iterator.return(undefined)
									}
									break
								}

								const chunk = item.value
								item = await iterator.next()
								chunkCount++

								if (chunk && chunk.type === "usage") {
									usageFound = true
									bgInputTokens += chunk.inputTokens
									bgOutputTokens += chunk.outputTokens
									bgCacheWriteTokens += chunk.cacheWriteTokens ?? 0
									bgCacheReadTokens += chunk.cacheReadTokens ?? 0
									bgTotalCost = chunk.totalCost
									inferenceProvider = chunk.inferenceProvider // kilocode_change
								}
							}

							if (
								usageFound ||
								bgInputTokens > 0 ||
								bgOutputTokens > 0 ||
								bgCacheWriteTokens > 0 ||
								bgCacheReadTokens > 0
							) {
								// We have usage data either from a usage chunk or accumulated tokens
								await captureUsageData(
									{
										input: bgInputTokens,
										output: bgOutputTokens,
										cacheWrite: bgCacheWriteTokens,
										cacheRead: bgCacheReadTokens,
										total: bgTotalCost,
									},
									lastApiReqIndex,
								)
							} else {
								console.warn(
									`[Background Usage Collection] Suspicious: request ${apiReqIndex} is complete, but no usage info was found. Model: ${modelId}`,
								)
								// kilocode_change start
								usageMissing = true
								await refreshApiReqMsg(apiReqIndex)
								// kilocode_change end
							}
						} catch (error) {
							console.error("Error draining stream for usage data:", error)
							// Still try to capture whatever usage data we have collected so far
							if (
								bgInputTokens > 0 ||
								bgOutputTokens > 0 ||
								bgCacheWriteTokens > 0 ||
								bgCacheReadTokens > 0
							) {
								await captureUsageData(
									{
										input: bgInputTokens,
										output: bgOutputTokens,
										cacheWrite: bgCacheWriteTokens,
										cacheRead: bgCacheReadTokens,
										total: bgTotalCost,
									},
									lastApiReqIndex,
								)
								// kilocode_change start
							} else {
								usageMissing = true
								await refreshApiReqMsg(apiReqIndex)
								// kilocode_change end
							}
						}
					}

					// Start the background task and handle any errors
					drainStreamInBackgroundToFindAllUsage(lastApiReqIndex).catch((error) => {
						console.error("Background usage collection failed:", error)
					})
				} catch (error) {
					// Abandoned happens when extension is no longer waiting for the
					// Cline instance to finish aborting (error is thrown here when
					// any function in the for loop throws due to this.abort).
					if (!this.abandoned) {
						// Determine cancellation reason
						const cancelReason: ClineApiReqCancelReason = this.abort ? "user_cancelled" : "streaming_failed"

						const streamingFailedMessage = this.abort
							? undefined
							: (error.message ?? JSON.stringify(serializeError(error), null, 2))

						// Clean up partial state
						await abortStream(cancelReason, streamingFailedMessage)

						if (this.abort) {
							// User cancelled - abort the entire task
							this.abortReason = cancelReason
							await this.abortTask()
						} else {
							// Stream failed - log the error and retry with the same content
							// The existing rate limiting will prevent rapid retries
							console.error(
								`[Task#${this.taskId}.${this.instanceId}] Stream failed, will retry: ${streamingFailedMessage}`,
							)

							// Apply exponential backoff similar to first-chunk errors when auto-resubmit is enabled
							const stateForBackoff = await this.providerRef.deref()?.getState()
							if (stateForBackoff?.autoApprovalEnabled && stateForBackoff?.alwaysApproveResubmit) {
								await this.backoffAndAnnounce(
									currentItem.retryAttempt ?? 0,
									error,
									streamingFailedMessage,
								)

								// Check if task was aborted during the backoff
								if (this.abort) {
									console.log(
										`[Task#${this.taskId}.${this.instanceId}] Task aborted during mid-stream retry backoff`,
									)
									// Abort the entire task
									this.abortReason = "user_cancelled"
									await this.abortTask()
									break
								}
							}

							// Push the same content back onto the stack to retry, incrementing the retry attempt counter
							stack.push({
								userContent: currentUserContent,
								includeFileDetails: false,
								retryAttempt: (currentItem.retryAttempt ?? 0) + 1,
							})

							// Continue to retry the request
							continue
						}
					}
				} finally {
					this.isStreaming = false
				}

				// Need to call here in case the stream was aborted.
				if (this.abort || this.abandoned) {
					throw new Error(
						`[KiloCode#recursivelyMakeClineRequests] task ${this.taskId}.${this.instanceId} aborted`,
					)
				}

				this.didCompleteReadingStream = true

				// Set any blocks to be complete to allow `presentAssistantMessage`
				// to finish and set `userMessageContentReady` to true.
				// (Could be a text block that had no subsequent tool uses, or a
				// text block at the very end, or an invalid tool use, etc. Whatever
				// the case, `presentAssistantMessage` relies on these blocks either
				// to be completed or the user to reject a block in order to proceed
				// and eventually set userMessageContentReady to true.)
				const partialBlocks = this.assistantMessageContent.filter((block) => block.partial)
				partialBlocks.forEach((block) => (block.partial = false))

				// Can't just do this b/c a tool could be in the middle of executing.
				// this.assistantMessageContent.forEach((e) => (e.partial = false))

				// Now that the stream is complete, finalize any remaining partial content blocks
				this.assistantMessageParser.finalizeContentBlocks()
				this.assistantMessageContent = this.assistantMessageParser.getContentBlocks()

				if (partialBlocks.length > 0) {
					// If there is content to update then it will complete and
					// update `this.userMessageContentReady` to true, which we
					// `pWaitFor` before making the next request. All this is really
					// doing is presenting the last partial message that we just set
					// to complete.
					presentAssistantMessage(this)
				}

				// Note: updateApiReqMsg() is now called from within drainStreamInBackgroundToFindAllUsage
				// to ensure usage data is captured even when the stream is interrupted. The background task
				// uses local variables to accumulate usage data before atomically updating the shared state.

				// Complete the reasoning message if it exists
				// We can't use say() here because the reasoning message may not be the last message
				// (other messages like text blocks or tool uses may have been added after it during streaming)
				if (reasoningMessage) {
					const lastReasoningIndex = findLastIndex(
						this.clineMessages,
						(m) => m.type === "say" && m.say === "reasoning",
					)

					if (lastReasoningIndex !== -1 && this.clineMessages[lastReasoningIndex].partial) {
						this.clineMessages[lastReasoningIndex].partial = false
						await this.updateClineMessage(this.clineMessages[lastReasoningIndex])
					}
				}

				await this.persistGpt5Metadata()
				await this.saveClineMessages()
				await this.providerRef.deref()?.postStateToWebview()

				// Reset parser after each complete conversation round
				this.assistantMessageParser.reset()

				// Now add to apiConversationHistory.
				// Need to save assistant responses to file before proceeding to
				// tool use since user can exit at any moment and we wouldn't be
				// able to save the assistant's response.
				let didEndLoop = false

				if (assistantMessage.length > 0 || assistantToolUses.length > 0 /* kilocode_change */) {
					// Display grounding sources to the user if they exist
					if (pendingGroundingSources.length > 0) {
						const citationLinks = pendingGroundingSources.map((source, i) => `[${i + 1}](${source.url})`)
						const sourcesText = `${t("common:gemini.sources")} ${citationLinks.join(", ")}`

						await this.say("text", sourcesText, undefined, false, undefined, undefined, {
							isNonInteractive: true,
						})
					}

					// Check if we should preserve reasoning in the assistant message
					let finalAssistantMessage = assistantMessage
					// kilocode_change start: also add tool calls, reasoning_details to history
					const assistantMessageContent = new Array<Anthropic.Messages.ContentBlockParam>()
					assistantMessageContent.push(...antThinkingContent)
					if (finalAssistantMessage || reasoningDetails.length > 0) {
						assistantMessageContent.push({
							type: "text",
							text: finalAssistantMessage,
							// @ts-ignore-next-line OpenRouter-specific property
							reasoning_details: reasoningDetails.length > 0 ? reasoningDetails : undefined,
						})
					}
					assistantMessageContent.push(...assistantToolUses)
					await this.addToApiConversationHistory({
						role: "assistant",
						content: assistantMessageContent,
					})
					// kilocode_change end

					TelemetryService.instance.captureConversationMessage(this.taskId, "assistant")

					// NOTE: This comment is here for future reference - this was a
					// workaround for `userMessageContent` not getting set to true.
					// It was due to it not recursively calling for partial blocks
					// when `didRejectTool`, so it would get stuck waiting for a
					// partial block to complete before it could continue.
					// In case the content blocks finished it may be the api stream
					// finished after the last parsed content block was executed, so
					// we are able to detect out of bounds and set
					// `userMessageContentReady` to true (note you should not call
					// `presentAssistantMessage` since if the last block i
					//  completed it will be presented again).
					// const completeBlocks = this.assistantMessageContent.filter((block) => !block.partial) // If there are any partial blocks after the stream ended we can consider them invalid.
					// if (this.currentStreamingContentIndex >= completeBlocks.length) {
					// 	this.userMessageContentReady = true
					// }

					await pWaitFor(() => this.userMessageContentReady)

					// If the model did not tool use, then we need to tell it to
					// either use a tool or attempt_completion.
					const didToolUse = this.assistantMessageContent.some((block) => block.type === "tool_use")

					if (!didToolUse) {
						this.userMessageContent.push({
							type: "text",
							text: formatResponse.noToolsUsed(
								getActiveToolUseStyle(this.apiConfiguration), // kilocode_change
							),
						})
						this.consecutiveMistakeCount++
					}

					if (this.userMessageContent.length > 0) {
						stack.push({
							userContent: [...this.userMessageContent], // Create a copy to avoid mutation issues
							includeFileDetails: false, // Subsequent iterations don't need file details
						})

						// Add periodic yielding to prevent blocking
						await new Promise((resolve) => setImmediate(resolve))
					}
					// Continue to next iteration instead of setting didEndLoop from recursive call
					continue
				} else {
					// If there's no assistant_responses, that means we got no text
					// or tool_use content blocks from API which we should assume is
					// an error.
					await this.say(
						"error",
						t("kilocode:task.noAssistantMessages"), // kilocode_change
					)

					// kilocode_change start
					TelemetryService.instance.captureEvent(TelemetryEventName.NO_ASSISTANT_MESSAGES)
					// kilocode_change end

					await this.addToApiConversationHistory({
						role: "assistant",
						content: [{ type: "text", text: "Failure: I did not provide a response." }],
					})
				}

				// If we reach here without continuing, return false (will always be false for now)
				return false
			} catch (error) {
				// This should never happen since the only thing that can throw an
				// error is the attemptApiRequest, which is wrapped in a try catch
				// that sends an ask where if noButtonClicked, will clear current
				// task and destroy this instance. However to avoid unhandled
				// promise rejection, we will end this loop which will end execution
				// of this instance (see `startTask`).
				return true // Needs to be true so parent loop knows to end task.
			}
		}

		// If we exit the while loop normally (stack is empty), return false
		return false
	}

	// kilocode_change start
	async loadContext(
		userContent: UserContent,
		includeFileDetails: boolean = false,
	): Promise<[UserContent, string, boolean]> {
		// Track if we need to check clinerulesFile
		let needsClinerulesFileCheck = false

		// bookmark
		const { localWorkflowToggles, globalWorkflowToggles } = await refreshWorkflowToggles(
			this.getContext(),
			this.cwd,
		)

		const processUserContent = async () => {
			// This is a temporary solution to dynamically load context mentions from tool results. It checks for the presence of tags that indicate that the tool was rejected and feedback was provided (see formatToolDeniedFeedback, attemptCompletion, executeCommand, and consecutiveMistakeCount >= 3) or "<answer>" (see askFollowupQuestion), we place all user generated content in these tags so they can effectively be used as markers for when we should parse mentions). However if we allow multiple tools responses in the future, we will need to parse mentions specifically within the user content tags.
			// (Note: this caused the @/ import alias bug where file contents were being parsed as well, since v2 converted tool results to text blocks)
			return await Promise.all(
				userContent.map(async (block) => {
					if (block.type === "text") {
						// We need to ensure any user generated content is wrapped in one of these tags so that we know to parse mentions
						// FIXME: Only parse text in between these tags instead of the entire text block which may contain other tool results. This is part of a larger issue where we shouldn't be using regex to parse mentions in the first place (ie for cases where file paths have spaces)
						if (
							block.text.includes("<feedback>") ||
							block.text.includes("<answer>") ||
							block.text.includes("<task>") ||
							block.text.includes("<user_message>")
						) {
							const parsedText = await parseMentions(
								block.text,
								this.cwd,
								this.urlContentFetcher,
								this.fileContextTracker,
							)

							// when parsing slash commands, we still want to allow the user to provide their desired context
							const { processedText, needsRulesFileCheck: needsCheck } = await parseKiloSlashCommands(
								parsedText,
								localWorkflowToggles,
								globalWorkflowToggles,
							)

							if (needsCheck) {
								needsClinerulesFileCheck = true
							}

							return {
								...block,
								text: processedText,
							}
						}
					}
					return block
				}),
			)
		}

		// Run initial promises in parallel
		const [processedUserContent, environmentDetails] = await Promise.all([
			processUserContent(),
			getEnvironmentDetails(this, includeFileDetails),
		])
		// const [parsedUserContent, environmentDetails, clinerulesError] = await this.loadContext(
		// 	userContent,
		// 	includeFileDetails,
		// )

		// After processing content, check clinerulesData if needed
		let clinerulesError = false
		if (needsClinerulesFileCheck) {
			clinerulesError = await ensureLocalKilorulesDirExists(this.cwd, GlobalFileNames.kiloRules)
		}

		// Return all results
		return [processedUserContent, environmentDetails, clinerulesError]
	}
	// kilocode_change end

	/*private kilocode_change*/ async getSystemPrompt(): Promise<string> {
		const { mcpEnabled } = (await this.providerRef.deref()?.getState()) ?? {}
		let mcpHub: McpHub | undefined
		if (mcpEnabled ?? true) {
			const provider = this.providerRef.deref()

			if (!provider) {
				throw new Error("Provider reference lost during view transition")
			}

			// Wait for MCP hub initialization through McpServerManager
			mcpHub = await McpServerManager.getInstance(provider.context, provider)

			if (!mcpHub) {
				throw new Error("Failed to get MCP hub from server manager")
			}

			// Wait for MCP servers to be connected before generating system prompt
			await pWaitFor(() => !mcpHub!.isConnecting, { timeout: 10_000 }).catch(() => {
				console.error("MCP servers failed to connect in time")
			})
		}

		const rooIgnoreInstructions = this.rooIgnoreController?.getInstructions()

		const state = await this.providerRef.deref()?.getState()

		const {
			browserViewportSize,
			mode,
			customModes,
			customModePrompts,
			customInstructions,
			experiments,
			enableMcpServerCreation,
			browserToolEnabled,
			language,
			maxConcurrentFileReads,
			maxReadFileLine,
			apiConfiguration,
		} = state ?? {}

		return await (async () => {
			const provider = this.providerRef.deref()

			if (!provider) {
				throw new Error("Provider not available")
			}

			// Align browser tool enablement with generateSystemPrompt: require model image support,
			// mode to include the browser group, and the user setting to be enabled.
			const modeConfig = getModeBySlug(mode ?? defaultModeSlug, customModes)
			const modeSupportsBrowser = modeConfig?.groups.some((group) => getGroupName(group) === "browser") ?? false

			// Check if model supports browser capability (images)
			const modelInfo = this.api.getModel().info
			const modelSupportsBrowser = (modelInfo as any)?.supportsImages === true

			const canUseBrowserTool = modelSupportsBrowser && modeSupportsBrowser && (browserToolEnabled ?? true)

			return SYSTEM_PROMPT(
				provider.context,
				this.cwd,
				canUseBrowserTool,
				mcpHub,
				this.diffStrategy,
				browserViewportSize ?? "900x600",
				mode ?? defaultModeSlug,
				customModePrompts,
				customModes,
				customInstructions,
				this.diffEnabled,
				experiments,
				enableMcpServerCreation,
				language,
				rooIgnoreInstructions,
				maxReadFileLine !== -1,
				{
					maxConcurrentFileReads: maxConcurrentFileReads ?? 5,
					todoListEnabled: apiConfiguration?.todoListEnabled ?? true,
					useAgentRules: vscode.workspace.getConfiguration("kilo-code").get<boolean>("useAgentRules") ?? true,
					newTaskRequireTodos: vscode.workspace
						.getConfiguration("kilo-code")
						.get<boolean>("newTaskRequireTodos", false),
				},
				undefined, // todoList
				this.api.getModel().id,
				// kilocode_change start
				getActiveToolUseStyle(apiConfiguration),
				state,
				// kilocode_change end
			)
		})()
	}

	private getCurrentProfileId(state: any): string {
		return (
			state?.listApiConfigMeta?.find((profile: any) => profile.name === state?.currentApiConfigName)?.id ??
			"default"
		)
	}

	private async handleContextWindowExceededError(): Promise<void> {
		const state = await this.providerRef.deref()?.getState()
		const { profileThresholds = {} } = state ?? {}

		const { contextTokens } = this.getTokenUsage()
		// kilocode_change start: Initialize virtual quota fallback handler
		if (this.api instanceof VirtualQuotaFallbackHandler) {
			await this.api.initialize()
		}
		// kilocode_change end
		const modelInfo = this.api.getModel().info

		const maxTokens = getModelMaxOutputTokens({
			modelId: this.api.getModel().id,
			model: modelInfo,
			settings: this.apiConfiguration,
		})

		const contextWindow = this.api.contextWindow ?? modelInfo.contextWindow // kilocode_change: Use contextWindow from API handler if available

		// Get the current profile ID using the helper method
		const currentProfileId = this.getCurrentProfileId(state)

		// Log the context window error for debugging
		console.warn(
			`[Task#${this.taskId}] Context window exceeded for model ${this.api.getModel().id}. ` +
				`Current tokens: ${contextTokens}, Context window: ${contextWindow}. ` +
				`Forcing truncation to ${FORCED_CONTEXT_REDUCTION_PERCENT}% of current context.`,
		)

		// Force aggressive truncation by keeping only 75% of the conversation history
		const truncateResult = await truncateConversationIfNeeded({
			messages: this.apiConversationHistory,
			totalTokens: contextTokens || 0,
			maxTokens,
			contextWindow,
			apiHandler: this.api,
			autoCondenseContext: true,
			autoCondenseContextPercent: FORCED_CONTEXT_REDUCTION_PERCENT,
			systemPrompt: await this.getSystemPrompt(),
			taskId: this.taskId,
			profileThresholds,
			currentProfileId,
		})

		if (truncateResult.messages !== this.apiConversationHistory) {
			await this.overwriteApiConversationHistory(truncateResult.messages)
		}

		if (truncateResult.summary) {
			const { summary, cost, prevContextTokens, newContextTokens = 0 } = truncateResult
			const contextCondense: ContextCondense = { summary, cost, newContextTokens, prevContextTokens }
			await this.say(
				"condense_context",
				undefined /* text */,
				undefined /* images */,
				false /* partial */,
				undefined /* checkpoint */,
				undefined /* progressStatus */,
				{ isNonInteractive: true } /* options */,
				contextCondense,
			)
		}
	}

	public async *attemptApiRequest(retryAttempt: number = 0): ApiStream {
		const state = await this.providerRef.deref()?.getState()

		const {
			apiConfiguration,
			autoApprovalEnabled,
			alwaysApproveResubmit,
			requestDelaySeconds,
			mode,
			autoCondenseContext = true,
			autoCondenseContextPercent = 100,
			profileThresholds = {},
		} = state ?? {}

		// Get condensing configuration for automatic triggers.
		const customCondensingPrompt = state?.customCondensingPrompt
		const condensingApiConfigId = state?.condensingApiConfigId
		const listApiConfigMeta = state?.listApiConfigMeta

		// Determine API handler to use for condensing.
		let condensingApiHandler: ApiHandler | undefined

		if (condensingApiConfigId && listApiConfigMeta && Array.isArray(listApiConfigMeta)) {
			// Find matching config by ID
			const matchingConfig = listApiConfigMeta.find((config) => config.id === condensingApiConfigId)

			if (matchingConfig) {
				const profile = await this.providerRef.deref()?.providerSettingsManager.getProfile({
					id: condensingApiConfigId,
				})

				// Ensure profile and apiProvider exist before trying to build handler.
				if (profile && profile.apiProvider) {
					condensingApiHandler = buildApiHandler(profile)
				}
			}
		}

		let rateLimitDelay = 0

		// Use the shared timestamp so that subtasks respect the same rate-limit
		// window as their parent tasks.
		if (Task.lastGlobalApiRequestTime) {
			const now = performance.now()
			const timeSinceLastRequest = now - Task.lastGlobalApiRequestTime
			const rateLimit = apiConfiguration?.rateLimitSeconds || 0
			rateLimitDelay = Math.ceil(Math.min(rateLimit, Math.max(0, rateLimit * 1000 - timeSinceLastRequest) / 1000))
		}

		// Only show rate limiting message if we're not retrying. If retrying, we'll include the delay there.
		if (rateLimitDelay > 0 && retryAttempt === 0) {
			// Show countdown timer
			for (let i = rateLimitDelay; i > 0; i--) {
				const delayMessage = `Rate limiting for ${i} seconds...`
				await this.say("api_req_retry_delayed", delayMessage, undefined, true)
				await delay(1000)
			}
		}

		// Update last request time before making the request so that subsequent
		// requests — even from new subtasks — will honour the provider's rate-limit.
		Task.lastGlobalApiRequestTime = performance.now()

		const systemPrompt = await this.getSystemPrompt()
		this.lastUsedInstructions = systemPrompt
		const { contextTokens } = this.getTokenUsage()

		if (contextTokens) {
			// kilocode_change start: Initialize and adjust virtual quota fallback handler
			if (this.api instanceof VirtualQuotaFallbackHandler) {
				await this.api.initialize()
				await this.api.adjustActiveHandler("Pre-Request Adjustment")
			}
			// kilocode_change end
			const modelInfo = this.api.getModel().info

			const maxTokens = getModelMaxOutputTokens({
				modelId: this.api.getModel().id,
				model: modelInfo,
				settings: this.apiConfiguration,
			})

			const contextWindow = this.api.contextWindow ?? modelInfo.contextWindow // kilocode_change

			// Get the current profile ID using the helper method
			const currentProfileId = this.getCurrentProfileId(state)

			const truncateResult = await truncateConversationIfNeeded({
				messages: this.apiConversationHistory,
				totalTokens: contextTokens,
				maxTokens,
				contextWindow,
				apiHandler: this.api,
				autoCondenseContext,
				autoCondenseContextPercent,
				systemPrompt,
				taskId: this.taskId,
				customCondensingPrompt,
				condensingApiHandler,
				profileThresholds,
				currentProfileId,
			})
			if (truncateResult.messages !== this.apiConversationHistory) {
				await this.overwriteApiConversationHistory(truncateResult.messages)
			}
			if (truncateResult.error) {
				await this.say("condense_context_error", truncateResult.error)
			} else if (truncateResult.summary) {
				// A condense operation occurred; for the next GPT‑5 API call we should NOT
				// send previous_response_id so the request reflects the fresh condensed context.
				this.skipPrevResponseIdOnce = true

				const { summary, cost, prevContextTokens, newContextTokens = 0 } = truncateResult
				const contextCondense: ContextCondense = { summary, cost, newContextTokens, prevContextTokens }
				await this.say(
					"condense_context",
					undefined /* text */,
					undefined /* images */,
					false /* partial */,
					undefined /* checkpoint */,
					undefined /* progressStatus */,
					{ isNonInteractive: true } /* options */,
					contextCondense,
				)
			}
		}

		const messagesSinceLastSummary = getMessagesSinceLastSummary(this.apiConversationHistory)
		let cleanConversationHistory = maybeRemoveReasoningDetails_kilocode(
			maybeRemoveImageBlocks(messagesSinceLastSummary, this.api).map(({ role, content }) => ({ role, content })),
			apiConfiguration?.apiProvider,
		)

		// kilocode_change start
		// Fetch project properties for KiloCode provider tracking
		const kiloConfig = this.providerRef.deref()?.getKiloConfig()
		// kilocode_change end

		// Check auto-approval limits
		const approvalResult = await this.autoApprovalHandler.checkAutoApprovalLimits(
			state,
			this.combineMessages(this.clineMessages.slice(1)),
			async (type, data) => this.ask(type, data),
		)

		if (!approvalResult.shouldProceed) {
			// User did not approve, task should be aborted
			throw new Error("Auto-approval limit reached and user did not approve continuation")
		}

		// Determine GPT‑5 previous_response_id from last persisted assistant turn (if available),
		// unless a condense just occurred (skip once after condense).
		let previousResponseId: string | undefined = undefined
		try {
			const modelId = this.api.getModel().id
			if (modelId && modelId.startsWith("gpt-5") && !this.skipPrevResponseIdOnce) {
				// Find the last assistant message that has a previous_response_id stored
				const idx = findLastIndex(
					this.clineMessages,
					(m): m is ClineMessage & ClineMessageWithMetadata =>
						m.type === "say" &&
						m.say === "text" &&
						!!(m as ClineMessageWithMetadata).metadata?.gpt5?.previous_response_id,
				)
				if (idx !== -1) {
					// Use the previous_response_id from the last assistant message for this request
					const message = this.clineMessages[idx] as ClineMessage & ClineMessageWithMetadata
					previousResponseId = message.metadata?.gpt5?.previous_response_id
				}
			} else if (this.skipPrevResponseIdOnce) {
				// Skipping previous_response_id due to recent condense operation - will send full conversation context
			}
		} catch (error) {
			console.error(`[Task#${this.taskId}] Error retrieving GPT-5 response ID:`, error)
			// non-fatal
		}

		const metadata: ApiHandlerCreateMessageMetadata = {
			mode: mode,
			taskId: this.taskId,
			// Only include previousResponseId if we're NOT suppressing it
			...(previousResponseId && !this.skipPrevResponseIdOnce ? { previousResponseId } : {}),
			// If a condense just occurred, explicitly suppress continuity fallback for the next call
			...(this.skipPrevResponseIdOnce ? { suppressPreviousResponseId: true } : {}),
			// kilocode_change start
			// KiloCode-specific: pass projectId for backend tracking (ignored by other providers)
			projectId: (await kiloConfig)?.project?.id,
			// kilocode_change end
		}

		// kilocode_change start
		// Add allowed tools for JSON tool style
		if (getActiveToolUseStyle(apiConfiguration) === "json" && mode) {
			try {
				const provider = this.providerRef.deref()
				metadata.allowedTools = await getAllowedJSONToolsForMode(
					mode,
					provider,
					this.diffEnabled,
					this.api?.getModel(),
				)
			} catch (error) {
				console.error("[Task] Error getting allowed tools for mode:", error)
				// Continue without allowedTools - will fall back to default behavior
			}
		}
		// kilocode_change end

		// Reset skip flag after applying (it only affects the immediate next call)
		if (this.skipPrevResponseIdOnce) {
			this.skipPrevResponseIdOnce = false
		}

		const stream = this.api.createMessage(systemPrompt, cleanConversationHistory, metadata)
		const iterator = stream[Symbol.asyncIterator]()

		try {
			// Awaiting first chunk to see if it will throw an error.
			this.isWaitingForFirstChunk = true
			const firstChunk = await iterator.next()
			yield firstChunk.value
			this.isWaitingForFirstChunk = false
		} catch (error) {
			this.isWaitingForFirstChunk = false
			// kilocode_change start
			if (apiConfiguration?.apiProvider === "kilocode" && isAnyRecognizedKiloCodeError(error)) {
				const { response } = await (isPaymentRequiredError(error)
					? this.ask(
							"payment_required_prompt",
							JSON.stringify({
								title: error.error?.title ?? t("kilocode:lowCreditWarning.title"),
								message: error.error?.message ?? t("kilocode:lowCreditWarning.message"),
								balance: error.error?.balance ?? "0.00",
								buyCreditsUrl: error.error?.buyCreditsUrl ?? getAppUrl("/profile"),
							}),
						)
					: this.ask(
							"invalid_model",
							JSON.stringify({
								modelId: apiConfiguration.kilocodeModel,
								error: {
									status: error.status,
									message: error.message,
								},
							}),
						))

				if (response === "retry_clicked") {
					yield* this.attemptApiRequest(retryAttempt + 1)
				} else {
					// Handle other responses or cancellations if necessary
					// If the user cancels the dialog, we should probably abort.
					throw error // Rethrow to signal failure upwards
				}
				return
			}
			// kilocode_change end
			// note that this api_req_failed ask is unique in that we only present this option if the api hasn't streamed any content yet (ie it fails on the first chunk due), as it would allow them to hit a retry button. However if the api failed mid-stream, it could be in any arbitrary state where some tools may have executed, so that error is handled differently and requires cancelling the task entirely.
			if (autoApprovalEnabled && alwaysApproveResubmit) {
				let errorMsg

				if (error.error?.metadata?.raw) {
					errorMsg = JSON.stringify(error.error.metadata.raw, null, 2)
				} else if (error.message) {
					errorMsg = error.message
				} else {
					errorMsg = "Unknown error"
				}

				// Apply shared exponential backoff and countdown UX
				await this.backoffAndAnnounce(retryAttempt, error, errorMsg)

				// CRITICAL: Check if task was aborted during the backoff countdown
				// This prevents infinite loops when users cancel during auto-retry
				// Without this check, the recursive call below would continue even after abort
				if (this.abort) {
					throw new Error(
						`[Task#attemptApiRequest] task ${this.taskId}.${this.instanceId} aborted during retry`,
					)
				}

				// Delegate generator output from the recursive call with
				// incremented retry count.
				yield* this.attemptApiRequest(retryAttempt + 1)

				return
			} else {
				const { response } = await this.ask(
					"api_req_failed",
					error.message ?? JSON.stringify(serializeError(error), null, 2),
				)

				if (response !== "yesButtonClicked") {
					// This will never happen since if noButtonClicked, we will
					// clear current task, aborting this instance.
					throw new Error("API request failed")
				}

				await this.say("api_req_retried")

				// Delegate generator output from the recursive call.
				yield* this.attemptApiRequest()
				return
			}
		}

		// No error, so we can continue to yield all remaining chunks.
		// (Needs to be placed outside of try/catch since it we want caller to
		// handle errors not with api_req_failed as that is reserved for first
		// chunk failures only.)
		// This delegates to another generator or iterable object. In this case,
		// it's saying "yield all remaining values from this iterator". This
		// effectively passes along all subsequent chunks from the original
		// stream.
		yield* iterator

		// kilocode_change start
		if (apiConfiguration?.rateLimitAfter) {
			Task.lastGlobalApiRequestTime = performance.now()
		}
		// kilocode_change end
	}

	// Shared exponential backoff for retries (first-chunk and mid-stream)
	private async backoffAndAnnounce(retryAttempt: number, error: any, header?: string): Promise<void> {
		try {
			const state = await this.providerRef.deref()?.getState()
			const baseDelay = state?.requestDelaySeconds || 5

			let exponentialDelay = Math.min(
				Math.ceil(baseDelay * Math.pow(2, retryAttempt)),
				MAX_EXPONENTIAL_BACKOFF_SECONDS,
			)

			// Respect provider rate limit window
			let rateLimitDelay = 0
			const rateLimit = state?.apiConfiguration?.rateLimitSeconds || 0
			if (Task.lastGlobalApiRequestTime && rateLimit > 0) {
				const elapsed = performance.now() - Task.lastGlobalApiRequestTime
				rateLimitDelay = Math.ceil(Math.min(rateLimit, Math.max(0, rateLimit * 1000 - elapsed) / 1000))
			}

			// Prefer RetryInfo on 429 if present
			if (error?.status === 429) {
				const retryInfo = error?.errorDetails?.find(
					(d: any) => d["@type"] === "type.googleapis.com/google.rpc.RetryInfo",
				)
				const match = retryInfo?.retryDelay?.match?.(/^(\d+)s$/)
				if (match) {
					exponentialDelay = Number(match[1]) + 1
				}
			}

			const finalDelay = Math.max(exponentialDelay, rateLimitDelay)
			if (finalDelay <= 0) return

			// Build header text; fall back to error message if none provided
			let headerText = header
			if (!headerText) {
				if (error?.error?.metadata?.raw) {
					headerText = JSON.stringify(error.error.metadata.raw, null, 2)
				} else if (error?.message) {
					headerText = error.message
				} else {
					headerText = "Unknown error"
				}
			}
			headerText = headerText ? `${headerText}\n\n` : ""

			// Show countdown timer with exponential backoff
			for (let i = finalDelay; i > 0; i--) {
				// Check abort flag during countdown to allow early exit
				if (this.abort) {
					throw new Error(`[Task#${this.taskId}] Aborted during retry countdown`)
				}

				await this.say(
					"api_req_retry_delayed",
					`${headerText}Retry attempt ${retryAttempt + 1}\nRetrying in ${i} seconds...`,
					undefined,
					true,
				)
				await delay(1000)
			}

			await this.say(
				"api_req_retry_delayed",
				`${headerText}Retry attempt ${retryAttempt + 1}\nRetrying now...`,
				undefined,
				false,
			)
		} catch (err) {
			console.error("Exponential backoff failed:", err)
		}
	}

	// Checkpoints

	public async checkpointSave(force: boolean = false, suppressMessage: boolean = false) {
		return checkpointSave(this, force, suppressMessage)
	}

	public async checkpointRestore(options: CheckpointRestoreOptions) {
		return checkpointRestore(this, options)
	}

	public async checkpointDiff(options: CheckpointDiffOptions) {
		return checkpointDiff(this, options)
	}

	// Metrics

	public combineMessages(messages: ClineMessage[]) {
		return combineApiRequests(combineCommandSequences(messages))
	}

	public getTokenUsage(): TokenUsage {
		return getApiMetrics(this.combineMessages(this.clineMessages.slice(1)))
	}

	public recordToolUsage(toolName: ToolName) {
		if (!this.toolUsage[toolName]) {
			this.toolUsage[toolName] = { attempts: 0, failures: 0 }
		}

		this.toolUsage[toolName].attempts++
	}

	public recordToolError(toolName: ToolName, error?: string) {
		if (!this.toolUsage[toolName]) {
			this.toolUsage[toolName] = { attempts: 0, failures: 0 }
		}

		this.toolUsage[toolName].failures++

		if (error) {
			this.emit(RooCodeEventName.TaskToolFailed, this.taskId, toolName, error)
		}
		TelemetryService.instance.captureEvent(TelemetryEventName.TOOL_ERROR, { toolName, error }) // kilocode_change
	}

	/**
	 * Persist GPT-5 per-turn metadata (previous_response_id only)
	 * onto the last complete assistant say("text") message.
	 *
	 * Note: We do not persist system instructions or reasoning summaries.
	 */
	private async persistGpt5Metadata(): Promise<void> {
		try {
			const modelId = this.api.getModel().id
			if (!modelId || !modelId.startsWith("gpt-5")) return

			// Check if the API handler has a getLastResponseId method (OpenAiNativeHandler specific)
			const handler = this.api as ApiHandler & { getLastResponseId?: () => string | undefined }
			const lastResponseId = handler.getLastResponseId?.()
			const idx = findLastIndex(
				this.clineMessages,
				(m) => m.type === "say" && m.say === "text" && m.partial !== true,
			)
			if (idx !== -1) {
				const msg = this.clineMessages[idx] as ClineMessage & ClineMessageWithMetadata
				if (!msg.metadata) {
					msg.metadata = {}
				}
				const gpt5Metadata: Gpt5Metadata = {
					...(msg.metadata.gpt5 ?? {}),
					...(lastResponseId ? { previous_response_id: lastResponseId } : {}),
				}
				msg.metadata.gpt5 = gpt5Metadata
			}
		} catch (error) {
			console.error(`[Task#${this.taskId}] Error persisting GPT-5 metadata:`, error)
			// Non-fatal error in metadata persistence
		}
	}

	// Getters

	public get taskStatus(): TaskStatus {
		if (this.interactiveAsk) {
			return TaskStatus.Interactive
		}

		if (this.resumableAsk) {
			return TaskStatus.Resumable
		}

		if (this.idleAsk) {
			return TaskStatus.Idle
		}

		return TaskStatus.Running
	}

	public get taskAsk(): ClineMessage | undefined {
		return this.idleAsk || this.resumableAsk || this.interactiveAsk
	}

	public get queuedMessages(): QueuedMessage[] {
		return this.messageQueueService.messages
	}

	public get tokenUsage(): TokenUsage | undefined {
		if (this.tokenUsageSnapshot && this.tokenUsageSnapshotAt) {
			return this.tokenUsageSnapshot
		}

		this.tokenUsageSnapshot = this.getTokenUsage()
		this.tokenUsageSnapshotAt = this.clineMessages.at(-1)?.ts

		return this.tokenUsageSnapshot
	}

	public get cwd() {
		return this.workspacePath
	}

	/**
	 * Process any queued messages by dequeuing and submitting them.
	 * This ensures that queued user messages are sent when appropriate,
	 * preventing them from getting stuck in the queue.
	 *
	 * @param context - Context string for logging (e.g., the calling tool name)
	 */
	public processQueuedMessages(): void {
		try {
			if (!this.messageQueueService.isEmpty()) {
				const queued = this.messageQueueService.dequeueMessage()
				if (queued) {
					setTimeout(() => {
						this.submitUserMessage(queued.text, queued.images).catch((err) =>
							console.error(`[Task] Failed to submit queued message:`, err),
						)
					}, 0)
				}
			}
		} catch (e) {
			console.error(`[Task] Queue processing error:`, e)
		}
	}
}
