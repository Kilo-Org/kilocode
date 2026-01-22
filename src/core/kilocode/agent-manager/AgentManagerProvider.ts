import * as vscode from "vscode"
import * as fs from "node:fs"
import * as path from "node:path"
import { t } from "i18next"
import { AgentRegistry } from "./AgentRegistry"
import { renameMapKey } from "./mapUtils"
import {
	buildParallelModeWorktreePath,
	parseParallelModeBranch,
	parseParallelModeWorktreePath,
	isParallelModeCompletionMessage,
	parseParallelModeCompletionBranch,
} from "./parallelModeParser"
import { WorktreeManager, WorktreeError } from "./WorktreeManager"
import { SetupScriptService } from "./SetupScriptService"
import { SetupScriptRunner } from "./SetupScriptRunner"
import { AgentTaskRunner, AgentTasks } from "./AgentTaskRunner"
import { RuntimeProcessHandler, type RuntimeProcessHandlerCallbacks } from "./RuntimeProcessHandler"
import type { StreamEvent, KilocodeStreamEvent, KilocodePayload, WelcomeStreamEvent } from "./CliOutputParser"
import { extractRawText, tryParsePayloadJson } from "./askErrorParser"
import { RemoteSessionService } from "./RemoteSessionService"
import { KilocodeEventProcessor } from "./KilocodeEventProcessor"
import type { RemoteSession, AgentSession } from "./types"
import { getUri } from "../../webview/getUri"
import { getNonce } from "../../webview/getNonce"
import { getViteDevServerConfig } from "../../webview/getViteDevServerConfig"
import { getRemoteUrl } from "../../../services/code-index/managed/git-utils"
import { normalizeGitUrl } from "./normalizeGitUrl"
import type { ClineMessage } from "@roo-code/types"
import { getModelId, type ProviderSettings } from "@roo-code/types"
import {
	captureAgentManagerOpened,
	captureAgentManagerSessionStarted,
	captureAgentManagerSessionCompleted,
	captureAgentManagerSessionStopped,
	captureAgentManagerSessionError,
	captureAgentManagerLoginIssue,
	getPlatformDiagnostics,
} from "./telemetry"
import type { ClineProvider } from "../../webview/ClineProvider"
import { extractSessionConfigs, MAX_VERSION_COUNT } from "./multiVersionUtils"
import { SessionManager } from "../../../shared/kilocode/cli-sessions/core/SessionManager"
import { WorkspaceGitService } from "./WorkspaceGitService"
import { SessionTerminalManager } from "./SessionTerminalManager"
import { startSessionMessageSchema, type StartSessionMessage } from "./types"
import { openImage } from "../../../integrations/misc/image-handler"
import { getModelsFromCache } from "../../../api/providers/fetchers/modelCache"
import { isRouterName, type ModelRecord } from "../../../shared/api"

/**
 * Message format for sending responses to the agent runtime via IPC.
 * Used for user messages, approval responses, and other interactions.
 */
interface StdinAskResponseMessage {
	type: "askResponse"
	askResponse: "messageResponse" | "yesButtonClicked" | "noButtonClicked"
	text: string
	images?: string[]
}

/**
 * AgentManagerProvider
 *
 * Manages the Agent Manager webview panel and orchestrates kilocode agents.
 * Each agent runs as a CLI process using `kilocode --auto --json`.
 */
export class AgentManagerProvider implements vscode.Disposable {
	public static readonly viewType = "kilo-code.AgentManagerPanel"

	private panel: vscode.WebviewPanel | undefined
	private disposables: vscode.Disposable[] = []
	private registry: AgentRegistry
	private remoteSessionService: RemoteSessionService
	private processHandler: RuntimeProcessHandler
	private eventProcessor: KilocodeEventProcessor
	private terminalManager: SessionTerminalManager
	private sessionMessages: Map<string, ClineMessage[]> = new Map()
	// Track first api_req_started per session to filter user-input echoes
	private firstApiReqStarted: Map<string, boolean> = new Map()
	// Track the current workspace's git URL for filtering sessions
	private currentGitUrl: string | undefined
	private lastAuthErrorMessage: string | undefined
	// Track process start times to filter out replayed history events
	private processStartTimes: Map<string, number> = new Map()
	// Track currently sending message per session (for one-at-a-time constraint)
	private sendingMessageMap: Map<string, string> = new Map()
	// Worktree manager for parallel mode sessions (lazy initialized)
	private worktreeManager: WorktreeManager | undefined
	// Setup script service for worktree initialization (lazy initialized)
	private setupScriptService: SetupScriptService | undefined
	// Cached available models from extension (fetched on panel open)
	private availableModels: { provider: string; currentModel: string; models: ModelRecord } | null = null
	// Flag to track if models are being fetched
	private fetchingModels: boolean = false

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly outputChannel: vscode.OutputChannel,
		private readonly provider: ClineProvider,
	) {
		this.registry = new AgentRegistry()
		this.remoteSessionService = new RemoteSessionService({ outputChannel })
		this.terminalManager = new SessionTerminalManager(this.registry, this.outputChannel)

		// Initialize currentGitUrl from workspace
		void this.initializeCurrentGitUrl()

		const callbacks: RuntimeProcessHandlerCallbacks = {
			onLog: (message) => this.outputChannel.appendLine(`[AgentManager] ${message}`),
			onSessionLog: (sessionId, line) => this.log(sessionId, line),
			onStateChanged: () => this.postStateToWebview(),
			onPendingSessionChanged: (pendingSession) => {
				this.postMessage({ type: "agentManager.pendingSession", pendingSession })
			},
			onStartSessionFailed: (error) => {
				this.postMessage({ type: "agentManager.startSessionFailed" })
				if (error?.type === "payment_required") {
					this.showPaymentRequiredPrompt(error.payload ?? { text: error.message })
					return
				}
				if (error?.type === "api_req_failed") {
					this.handleStartSessionApiFailure(error)
					return
				}
				this.showAgentError(error)
			},
			onChatMessages: (sessionId, messages) => {
				// Merge incoming messages with existing history (for resumed sessions)
				// Use timestamp as key to deduplicate and preserve order
				const existingMessages = this.sessionMessages.get(sessionId) || []
				const existingByTs = new Map(existingMessages.map((m) => [m.ts, m]))

				// Add incoming messages, updating existing ones by timestamp
				for (const msg of messages) {
					existingByTs.set(msg.ts, msg)
				}

				// Sort by timestamp and cache
				const mergedMessages = Array.from(existingByTs.values()).sort((a, b) => a.ts - b.ts)
				this.sessionMessages.set(sessionId, mergedMessages)
				this.postMessage({ type: "agentManager.chatMessages", sessionId, messages: mergedMessages })
			},
			onSessionCreated: (sawApiReqStarted: boolean, resumeInfo?: { prompt: string; images?: string[] }) => {
				// Initialize messages for the new session with the initial prompt
				const sessions = this.registry.getSessions()
				if (sessions.length > 0) {
					const latestSession = sessions[0]
					const existingMessages = this.sessionMessages.get(latestSession.sessionId) || []
					const isResumedSession = existingMessages.length > 0

					this.outputChannel.appendLine(
						`[AgentManager] onSessionCreated: sessionId=${latestSession.sessionId}, existingMessages=${existingMessages.length}, isResumed=${isResumedSession}, hasResumeInfo=${!!resumeInfo}`,
					)

					// For resumed sessions, preserve existing history
					// For new sessions, start with empty array - the agent will send user_feedback
					// Note: We no longer add the initial message here because the agent-runtime
					// extension now properly emits user_feedback for the initial prompt
					// (including for resumed sessions - resumeTaskFromHistory calls say("user_feedback"))
					const updatedMessages = isResumedSession ? [...existingMessages] : []

					this.sessionMessages.set(latestSession.sessionId, updatedMessages)

					// Post messages to webview (important for resumed sessions with history)
					this.postMessage({
						type: "agentManager.chatMessages",
						sessionId: latestSession.sessionId,
						messages: updatedMessages,
					})

					// Transfer api_req_started flag captured during pending phase
					// This ensures KilocodeEventProcessor knows the user echo already happened
					// For resumed sessions, always set this flag to prevent the agent's first
					// response from being skipped as "user echo"
					if (sawApiReqStarted || isResumedSession) {
						this.firstApiReqStarted.set(latestSession.sessionId, true)
					}

					// Track session started telemetry
					captureAgentManagerSessionStarted(
						latestSession.sessionId,
						latestSession.parallelMode?.enabled ?? false,
					)
				}
			},
			onSessionCompleted: (sessionId) => {
				// Notify webview state machine of completion when process exits successfully
				// This ensures the state machine transitions to completed state
				// (needed because completion_result events from CLI stdout can be truncated)
				this.postMessage({
					type: "agentManager.stateEvent",
					sessionId,
					eventType: "ask_completion_result",
				})
			},
			onPaymentRequiredPrompt: (payload) => this.showPaymentRequiredPrompt(payload),
			onSessionRenamed: (oldId, newId) => this.handleSessionRenamed(oldId, newId),
		}

		// Pass extension path for agent-runtime resolution in development
		const extensionPath = this.context.extensionUri.fsPath
		// Pass VS Code app root for finding bundled binaries (ripgrep, etc.)
		const vscodeAppRoot = vscode.env.appRoot
		this.processHandler = new RuntimeProcessHandler(this.registry, callbacks, extensionPath, vscodeAppRoot)
		this.eventProcessor = new KilocodeEventProcessor({
			processHandler: this.processHandler,
			registry: this.registry,
			sessionMessages: this.sessionMessages,
			firstApiReqStarted: this.firstApiReqStarted,
			log: (sessionId, line) => this.log(sessionId, line),
			postChatMessages: (sessionId, messages) =>
				this.postMessage({ type: "agentManager.chatMessages", sessionId, messages }),
			postState: () => this.postStateToWebview(),
			postStateEvent: (sessionId, payload) =>
				this.postMessage({ type: "agentManager.stateEvent", sessionId, ...payload }),
			onPaymentRequiredPrompt: (payload) => this.showPaymentRequiredPrompt(payload),
		})
	}

	/**
	 * Build a message for RuntimeProcessHandler with base64 images directly.
	 * The agent-runtime extension expects base64 data URLs.
	 */
	private buildRuntimeMessage(content: string, images?: string[]): StdinAskResponseMessage {
		const message: StdinAskResponseMessage = {
			type: "askResponse",
			askResponse: "messageResponse",
			text: content,
		}

		if (images && images.length > 0) {
			// Pass base64 data URLs directly - the extension expects this format
			message.images = images
			this.outputChannel.appendLine(
				`[AgentManager] buildRuntimeMessage: attaching ${images.length} images, first image length: ${images[0]?.length || 0}`,
			)
		}

		return message
	}

	/**
	 * Open or focus the Agent Manager panel
	 */
	public async openPanel(): Promise<void> {
		if (this.panel) {
			this.panel.reveal(vscode.ViewColumn.One)
			return
		}

		this.panel = vscode.window.createWebviewPanel(
			AgentManagerProvider.viewType,
			"Agent Manager",
			vscode.ViewColumn.One,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [this.context.extensionUri],
			},
		)

		this.panel.iconPath = {
			light: vscode.Uri.joinPath(this.context.extensionUri, "assets", "icons", "kilo-light.svg"),
			dark: vscode.Uri.joinPath(this.context.extensionUri, "assets", "icons", "kilo-dark.svg"),
		}

		this.panel.webview.html =
			this.context.extensionMode === vscode.ExtensionMode.Development
				? await this.getHMRHtmlContent(this.panel.webview)
				: this.getHtmlContent(this.panel.webview)

		this.panel.webview.onDidReceiveMessage((message) => this.handleMessage(message), null, this.disposables)

		this.panel.onDidDispose(
			() => {
				this.panel = undefined
				this.stopAllAgents()
			},
			null,
			this.disposables,
		)

		this.outputChannel.appendLine("Agent Manager panel opened")

		// Track Agent Manager panel opened
		captureAgentManagerOpened()
	}

	/** Rename session key in all session-keyed maps when provisional session is upgraded. */
	private handleSessionRenamed(oldId: string, newId: string): void {
		this.outputChannel.appendLine(`[AgentManager] Renaming session: ${oldId} -> ${newId}`)

		renameMapKey(this.sessionMessages, oldId, newId)
		renameMapKey(this.firstApiReqStarted, oldId, newId)
		renameMapKey(this.processStartTimes, oldId, newId)
		renameMapKey(this.sendingMessageMap, oldId, newId)

		const messages = this.sessionMessages.get(newId)
		if (messages) {
			this.postMessage({ type: "agentManager.chatMessages", sessionId: newId, messages })
		}
	}

	private handleMessage(message: { type: string; [key: string]: unknown }): void {
		this.outputChannel.appendLine(`Agent Manager received message: ${JSON.stringify(message)}`)

		try {
			switch (message.type) {
				case "agentManager.webviewReady":
					this.postStateToWebview()
					void this.fetchAndPostRemoteSessions()
					void this.fetchAndPostAvailableModels()
					break
				case "agentManager.refreshModels":
					void this.fetchAndPostAvailableModels(true)
					break
				case "agentManager.startSession":
					void this.handleStartSession(message)
					break
				case "agentManager.stopSession":
					this.stopAgentSession(message.sessionId as string)
					break
				case "agentManager.finishWorktreeSession":
					void this.finishWorktreeSession(message.sessionId as string)
					break
				case "agentManager.sendMessage":
					void this.sendMessage(
						message.sessionId as string,
						message.content as string,
						message.sessionLabel as string | undefined,
						message.images as string[] | undefined,
					)
					break
				case "agentManager.messageQueued":
					void this.handleQueuedMessage(
						message.sessionId as string,
						message.messageId as string,
						message.content as string,
						message.sessionLabel as string | undefined,
						message.images as string[] | undefined,
					)
					break
				case "agentManager.resumeSession":
					void this.resumeSession(
						message.sessionId as string,
						message.content as string,
						message.sessionLabel as string | undefined,
						message.images as string[] | undefined,
					)
					break
				case "agentManager.cancelSession":
					void this.cancelSession(message.sessionId as string)
					break
				case "agentManager.respondToApproval":
					void this.respondToApproval(
						message.sessionId as string,
						message.approved as boolean,
						message.text as string | undefined,
					)
					break
				case "agentManager.removeSession":
					this.removeSession(message.sessionId as string)
					break
				case "agentManager.cancelPendingSession":
					this.cancelPendingSession()
					break
				case "agentManager.selectSession":
					this.selectSession(message.sessionId as string | null)
					break
				case "agentManager.refreshRemoteSessions":
					void this.fetchAndPostRemoteSessions()
					break
				case "agentManager.listBranches":
					void this.handleListBranches()
					break
				case "agentManager.refreshSessionMessages":
					void this.refreshSessionMessages(message.sessionId as string)
					break
				case "agentManager.showTerminal":
					this.terminalManager.showTerminal(message.sessionId as string)
					break
				case "agentManager.configureSetupScript":
					void this.configureSetupScript()
					break
				case "agentManager.sessionShare":
					SessionManager.init()
						?.shareSession(message.sessionId as string)
						.then((result) => {
							const shareUrl = `https://app.kilo.ai/share/${result.share_id}`

							void vscode.env.clipboard.writeText(shareUrl)
							vscode.window.showInformationMessage(
								t("common:info.session_share_link_copied_with_url", { url: shareUrl }),
							)
						})
						.catch((error) => {
							const errorMessage = error instanceof Error ? error.message : String(error)
							vscode.window.showErrorMessage(`Failed to share session: ${errorMessage}`)
						})
					break
				case "openImage":
					// Handle image click from ImageThumbnail component
					void openImage(message.text as string)
					break
			}
		} catch (error) {
			this.outputChannel.appendLine(`Error handling message: ${error}`)
		}
	}

	/**
	 * Handle start session message from webview.
	 * Supports multi-version mode: when versions > 1, spawns multiple sessions sequentially.
	 */
	private async handleStartSession(message: { [key: string]: unknown }): Promise<void> {
		// Reset auth warning dedupe for each start attempt so users see the login prompt
		// every time they try to start an agent and authentication fails.
		this.lastAuthErrorMessage = undefined

		// Validate message using zod schema for type safety
		const parseResult = startSessionMessageSchema.safeParse(message)
		if (!parseResult.success) {
			this.outputChannel.appendLine(`[AgentManager] Invalid startSession message: ${parseResult.error.message}`)
			this.postMessage({ type: "agentManager.startSessionFailed" })
			return
		}

		const validatedMessage: StartSessionMessage = parseResult.data
		const { prompt, parallelMode = false, existingBranch, model, images } = validatedMessage

		// For agent-runtime, pass base64 images directly (not file paths)
		// The extension expects base64 data URLs in the format "data:image/png;base64,..."
		if (images && images.length > 0) {
			this.outputChannel.appendLine(`[AgentManager] Passing ${images.length} images (base64) to new session`)
		}

		// Clamp versions to valid range to prevent runaway process spawning
		const rawVersions = validatedMessage.versions ?? 1
		const versions = Math.min(Math.max(rawVersions, 1), MAX_VERSION_COUNT)
		// Only use labels if they match the version count, otherwise ignore
		const rawLabels = validatedMessage.labels
		const labels = rawLabels?.length === versions ? rawLabels : undefined

		// Extract session configurations
		const configs = extractSessionConfigs({ prompt, versions, labels, parallelMode, existingBranch })

		if (configs.length === 1) {
			// Single session - spawn directly
			const config = configs[0]
			await this.startAgentSession(config.prompt, {
				parallelMode: config.parallelMode,
				labelOverride: config.label,
				existingBranch: config.existingBranch,
				model,
				images,
			})
			return
		}

		// Multi-version mode: spawn sessions sequentially
		// We need to wait for each pending session to clear before starting the next
		this.outputChannel.appendLine(`[AgentManager] Starting ${configs.length} versions in multi-version mode`)

		for (let i = 0; i < configs.length; i++) {
			const config = configs[i]
			this.outputChannel.appendLine(`[AgentManager] Starting version ${i + 1}/${configs.length}: ${config.label}`)

			await this.startAgentSession(config.prompt, {
				parallelMode: config.parallelMode,
				labelOverride: config.label,
				existingBranch: config.existingBranch,
				model,
				images, // Send images to all versions
			})

			// Wait for the pending session to transition to active before spawning the next
			// This is necessary because RuntimeProcessHandler only supports one pendingProcess at a time
			if (i < configs.length - 1) {
				await this.waitForPendingSessionToClear()
			}
		}

		this.outputChannel.appendLine(`[AgentManager] All ${configs.length} versions started`)
	}

	/**
	 * Wait for any pending session to transition to active/error state.
	 * Returns immediately if no session is pending.
	 */
	private waitForPendingSessionToClear(): Promise<void> {
		return new Promise((resolve) => {
			const hasPending = () => !!this.registry.pendingSession || this.processHandler?.hasPendingProcess()

			// Check immediately - if no pending session/process, resolve right away
			if (!hasPending()) {
				resolve()
				return
			}

			// Track timeout so we can clear it when session clears
			let timeoutId: ReturnType<typeof setTimeout> | undefined

			// Poll until pending session clears
			const checkInterval = setInterval(() => {
				if (!hasPending()) {
					clearInterval(checkInterval)
					if (timeoutId) {
						clearTimeout(timeoutId)
					}
					resolve()
				}
			}, 100)

			// Timeout after 30 seconds to avoid hanging forever
			timeoutId = setTimeout(() => {
				clearInterval(checkInterval)
				this.outputChannel.appendLine(`[AgentManager] Timeout waiting for pending session to clear`)
				resolve()
			}, 30000)
		})
	}

	private async initializeCurrentGitUrl(): Promise<void> {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
		if (!workspaceFolder) {
			return
		}

		try {
			const rawGitUrl = await getRemoteUrl(workspaceFolder)
			this.currentGitUrl = normalizeGitUrl(rawGitUrl)
			this.outputChannel.appendLine(`[AgentManager] Current git URL: ${this.currentGitUrl}`)
		} catch (error) {
			this.outputChannel.appendLine(
				`[AgentManager] Could not get git URL for workspace: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	/**
	 * Get or create WorktreeManager for the current workspace
	 */
	private getWorktreeManager(): WorktreeManager {
		if (!this.worktreeManager) {
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
			if (!workspaceFolder) {
				throw new Error("No workspace folder open")
			}
			this.worktreeManager = new WorktreeManager(workspaceFolder, this.outputChannel)
		}
		return this.worktreeManager
	}

	/**
	 * Get or create SetupScriptService for the current workspace
	 */
	private getSetupScriptService(): SetupScriptService {
		if (!this.setupScriptService) {
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
			if (!workspaceFolder) {
				throw new Error("No workspace folder open")
			}
			this.setupScriptService = new SetupScriptService(workspaceFolder)
		}
		return this.setupScriptService
	}

	/**
	 * Run the setup script for a new worktree session.
	 * Non-blocking - script failures don't prevent session start.
	 */
	private async runSetupScriptForWorktree(worktreePath: string): Promise<void> {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
		if (!workspaceFolder) {
			return
		}

		try {
			const setupScriptService = this.getSetupScriptService()
			const runner = new SetupScriptRunner(this.outputChannel, setupScriptService)

			await runner.runIfConfigured({
				worktreePath,
				repoPath: workspaceFolder,
			})
		} catch (error) {
			// Non-blocking - log error but don't fail session start
			const errorMsg = error instanceof Error ? error.message : String(error)
			this.outputChannel.appendLine(`[AgentManager] Setup script error (non-blocking): ${errorMsg}`)
		}
	}

	/**
	 * Open the setup script configuration in VS Code editor.
	 * Creates a default template if no script exists.
	 */
	private async configureSetupScript(): Promise<void> {
		try {
			const setupScriptService = this.getSetupScriptService()
			await setupScriptService.openInEditor()
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error)
			this.outputChannel.appendLine(`[AgentManager] Failed to open setup script: ${errorMsg}`)
			void vscode.window.showErrorMessage(`Failed to open setup script: ${errorMsg}`)
		}
	}

	/**
	 * Start a new agent session using the kilocode CLI
	 * @param prompt - The task prompt for the agent
	 */
	private async startAgentSession(
		prompt: string,
		options?: {
			parallelMode?: boolean
			labelOverride?: string
			existingBranch?: string
			model?: string
			images?: string[] // Image file paths to include with the initial prompt
		},
	): Promise<void> {
		if (!prompt) {
			this.outputChannel.appendLine("ERROR: prompt is empty")
			return
		}

		// Get workspace folder early to fetch git URL before spawning
		// Note: we intentionally allow starting parallel mode from within an existing git worktree.
		// Git worktrees share a common .git dir, so `git worktree add/remove` still works from a worktree root.
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath

		// Get git URL for the workspace (used for filtering sessions)
		let gitUrl: string | undefined
		if (workspaceFolder) {
			try {
				gitUrl = normalizeGitUrl(await getRemoteUrl(workspaceFolder))
				// Update currentGitUrl to ensure consistency between session gitUrl and filter
				// This fixes a race condition where initializeCurrentGitUrl() hasn't completed yet
				if (gitUrl && !this.currentGitUrl) {
					this.currentGitUrl = gitUrl
					this.outputChannel.appendLine(`[AgentManager] Updated current git URL: ${gitUrl}`)
				}
			} catch (error) {
				this.outputChannel.appendLine(
					`[AgentManager] Could not get git URL: ${error instanceof Error ? error.message : String(error)}`,
				)
			}
		}

		const onSetupFailed = () => {
			if (!workspaceFolder) {
				void vscode.window.showErrorMessage("Please open a folder before starting an agent.")
			}
			this.postMessage({ type: "agentManager.startSessionFailed" })
		}

		let effectiveWorkspace = workspaceFolder
		let worktreeInfo: { branch: string; path: string; parentBranch: string } | undefined

		if (options?.parallelMode && workspaceFolder) {
			worktreeInfo = await this.prepareWorktreeForSession(prompt, options.existingBranch)
			if (!worktreeInfo) {
				onSetupFailed()
				return
			}
			effectiveWorkspace = worktreeInfo.path

			// Run setup script for new worktree sessions (non-blocking)
			// Only run for new sessions, not when resuming (existingBranch indicates resume)
			if (!options.existingBranch) {
				await this.runSetupScriptForWorktree(worktreeInfo.path)
			}
		}

		await this.spawnAgentWithCommonSetup(
			prompt,
			{
				parallelMode: options?.parallelMode,
				label: options?.labelOverride,
				gitUrl,
				existingBranch: options?.existingBranch,
				worktreeInfo,
				effectiveWorkspace,
				model: options?.model,
				images: options?.images, // Images are sent with prompt via stdin newTask message
			},
			onSetupFailed,
		)
	}

	private async getApiConfigurationForCli(): Promise<ProviderSettings | undefined> {
		const { apiConfiguration } = await this.provider.getState()
		return apiConfiguration
	}

	/**
	 * Creates a worktree for parallel mode sessions.
	 * Returns worktree info on success, or undefined if creation failed (error already shown to user).
	 */
	private async prepareWorktreeForSession(
		prompt: string,
		existingBranch?: string,
	): Promise<{ branch: string; path: string; parentBranch: string } | undefined> {
		try {
			const manager = this.getWorktreeManager()
			const worktreeInfo = await manager.createWorktree({ prompt, existingBranch })
			this.outputChannel.appendLine(
				`[AgentManager] Created worktree: ${worktreeInfo.path} (branch: ${worktreeInfo.branch})`,
			)
			return worktreeInfo
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error)
			this.outputChannel.appendLine(`[AgentManager] Failed to create worktree: ${errorMsg}`)
			void vscode.window.showErrorMessage(
				error instanceof WorktreeError
					? `Failed to create worktree: ${error.message}`
					: `Failed to start parallel mode: ${errorMsg}`,
			)
			return undefined
		}
	}

	/**
	 * Common helper to spawn an agent process with standard setup.
	 * Handles workspace folder validation, API config, and event callback wiring.
	 * Uses RuntimeProcessHandler which forks agent-runtime processes (no CLI needed).
	 * @returns true if process was spawned, false if setup failed
	 */
	private async spawnAgentWithCommonSetup(
		prompt: string,
		options: {
			parallelMode?: boolean
			label?: string
			gitUrl?: string
			existingBranch?: string
			sessionId?: string
			worktreeInfo?: { branch: string; path: string; parentBranch: string }
			effectiveWorkspace?: string
			model?: string
			images?: string[] // Image file paths to include with the initial prompt
			sessionData?: { uiMessages: ClineMessage[]; apiConversationHistory: unknown[]; metadata: { sessionId: string; title: string; createdAt: string; mode: string | null } } // For resuming with history
		},
		onSetupFailed?: () => void,
	): Promise<boolean> {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
		if (!workspaceFolder) {
			this.outputChannel.appendLine("ERROR: No workspace folder open")
			onSetupFailed?.()
			return false
		}

		// Use effective workspace (worktree path) if provided, otherwise use workspace folder
		const workspace = options.effectiveWorkspace || workspaceFolder

		const processStartTime = Date.now()
		let apiConfiguration: ProviderSettings | undefined
		try {
			apiConfiguration = await this.getApiConfigurationForCli()
		} catch (error) {
			this.outputChannel.appendLine(
				`[AgentManager] Failed to read provider settings: ${
					error instanceof Error ? error.message : String(error)
				}`,
			)
		}

		// RuntimeProcessHandler uses fork() with agent-runtime, cliPath is ignored
		this.processHandler.spawnProcess(
			"", // cliPath not used - RuntimeProcessHandler forks agent-runtime
			workspace,
			prompt,
			{
				...options,
				apiConfiguration,
				// Pass worktree info for session state tracking
				worktreeInfo: options.worktreeInfo,
			},
			(sid, event) => {
				if (!this.processStartTimes.has(sid)) {
					this.processStartTimes.set(sid, processStartTime)
				}
				this.handleCliEvent(sid, event)
			},
		)

		return true
	}

	/**
	 * Handle a JSON event from the CLI stdout
	 */
	private handleCliEvent(sessionId: string, event: StreamEvent): void {
		switch (event.streamEventType) {
			case "kilocode": {
				// Filter out replayed events from history (older than process start time)
				// We allow timestamp <= 1000 because 'welcome' events often have timestamp: 1
				const processStartTime = this.processStartTimes.get(sessionId) ?? 0
				const eventTimestamp = event.payload?.timestamp
				if (eventTimestamp && eventTimestamp > 1000 && eventTimestamp < processStartTime) {
					this.outputChannel.appendLine(
						`[AgentManager] Filtering replayed event: ${event.payload?.say || event.payload?.ask || "unknown"} (ts=${eventTimestamp} < start=${processStartTime})`,
					)
					return
				}
				this.handleKilocodeEvent(sessionId, event)
				break
			}
			case "status":
				this.parseParallelModeStatus(sessionId, event.message)
				this.log(sessionId, event.message)
				break
			case "output":
				this.parseParallelModeOutput(sessionId, event.content)
				this.log(sessionId, `[${event.source}] ${event.content}`)
				break
			case "error": {
				const session = this.registry.getSession(sessionId)
				this.registry.updateSessionStatus(sessionId, "error", undefined, event.error)
				this.log(sessionId, `Error: ${event.error}`)
				if (event.details) {
					this.log(sessionId, `Details: ${JSON.stringify(event.details)}`)
				}
				// Track session error telemetry
				captureAgentManagerSessionError(sessionId, session?.parallelMode?.enabled ?? false, event.error)
				break
			}
			case "complete": {
				const session = this.registry.getSession(sessionId)
				const isSuccess = event.exitCode === 0 || event.exitCode === undefined
				this.registry.updateSessionStatus(sessionId, isSuccess ? "done" : "error", event.exitCode)
				this.log(sessionId, isSuccess ? "Agent completed" : `Agent failed with exit code ${event.exitCode}`)
				void this.fetchAndPostRemoteSessions()
				// Notify webview state machine of completion (only on success)
				// This is needed because completion_result events can be truncated in stdout chunking
				if (isSuccess) {
					this.postMessage({
						type: "agentManager.stateEvent",
						sessionId,
						eventType: "ask_completion_result",
					})
					// Track session completed telemetry
					captureAgentManagerSessionCompleted(sessionId, session?.parallelMode?.enabled ?? false)
				} else {
					// Track session error telemetry
					captureAgentManagerSessionError(
						sessionId,
						session?.parallelMode?.enabled ?? false,
						`Exit code ${event.exitCode}`,
					)
				}
				break
			}
			case "interrupted": {
				const session = this.registry.getSession(sessionId)
				this.registry.updateSessionStatus(sessionId, "stopped", undefined, event.reason)
				this.log(sessionId, event.reason || "Execution interrupted")
				// Track session stopped telemetry
				captureAgentManagerSessionStopped(sessionId, session?.parallelMode?.enabled ?? false)
				break
			}
			case "session_created":
				// Handled by CliProcessManager
				break
			case "welcome":
				this.handleWelcomeEvent(sessionId, event as WelcomeStreamEvent)
				break
		}
	}

	/**
	 * Parse parallel mode info from CLI status messages
	 */
	private parseParallelModeStatus(sessionId: string, message: string): void {
		let updated = false

		const branch = parseParallelModeBranch(message)
		if (branch) {
			if (this.registry.updateParallelModeInfo(sessionId, { branch })) {
				updated = true
			}
		}

		const worktreePath = parseParallelModeWorktreePath(message)
		if (worktreePath) {
			if (this.registry.updateParallelModeInfo(sessionId, { worktreePath })) {
				updated = true
			}
		}

		if (updated) {
			this.postStateToWebview()
		}
	}

	/**
	 * Parse parallel mode completion message from CLI output
	 */
	private parseParallelModeOutput(sessionId: string, content: string): void {
		if (isParallelModeCompletionMessage(content)) {
			let updated = false

			// Extract branch name from completion message
			const branch = parseParallelModeCompletionBranch(content)
			if (branch) {
				if (this.registry.updateParallelModeInfo(sessionId, { branch })) {
					updated = true
				}
			}

			// Store the completion message
			if (this.registry.updateParallelModeInfo(sessionId, { completionMessage: content })) {
				updated = true
			}

			if (updated) {
				this.postStateToWebview()
			}
		}
	}

	/**
	 * Handle welcome event from CLI - extracts worktree branch and path for parallel mode sessions
	 */
	private handleWelcomeEvent(sessionId: string, event: WelcomeStreamEvent): void {
		let updated = false
		const session = this.registry.getSession(sessionId)
		const existingWorktreePath = session?.parallelMode?.worktreePath

		if (event.worktreeBranch) {
			this.outputChannel.appendLine(
				`[AgentManager] Session ${sessionId} worktree branch: ${event.worktreeBranch}`,
			)
			if (this.registry.updateParallelModeInfo(sessionId, { branch: event.worktreeBranch })) {
				updated = true
			}
		}

		if (event.worktreePath) {
			this.outputChannel.appendLine(`[AgentManager] Session ${sessionId} worktree path: ${event.worktreePath}`)
			if (this.registry.updateParallelModeInfo(sessionId, { worktreePath: event.worktreePath })) {
				updated = true
			}
		}

		if (!event.worktreePath && event.worktreeBranch && !existingWorktreePath) {
			const derivedWorktreePath = buildParallelModeWorktreePath(event.worktreeBranch)
			this.outputChannel.appendLine(
				`[AgentManager] Session ${sessionId} derived worktree path: ${derivedWorktreePath}`,
			)
			if (this.registry.updateParallelModeInfo(sessionId, { worktreePath: derivedWorktreePath })) {
				updated = true
			}
		}

		if (updated) {
			this.postStateToWebview()
		}
	}

	private handleKilocodeEvent(sessionId: string, event: KilocodeStreamEvent): void {
		this.eventProcessor.handle(sessionId, event)
	}

	/**
	 * Append a log line to a session
	 */
	private log(sessionId: string, line: string): void {
		this.registry.appendLog(sessionId, line)
	}

	private selectSession(sessionId: string | null): void {
		this.registry.selectedId = sessionId
		this.postStateToWebview()

		if (!sessionId) return

		this.terminalManager.showExistingTerminal(sessionId)

		// Check if we have cached messages to send immediately
		const cachedMessages = this.sessionMessages.get(sessionId)
		if (cachedMessages) {
			// Re-post cached messages to ensure webview has them
			this.postMessage({
				type: "agentManager.chatMessages",
				sessionId,
				messages: cachedMessages,
			})
			return
		}

		// No cached messages - fetch from remote if no active process
		if (!this.processHandler.hasProcess(sessionId)) {
			void this.fetchRemoteSessionMessages(sessionId)
		}
	}

	private async fetchRemoteSessionMessages(sessionId: string): Promise<void> {
		try {
			const messages = await this.remoteSessionService.fetchSessionMessages(sessionId)
			if (!messages) return

			this.storeAndPostMessages(sessionId, messages)
		} catch (error) {
			this.outputChannel.appendLine(`[AgentManager] Failed to fetch remote session messages: ${error}`)
		}
	}

	private storeAndPostMessages(sessionId: string, messages: ClineMessage[]): void {
		this.outputChannel.appendLine(`[AgentManager] Fetched ${messages.length} messages for session: ${sessionId}`)

		this.sessionMessages.set(sessionId, messages)
		this.postMessage({
			type: "agentManager.chatMessages",
			sessionId,
			messages,
		})
	}

	private async refreshSessionMessages(sessionId: string): Promise<void> {
		this.sessionMessages.delete(sessionId)
		await this.fetchRemoteSessionMessages(sessionId)
	}

	/**
	 * Stop a running agent session
	 */
	private stopAgentSession(sessionId: string): void {
		const session = this.registry.getSession(sessionId)

		this.processHandler.stopProcess(sessionId)

		this.registry.updateSessionStatus(sessionId, "stopped", undefined, "Stopped by user")
		this.log(sessionId, "Stopped by user")
		this.postStateToWebview()

		// Notify webview state machine of cancellation
		// This ensures the state machine transitions to stopped state
		this.postMessage({
			type: "agentManager.stateEvent",
			sessionId,
			eventType: "cancel_session",
		})

		this.firstApiReqStarted.delete(sessionId)
		this.processStartTimes.delete(sessionId)
		this.sendingMessageMap.delete(sessionId)

		// Track session stopped telemetry
		captureAgentManagerSessionStopped(sessionId, session?.parallelMode?.enabled ?? false)
	}

	/**
	 * Finish a worktree (parallel mode) session:
	 * 1. Stage all changes
	 * 2. Ask agent to generate commit message and commit
	 * 3. Fallback to programmatic commit if agent times out
	 *
	 * Note: The session remains interactive after finishing. The CLI process
	 * and worktree are kept alive so the user can continue working.
	 */
	private async finishWorktreeSession(sessionId: string): Promise<void> {
		const session = this.registry.getSession(sessionId)
		if (!session?.parallelMode?.enabled) {
			this.outputChannel.appendLine(
				`[AgentManager] Ignoring finishWorktreeSession for non-worktree session: ${sessionId}`,
			)
			return
		}

		if (session.status !== "running") {
			this.outputChannel.appendLine(
				`[AgentManager] Ignoring finishWorktreeSession for non-running session: ${sessionId} (status: ${session.status})`,
			)
			return
		}

		const worktreePath = session.parallelMode.worktreePath
		const branch = session.parallelMode.branch

		if (!worktreePath) {
			this.outputChannel.appendLine(`[AgentManager] No worktree path for session: ${sessionId}`)
			return
		}

		this.log(sessionId, "Finishing worktree session...")

		try {
			const manager = this.getWorktreeManager()

			// Stage all changes
			const hasChanges = await manager.stageAllChanges(worktreePath)

			if (hasChanges) {
				this.log(sessionId, "Asking agent to commit changes...")

				// Create task runner with sendMessage bound to this session
				const taskRunner = new AgentTaskRunner(this.outputChannel, async (sid, message) => {
					await this.sendMessageToStdin(sid, message)
				})

				// Ask agent to commit with a proper message
				const commitTask = AgentTasks.createCommitTask(worktreePath, "chore: parallel mode task completion")
				const result = await taskRunner.executeTask(sessionId, commitTask)

				if (result.completedByAgent) {
					this.log(sessionId, "Agent committed changes successfully")
					// Show completion message only on success
					this.showWorktreeCompletionMessage(branch)
				} else if (result.success) {
					this.log(sessionId, "Used fallback commit message")
					// Show completion message only on success
					this.showWorktreeCompletionMessage(branch)
				} else {
					this.log(sessionId, `Commit failed: ${result.error}`)
					// Don't show completion message on failure - show error instead
					vscode.window.showErrorMessage(`Failed to commit changes: ${result.error}`)
				}
			} else {
				this.log(sessionId, "No changes to commit")
				if (branch) {
					void vscode.window.showInformationMessage(
						`Parallel mode complete (no changes). Branch: ${branch}`,
						"Copy Branch Name",
					).then((selection) => {
						if (selection === "Copy Branch Name") {
							void vscode.env.clipboard.writeText(branch)
						}
					})
				}
			}
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error)
			this.outputChannel.appendLine(`[AgentManager] Error finishing worktree session: ${errorMsg}`)
		}

		this.postStateToWebview()
	}

	/**
	 * Send a message to a session's stdin (for agent instructions)
	 */
	private async sendMessageToStdin(sessionId: string, content: string, images?: string[]): Promise<void> {
		// Use buildRuntimeMessage to send base64 images directly (not file paths)
		const message = this.buildRuntimeMessage(content, images)
		await this.processHandler.writeToStdin(sessionId, message)
	}

	/**
	 * Show completion message after finishing worktree session
	 */
	private showWorktreeCompletionMessage(branch?: string): void {
		if (!branch) return

		const message = `Parallel mode complete! Changes committed to: ${branch}`
		void vscode.window.showInformationMessage(message, "Copy Branch Name").then((selection) => {
			if (selection === "Copy Branch Name") {
				void vscode.env.clipboard.writeText(branch)
			}
		})
	}

	/**
	 * Send a follow-up message to a running agent session via stdin.
	 */
	public async sendMessage(
		sessionId: string,
		content: string,
		sessionLabel?: string,
		images?: string[],
	): Promise<void> {
		if (!this.processHandler.hasStdin(sessionId)) {
			// Session is not running - ignore the message
			this.outputChannel.appendLine(`[AgentManager] Session ${sessionId} not running, ignoring follow-up message`)
			return
		}

		// Use buildRuntimeMessage to send base64 images directly (not file paths)
		const message = this.buildRuntimeMessage(content, images)
		await this.safeWriteToStdin(sessionId, message, "message")
	}

	/**
	 * Handle a queued message from the webview.
	 * Orchestrates validation, sending, and status notification.
	 */
	private async handleQueuedMessage(
		sessionId: string,
		messageId: string,
		content: string,
		_sessionLabel?: string,
		images?: string[],
	): Promise<void> {
		// Validate the session and message prerequisites
		const validationError = this.validateMessagePrerequisites(sessionId, messageId)
		if (validationError) return

		// Attempt to send the message
		await this.sendQueuedMessage(sessionId, messageId, content, images)
	}

	/**
	 * Validate that a message can be sent (session running, no other message sending).
	 * Returns error message if validation fails, undefined if valid.
	 */
	private validateMessagePrerequisites(sessionId: string, messageId: string): void | undefined {
		// Check if session is running
		if (!this.processHandler.hasStdin(sessionId)) {
			this.outputChannel.appendLine(`[AgentManager] Session ${sessionId} not running, message send failed`)
			this.notifyMessageStatus(sessionId, messageId, "failed", "Session is not running")
			return
		}

		// Check one-at-a-time constraint
		if (this.sendingMessageMap.has(sessionId)) {
			this.outputChannel.appendLine(
				`[AgentManager] Message ${messageId} queued - another message is currently sending`,
			)
			this.notifyMessageStatus(sessionId, messageId, "failed", "Another message is currently being sent")
			return
		}
	}

	/**
	 * Send a validated queued message to the agent.
	 * Handles marking as sending, actual send, and error handling.
	 */
	private async sendQueuedMessage(
		sessionId: string,
		messageId: string,
		content: string,
		images?: string[],
	): Promise<void> {
		// Mark as sending
		this.sendingMessageMap.set(sessionId, messageId)
		this.notifyMessageStatus(sessionId, messageId, "sending")

		try {
			// Use buildRuntimeMessage to send base64 images directly (not file paths)
			const message = this.buildRuntimeMessage(content, images)
			await this.safeWriteToStdin(sessionId, message, "message")
			this.log(sessionId, `Message ${messageId} sent successfully`)
			this.notifyMessageStatus(sessionId, messageId, "sent")
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : "Unknown error"
			this.outputChannel.appendLine(`[AgentManager] Failed to send message ${messageId}: ${errorMsg}`)
			this.notifyMessageStatus(sessionId, messageId, "failed", errorMsg)
		} finally {
			// Clear the sending flag
			this.sendingMessageMap.delete(sessionId)
		}
	}

	/**
	 * Notify the webview of message status changes.
	 */
	private notifyMessageStatus(
		sessionId: string,
		messageId: string,
		status: "sending" | "sent" | "failed",
		error?: string,
	): void {
		this.postMessage({
			type: "agentManager.messageStatus",
			sessionId,
			messageId,
			status,
			error,
		})
	}

	/**
	 * Resume a completed session by spawning a new agent-runtime process.
	 * The agent-runtime will load conversation history from server using sessionId.
	 * Supports both local sessions (in registry) and remote sessions (from server).
	 */
	public async resumeSession(
		sessionId: string,
		content: string,
		sessionLabel?: string,
		images?: string[],
	): Promise<void> {
		const session = this.registry.getSession(sessionId)

		// If session is still running, send as regular message instead
		if (this.processHandler.hasStdin(sessionId)) {
			await this.sendMessage(sessionId, content, undefined, images)
			return
		}

		// If session is already being created (another resume in progress), queue the message
		if (session?.status === "creating") {
			this.outputChannel.appendLine(
				`[AgentManager] Session ${sessionId} is already starting, queueing message for later`,
			)
			// Store the message to send after session is ready
			// The message will be handled when the session becomes active
			return
		}

		// For agent-runtime, pass base64 images directly (not file paths)
		if (images && images.length > 0) {
			this.outputChannel.appendLine(`[AgentManager] Passing ${images.length} images (base64) to resumed session`)
		}

		this.outputChannel.appendLine(`[AgentManager] Resuming session ${sessionId} with new prompt`)

		// Fetch full session data for resume (UI messages + API history + metadata)
		let sessionData: { uiMessages: ClineMessage[]; apiConversationHistory: unknown[]; metadata: { sessionId: string; title: string; createdAt: string; mode: string | null } } | undefined
		try {
			const fetchedData = await this.remoteSessionService.fetchSessionDataForResume(sessionId)
			if (fetchedData) {
				sessionData = fetchedData
				this.outputChannel.appendLine(
					`[AgentManager] Fetched session data: ${fetchedData.uiMessages.length} UI messages, ${fetchedData.apiConversationHistory.length} API history entries`,
				)
			} else {
				this.outputChannel.appendLine(`[AgentManager] No session data available for resume`)
			}
		} catch (error) {
			this.outputChannel.appendLine(
				`[AgentManager] Failed to fetch session data for resume: ${error instanceof Error ? error.message : String(error)}`,
			)
		}

		// Handle local session with parallel mode
		if (session?.parallelMode?.enabled && session.parallelMode.branch) {
			const worktreeInfo = await this.prepareWorktreeForResume(session)
			if (worktreeInfo) {
				await this.spawnAgentWithCommonSetup(content, {
					sessionId,
					parallelMode: true,
					gitUrl: session.gitUrl,
					worktreeInfo,
					effectiveWorkspace: worktreeInfo.path,
					images,
					sessionData,
				})
				return
			}
			// If worktree preparation failed, fall through to non-parallel mode
			this.outputChannel.appendLine(`[AgentManager] Failed to prepare worktree, resuming without parallel mode`)
		}

		// Resume session - pass session data for agent-runtime to load
		await this.spawnAgentWithCommonSetup(content, {
			sessionId,
			label: sessionLabel || session?.label,
			parallelMode: session?.parallelMode?.enabled,
			gitUrl: session?.gitUrl,
			images,
			sessionData,
		})
	}

	/**
	 * Prepare worktree for resuming a parallel mode session.
	 * Uses existing worktree if available, otherwise recreates it from the session's branch.
	 */
	private async prepareWorktreeForResume(
		session: AgentSession,
	): Promise<{ branch: string; path: string; parentBranch: string } | undefined> {
		if (!session.parallelMode?.branch) {
			return undefined
		}

		const existingPath = session.parallelMode.worktreePath
		const branch = session.parallelMode.branch
		const parentBranch = session.parallelMode.parentBranch || "main"

		// Check if existing worktree is still valid
		if (existingPath && fs.existsSync(existingPath)) {
			const gitFile = path.join(existingPath, ".git")
			if (fs.existsSync(gitFile)) {
				this.outputChannel.appendLine(`[AgentManager] Reusing existing worktree at: ${existingPath}`)
				return { branch, path: existingPath, parentBranch }
			}
		}

		// Worktree doesn't exist - recreate it from the existing branch
		this.outputChannel.appendLine(`[AgentManager] Recreating worktree for branch: ${branch}`)
		try {
			const manager = this.getWorktreeManager()
			const worktreeInfo = await manager.createWorktree({ existingBranch: branch })

			// Update session with new worktree path
			this.registry.updateParallelModeInfo(session.sessionId, { worktreePath: worktreeInfo.path })

			return worktreeInfo
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error)
			this.outputChannel.appendLine(`[AgentManager] Failed to recreate worktree: ${errorMsg}`)
			return undefined
		}
	}

	/**
	 * Cancel/abort a running agent session via stdin.
	 * Falls back to SIGTERM if stdin write fails.
	 * Does nothing if the session is not running.
	 */
	public async cancelSession(sessionId: string): Promise<void> {
		if (!this.processHandler.hasStdin(sessionId)) {
			// Session is not running or stdin unavailable - force stop
			this.outputChannel.appendLine(`[AgentManager] Session ${sessionId} not running, stopping process`)
			this.stopAgentSession(sessionId)
			return
		}

		const message = { type: "cancelTask" }

		try {
			await this.safeWriteToStdin(sessionId, message, "cancel")
			this.log(sessionId, "Cancel request sent via stdin")
		} catch (error) {
			// Fallback to SIGTERM if stdin write fails
			this.outputChannel.appendLine(`Failed to send cancel via stdin, falling back to SIGTERM: ${error}`)
			this.stopAgentSession(sessionId)
		}
	}

	/**
	 * Respond to an approval prompt (yes/no button click).
	 * Optionally includes additional text context.
	 */
	public async respondToApproval(sessionId: string, approved: boolean, text?: string): Promise<void> {
		if (!this.processHandler.hasStdin(sessionId)) {
			throw new Error(`Session ${sessionId} not found or not running`)
		}

		const message: { type: string; askResponse: string; text?: string } = {
			type: "askResponse",
			askResponse: approved ? "yesButtonClicked" : "noButtonClicked",
		}

		if (text) {
			message.text = text
		}

		await this.safeWriteToStdin(sessionId, message, approved ? "approval-yes" : "approval-no")
		this.log(sessionId, `Approval response sent: ${approved ? "approved" : "rejected"}`)
	}

	private async safeWriteToStdin(sessionId: string, payload: object, label: string): Promise<void> {
		try {
			await this.processHandler.writeToStdin(sessionId, payload)
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			this.outputChannel.appendLine(`[AgentManager] Failed to send ${label} via stdin: ${errorMessage}`)
			void vscode.window.showErrorMessage(`Failed to send ${label} to agent: ${errorMessage}`)
			throw error
		}
	}

	/**
	 * Cancel a pending session that is stuck in "Creating session..." state
	 */
	private cancelPendingSession(): void {
		this.processHandler.cancelPendingSession()
	}

	/**
	 * Remove a session completely
	 */
	private removeSession(sessionId: string): void {
		// Stop process if running
		this.processHandler.stopProcess(sessionId)

		// Clean up messages
		this.sessionMessages.delete(sessionId)

		this.registry.removeSession(sessionId)
		this.postStateToWebview()

		this.firstApiReqStarted.delete(sessionId)
		this.processStartTimes.delete(sessionId)
		this.sendingMessageMap.delete(sessionId)
	}

	private getFilteredState() {
		return this.registry.getStateForGitUrl(this.currentGitUrl)
	}

	private postStateToWebview(): void {
		this.postMessage({
			type: "agentManager.state",
			state: this.getFilteredState(),
		})
	}

	private async fetchAndPostRemoteSessions(): Promise<void> {
		try {
			const remoteSessions = await this.remoteSessionService.fetchRemoteSessions()

			// Filter remote sessions by git_url (only if git_url is available from API)
			const filteredSessions = this.filterRemoteSessionsByGitUrl(remoteSessions)

			this.postMessage({
				type: "agentManager.remoteSessions",
				sessions: filteredSessions,
			})
		} catch (error) {
			this.outputChannel.appendLine(`[AgentManager] Failed to fetch remote sessions: ${error}`)
		}
	}

	/**
	 * Get available models from the extension's cache and post to webview.
	 * Models are already fetched by the main extension - we just read from the shared cache.
	 * @param forceRefresh - If true, clears local cache (extension cache is still used)
	 */
	private async fetchAndPostAvailableModels(forceRefresh: boolean = false): Promise<void> {
		// Skip if we already have cached models and not forcing refresh
		if (this.availableModels && !forceRefresh) {
			this.postModelsToWebview(this.availableModels)
			return
		}

		// Skip if already fetching
		if (this.fetchingModels) {
			return
		}

		this.fetchingModels = true

		try {
			// Get API configuration from the extension
			const state = await this.provider.getState()
			const { apiConfiguration } = state

			// Determine the provider - default to "kilocode" if not set
			const providerName = apiConfiguration.apiProvider || "kilocode"

			// Check if this provider supports model fetching via router
			if (!isRouterName(providerName)) {
				this.outputChannel.appendLine(
					`[AgentManager] Provider "${providerName}" does not support dynamic model fetching`,
				)
				this.postMessage({
					type: "agentManager.modelsLoadFailed",
					error: `Provider "${providerName}" does not support dynamic model fetching`,
				})
				return
			}

			this.outputChannel.appendLine(`[AgentManager] Getting models for provider "${providerName}" from cache...`)

			// Get models from the extension's shared cache (already fetched by main extension)
			const models = getModelsFromCache(providerName)

			if (!models || Object.keys(models).length === 0) {
				this.outputChannel.appendLine(
					`[AgentManager] No models in cache for "${providerName}" - extension may still be loading`,
				)
				this.postMessage({
					type: "agentManager.modelsLoadFailed",
					error: "Models not yet loaded. Please wait for the extension to finish loading.",
				})
				return
			}

			// Get the current model ID from configuration
			const currentModel = getModelId(apiConfiguration) || ""

			// Store the cached result
			this.availableModels = {
				provider: providerName,
				currentModel,
				models,
			}

			const modelCount = Object.keys(models).length
			this.outputChannel.appendLine(`[AgentManager] Got ${modelCount} models for provider "${providerName}"`)

			this.postModelsToWebview(this.availableModels)
		} catch (error) {
			this.outputChannel.appendLine(
				`[AgentManager] Error getting models: ${error instanceof Error ? error.message : String(error)}`,
			)
			this.postMessage({
				type: "agentManager.modelsLoadFailed",
				error: error instanceof Error ? error.message : "Failed to get models",
			})
		} finally {
			this.fetchingModels = false
		}
	}

	/**
	 * Post models to the webview in the expected format.
	 */
	private postModelsToWebview(cached: { provider: string; currentModel: string; models: ModelRecord }): void {
		// Transform ModelRecord to array format expected by webview
		const modelsArray = Object.entries(cached.models).map(([id, info]) => ({
			id,
			displayName: info.displayName || null,
			contextWindow: info.contextWindow ?? 0,
			supportsImages: info.supportsImages,
			inputPrice: info.inputPrice,
			outputPrice: info.outputPrice,
		}))

		this.postMessage({
			type: "agentManager.availableModels",
			provider: cached.provider,
			currentModel: cached.currentModel,
			models: modelsArray,
		})
	}

	private async handleListBranches(): Promise<void> {
		try {
			const gitService = new WorkspaceGitService()
			const { branches, currentBranch } = await gitService.getBranchInfo()
			this.postMessage({ type: "agentManager.branches", branches, currentBranch })
		} catch (error) {
			this.outputChannel.appendLine(
				`[AgentManager] Failed to list branches: ${error instanceof Error ? error.message : String(error)}`,
			)
			this.postMessage({ type: "agentManager.branches", branches: [], currentBranch: undefined })
		}
	}

	private filterRemoteSessionsByGitUrl(sessions: RemoteSession[]): RemoteSession[] {
		if (!this.currentGitUrl) {
			return sessions.filter((s) => !s.git_url)
		}
		return sessions.filter((s) => s.git_url === this.currentGitUrl)
	}

	private postMessage(message: unknown): void {
		// Log outgoing message to webview
		const msg = message as { type?: string; sessionId?: string; messages?: ClineMessage[] }
		if (msg.type === "agentManager.chatMessages") {
			const lastMsgs = msg.messages?.slice(-2).map((m) => {
				const msgType = `${m.type}:${m.say || m.ask || "?"}`
				const text = m.text?.slice(0, 30) || "(no text)"
				return `${msgType} "${text}"`
			})
			this.outputChannel.appendLine(
				`[Webview←] ${msg.type} sessionId=${msg.sessionId} (${msg.messages?.length || 0} messages)` +
					(lastMsgs?.length ? `\n  last: ${lastMsgs.join(", ")}` : ""),
			)
		} else if (msg.type === "agentManager.stateEvent") {
			const eventType = (msg as { eventType?: string }).eventType || "?"
			this.outputChannel.appendLine(`[Webview←] ${msg.type} sessionId=${msg.sessionId} eventType=${eventType}`)
		} else {
			this.outputChannel.appendLine(`[Webview←] ${msg.type || "unknown"}`)
		}
		this.panel?.webview.postMessage(message)
	}

	// HMR support for development mode - same approach as ClineProvider (see src/core/webview/ClineProvider.ts)
	private async getHMRHtmlContent(webview: vscode.Webview): Promise<string> {
		const viteConfig = await getViteDevServerConfig(webview)

		if (!viteConfig) {
			vscode.window.showErrorMessage(
				"Vite dev server is not running. Please run 'pnpm dev' in webview-ui directory or use 'pnpm build'.",
			)
			return this.getHtmlContent(webview)
		}

		const { localServerUrl, csp, reactRefreshScript } = viteConfig

		const stylesUri = getUri(webview, this.context.extensionUri, [
			"webview-ui",
			"build",
			"assets",
			"agent-manager.css",
		])

		const scriptUri = `http://${localServerUrl}/src/kilocode/agent-manager/index.tsx`

		return /*html*/ `
			<!DOCTYPE html>
			<html lang="en">
				<head>
					<meta charset="utf-8">
					<meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no">
					<meta http-equiv="Content-Security-Policy" content="${csp.join("; ")}">
					<link rel="stylesheet" type="text/css" href="${stylesUri}">
					<title>Agent Manager</title>
				</head>
				<body>
					<div id="root"></div>
					${reactRefreshScript}
					<script type="module" src="${scriptUri}"></script>
				</body>
			</html>
		`
	}

	private getHtmlContent(webview: vscode.Webview): string {
		// Get URIs for the React build assets
		const scriptUri = getUri(webview, this.context.extensionUri, [
			"webview-ui",
			"build",
			"assets",
			"agent-manager.js",
		])
		// Include both shared base styles (index.css) and agent-manager specific styles
		const baseStylesUri = getUri(webview, this.context.extensionUri, ["webview-ui", "build", "assets", "index.css"])
		const stylesUri = getUri(webview, this.context.extensionUri, [
			"webview-ui",
			"build",
			"assets",
			"agent-manager.css",
		])

		const nonce = getNonce()

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src ${webview.cspSource} 'nonce-${nonce}';">
	<title>Agent Manager</title>
	<link rel="stylesheet" type="text/css" href="${baseStylesUri}">
	<link rel="stylesheet" type="text/css" href="${stylesUri}">
</head>
<body>
	<div id="root"></div>
	<script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`
	}

	public hasRunningSessions(): boolean {
		return this.registry.hasRunningSessions()
	}

	public getRunningSessionCount(): number {
		return this.registry.getRunningSessionCount()
	}

	private stopAllAgents(): void {
		this.processHandler.stopAllProcesses()

		// Update all running sessions to stopped
		for (const session of this.registry.getSessions()) {
			if (session.status === "running") {
				this.registry.updateSessionStatus(session.sessionId, "stopped", undefined, "Stopped by user")
			}
		}

		this.firstApiReqStarted.clear()
	}

	public dispose(): void {
		this.processHandler.dispose()
		this.terminalManager.dispose()
		this.sessionMessages.clear()
		this.firstApiReqStarted.clear()

		this.panel?.dispose()
		this.disposables.forEach((d) => d.dispose())
	}

	private showPaymentRequiredPrompt(payload?: KilocodePayload | { text?: string; content?: string }): void {
		const { title, message, buyCreditsUrl, rawText } = this.parsePaymentRequiredPayload(payload)

		captureAgentManagerLoginIssue({
			issueType: "payment_required",
		})

		const actionLabel = buyCreditsUrl ? "Open billing" : undefined
		const actions = actionLabel ? [actionLabel] : []

		this.outputChannel.appendLine(`[AgentManager] Payment required: ${message}`)

		void vscode.window.showWarningMessage(`${title}: ${message}`, ...actions).then((selection) => {
			if (selection === actionLabel && buyCreditsUrl) {
				void vscode.env.openExternal(vscode.Uri.parse(buyCreditsUrl))
			}
		})
	}

	private handleStartSessionApiFailure(error: { message?: string; authError?: boolean }): void {
		captureAgentManagerLoginIssue({
			issueType: error.authError ? "auth_error" : "api_error",
			httpStatusCode: error.authError ? 401 : undefined,
		})

		const message = error.message || t("kilocode:agentManager.errors.sessionFailed")
		if (error.authError && message && message === this.lastAuthErrorMessage) {
			return
		}

		void vscode.window.showWarningMessage(message)
		if (error.authError) {
			this.lastAuthErrorMessage = message
		}
	}

	private parsePaymentRequiredPayload(payload?: KilocodePayload | { text?: string; content?: string }): {
		title: string
		message: string
		buyCreditsUrl?: string
		rawText?: string
	} {
		const fallbackTitle = t("kilocode:lowCreditWarning.title")
		const fallbackMessage = t("kilocode:lowCreditWarning.message")

		const rawText = payload ? extractRawText(payload) : undefined
		const parsed = rawText ? tryParsePayloadJson(rawText) : undefined

		const title =
			parsed?.title || (typeof fallbackTitle === "string" ? fallbackTitle : undefined) || "Payment required"
		const message =
			parsed?.message ||
			rawText ||
			(typeof fallbackMessage === "string" ? fallbackMessage : undefined) ||
			"Paid model requires credits or billing setup."

		return { title, message, buyCreditsUrl: parsed?.buyCreditsUrl, rawText }
	}

	private showAgentError(error?: { type: "spawn_error" | "unknown"; message: string }): void {
		const { platform, shell } = getPlatformDiagnostics()

		// Capture telemetry for spawn errors
		if (error?.type === "spawn_error") {
			captureAgentManagerLoginIssue({
				issueType: "cli_spawn_error", // Keep telemetry key for backwards compatibility
				platform,
				shell,
				errorMessage: error.message,
			})
		}

		// Show error message to user
		const errorMessage = error?.message
			? t("kilocode:agentManager.errors.sessionFailedWithMessage", { message: error.message })
			: t("kilocode:agentManager.errors.sessionFailed")
		const actionLabel = t("kilocode:agentManager.actions.getHelp")
		vscode.window.showErrorMessage(errorMessage, actionLabel).then((selection) => {
			if (selection === actionLabel) {
				void vscode.env.openExternal(vscode.Uri.parse("https://kilo.ai/docs"))
			}
		})
	}

	/**
	 * Check if the given directory is inside a git worktree (not the main repo).
	 * In a worktree, .git is a file containing "gitdir: /path/to/main/.git/worktrees/..."
	 * In the main repo, .git is a directory.
	 */
	private isInsideWorktree(workspacePath: string): boolean {
		try {
			const gitPath = path.join(workspacePath, ".git")
			const stat = fs.statSync(gitPath)
			// If .git is a file (not a directory), we're in a worktree
			return stat.isFile()
		} catch {
			// .git doesn't exist or can't be accessed
			return false
		}
	}
}
