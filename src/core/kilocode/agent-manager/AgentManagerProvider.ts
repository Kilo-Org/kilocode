import * as vscode from "vscode"
import * as fs from "node:fs"
import * as path from "node:path"
import { t } from "i18next"
import { AgentRegistry } from "./AgentRegistry"
import {
	parseParallelModeBranch,
	parseParallelModeWorktreePath,
	isParallelModeCompletionMessage,
	parseParallelModeCompletionBranch,
} from "./parallelModeParser"
import { findKilocodeCli } from "./CliPathResolver"
import { canInstallCli, getCliInstallCommand, getLocalCliInstallCommand, getLocalCliBinDir } from "./CliInstaller"
import { CliProcessHandler, type CliProcessHandlerCallbacks } from "./CliProcessHandler"
import type { StreamEvent, KilocodeStreamEvent, KilocodePayload, WelcomeStreamEvent } from "./CliOutputParser"
import { extractRawText, tryParsePayloadJson } from "./askErrorParser"
import { RemoteSessionService } from "./RemoteSessionService"
import { KilocodeEventProcessor } from "./KilocodeEventProcessor"
import type { RemoteSession } from "./types"
import { getUri } from "../../webview/getUri"
import { getNonce } from "../../webview/getNonce"
import { getViteDevServerConfig } from "../../webview/getViteDevServerConfig"
import { getRemoteUrl } from "../../../services/code-index/managed/git-utils"
import { normalizeGitUrl } from "./normalizeGitUrl"
import type { ClineMessage } from "@roo-code/types"
import type { ProviderSettings } from "@roo-code/types"
import {
	captureAgentManagerOpened,
	captureAgentManagerSessionStarted,
	captureAgentManagerSessionCompleted,
	captureAgentManagerSessionStopped,
	captureAgentManagerSessionError,
} from "./telemetry"
import type { ClineProvider } from "../../webview/ClineProvider"
import { extractSessionConfigs, MAX_VERSION_COUNT } from "./multiVersionUtils"
import { SessionManager } from "../../../shared/kilocode/cli-sessions/core/SessionManager"

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
	private processHandler: CliProcessHandler
	private eventProcessor: KilocodeEventProcessor
	private sessionMessages: Map<string, ClineMessage[]> = new Map()
	// Track first api_req_started per session to filter user-input echoes
	private firstApiReqStarted: Map<string, boolean> = new Map()
	// Track the current workspace's git URL for filtering sessions
	private currentGitUrl: string | undefined
	private lastAuthErrorMessage: string | undefined
	// Track process start times to filter out replayed history events
	private processStartTimes: Map<string, number> = new Map()

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly outputChannel: vscode.OutputChannel,
		private readonly provider: ClineProvider,
	) {
		this.registry = new AgentRegistry()
		this.remoteSessionService = new RemoteSessionService({ outputChannel })

		// Initialize currentGitUrl from workspace
		void this.initializeCurrentGitUrl()

		const isDevelopment = this.context.extensionMode === vscode.ExtensionMode.Development

		const callbacks: CliProcessHandlerCallbacks = {
			onLog: (message) => this.outputChannel.appendLine(`[AgentManager] ${message}`),
			// Only enable verbose debug logging in development mode
			onDebugLog: isDevelopment
				? (message) => this.outputChannel.appendLine(`[AgentManager] ${message}`)
				: undefined,
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
				this.showCliError(error)
			},
			onChatMessages: (sessionId, messages) => {
				this.postMessage({ type: "agentManager.chatMessages", sessionId, messages })
			},
			onSessionCreated: (sawApiReqStarted: boolean) => {
				// Initialize messages for the new session with the initial prompt
				const sessions = this.registry.getSessions()
				if (sessions.length > 0) {
					const latestSession = sessions[0]
					// Add initial prompt as user_feedback message
					// The extension doesn't emit user_feedback for the initial prompt,
					// so we add it here when the session is created
					const initialMessage: ClineMessage = {
						ts: latestSession.startTime,
						type: "say",
						say: "user_feedback",
						text: latestSession.prompt,
					}
					this.sessionMessages.set(latestSession.sessionId, [initialMessage])
					// Transfer api_req_started flag captured during pending phase
					// This ensures KilocodeEventProcessor knows the user echo already happened
					if (sawApiReqStarted) {
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
		}

		this.processHandler = new CliProcessHandler(this.registry, callbacks)
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

	private handleMessage(message: { type: string; [key: string]: unknown }): void {
		this.outputChannel.appendLine(`Agent Manager received message: ${JSON.stringify(message)}`)

		try {
			switch (message.type) {
				case "agentManager.webviewReady":
					this.postStateToWebview()
					void this.fetchAndPostRemoteSessions()
					break
				case "agentManager.startSession":
					void this.handleStartSession(message)
					break
				case "agentManager.stopSession":
					this.stopAgentSession(message.sessionId as string)
					break
				case "agentManager.finishWorktreeSession":
					this.finishWorktreeSession(message.sessionId as string)
					break
				case "agentManager.sendMessage":
					void this.sendMessage(
						message.sessionId as string,
						message.content as string,
						message.sessionLabel as string | undefined,
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
				case "agentManager.refreshSessionMessages":
					void this.refreshSessionMessages(message.sessionId as string)
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

		const prompt = message.prompt as string
		// Clamp versions to valid range to prevent runaway process spawning
		const rawVersions = (message.versions as number) ?? 1
		const versions = Math.min(Math.max(rawVersions, 1), MAX_VERSION_COUNT)
		// Only use labels if they match the version count, otherwise ignore
		const rawLabels = message.labels as string[] | undefined
		const labels = rawLabels?.length === versions ? rawLabels : undefined
		const parallelMode = (message.parallelMode as boolean) ?? false

		// Extract session configurations
		const configs = extractSessionConfigs({ prompt, versions, labels, parallelMode })

		if (configs.length === 1) {
			// Single session - spawn directly
			const config = configs[0]
			await this.startAgentSession(config.prompt, {
				parallelMode: config.parallelMode,
				autoMode: config.autoMode,
				labelOverride: config.label,
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
				autoMode: config.autoMode,
				labelOverride: config.label,
			})

			// Wait for the pending session to transition to active before spawning the next
			// This is necessary because CliProcessHandler only supports one pendingProcess at a time
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
			// Check immediately - if no pending session, resolve right away
			if (!this.registry.pendingSession) {
				resolve()
				return
			}

			// Track timeout so we can clear it when session clears
			let timeoutId: ReturnType<typeof setTimeout> | undefined

			// Poll until pending session clears
			const checkInterval = setInterval(() => {
				if (!this.registry.pendingSession) {
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
	 * Start a new agent session using the kilocode CLI
	 * @param prompt - The task prompt for the agent
	 */
	private async startAgentSession(
		prompt: string,
		options?: {
			parallelMode?: boolean
			autoMode?: boolean
			labelOverride?: string
		},
	): Promise<void> {
		if (!prompt) {
			this.outputChannel.appendLine("ERROR: prompt is empty")
			return
		}

		// Get workspace folder - require a valid workspace
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
		if (!workspaceFolder) {
			this.outputChannel.appendLine("ERROR: No workspace folder open")
			void vscode.window.showErrorMessage("Please open a folder before starting an agent.")
			this.postMessage({ type: "agentManager.startSessionFailed" })
			return
		}

		// Note: we intentionally allow starting parallel mode from within an existing git worktree.
		// Git worktrees share a common .git dir, so `git worktree add/remove` still works from a worktree root.

		const cliPath = await findKilocodeCli((msg) => this.outputChannel.appendLine(`[AgentManager] ${msg}`))
		if (!cliPath) {
			this.outputChannel.appendLine("ERROR: kilocode CLI not found")
			this.showCliNotFoundError()
			this.postMessage({ type: "agentManager.startSessionFailed" })
			return
		}

		// Determine label override (used for multi-version mode)
		const existingLabel = options?.labelOverride

		// Get git URL for the workspace (used for filtering sessions)
		let gitUrl: string | undefined
		try {
			gitUrl = normalizeGitUrl(await getRemoteUrl(workspaceFolder))
		} catch (error) {
			this.outputChannel.appendLine(
				`[AgentManager] Could not get git URL: ${error instanceof Error ? error.message : String(error)}`,
			)
		}

		// Record process start time to filter out replayed history events
		// This is set before spawning so any events older than this are from history
		const processStartTime = Date.now()
		let apiConfiguration: ProviderSettings | undefined
		try {
			apiConfiguration = await this.getApiConfigurationForCli()
		} catch (error) {
			this.outputChannel.appendLine(
				`[AgentManager] Failed to read provider settings for CLI: ${
					error instanceof Error ? error.message : String(error)
				}`,
			)
		}

		this.processHandler.spawnProcess(
			cliPath,
			workspaceFolder,
			prompt,
			{
				parallelMode: options?.parallelMode,
				autoMode: options?.autoMode,
				label: existingLabel,
				gitUrl,
				apiConfiguration,
			},
			(sessionId, event) => {
				// For new sessions, set the start time when we first see the session
				if (!this.processStartTimes.has(sessionId)) {
					this.processStartTimes.set(sessionId, processStartTime)
				}
				this.handleCliEvent(sessionId, event)
			},
		)
	}

	private async getApiConfigurationForCli(): Promise<ProviderSettings | undefined> {
		const { apiConfiguration } = await this.provider.getState()
		return apiConfiguration
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
	 * Handle welcome event from CLI - extracts worktree branch for parallel mode sessions
	 */
	private handleWelcomeEvent(sessionId: string, event: WelcomeStreamEvent): void {
		if (event.worktreeBranch) {
			this.outputChannel.appendLine(
				`[AgentManager] Session ${sessionId} worktree branch: ${event.worktreeBranch}`,
			)
			if (this.registry.updateParallelModeInfo(sessionId, { branch: event.worktreeBranch })) {
				this.postStateToWebview()
			}
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

		// Track session stopped telemetry
		captureAgentManagerSessionStopped(sessionId, session?.parallelMode?.enabled ?? false)
	}

	/**
	 * Finish a worktree (parallel mode) session by gracefully terminating the CLI process.
	 * The CLI's SIGTERM handler will run its normal dispose flow, including worktree commit/cleanup.
	 * We keep the process tracked so the exit handler can mark the session as done/error.
	 */
	private finishWorktreeSession(sessionId: string): void {
		const session = this.registry.getSession(sessionId)
		if (!session?.parallelMode?.enabled) {
			// Safety: "Finish to branch" must never apply to non-worktree sessions.
			this.outputChannel.appendLine(
				`[AgentManager] Ignoring finishWorktreeSession for non-worktree session: ${sessionId}`,
			)
			return
		}

		// Only allow finishing if session is still running
		if (session.status !== "running") {
			this.outputChannel.appendLine(
				`[AgentManager] Ignoring finishWorktreeSession for non-running session: ${sessionId} (status: ${session.status})`,
			)
			return
		}

		this.processHandler.terminateProcess(sessionId, "SIGTERM")
		this.log(sessionId, "Finishing worktree session (commit + close)...")
		this.postStateToWebview()
	}

	/**
	 * Send a follow-up message to a running agent session via stdin.
	 */
	public async sendMessage(sessionId: string, content: string, sessionLabel?: string): Promise<void> {
		const session = this.registry.getSession(sessionId)

		// Auto-mode sessions are non-interactive
		if (session?.autoMode) {
			this.outputChannel.appendLine(
				`[AgentManager] Session ${sessionId} is running in auto mode; user input is disabled`,
			)
			return
		}

		if (!this.processHandler.hasStdin(sessionId)) {
			// Session is not running - ignore the message
			this.outputChannel.appendLine(`[AgentManager] Session ${sessionId} not running, ignoring follow-up message`)
			return
		}

		const message = {
			type: "askResponse",
			askResponse: "messageResponse",
			text: content,
		}

		await this.safeWriteToStdin(sessionId, message, "message")
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

	private filterRemoteSessionsByGitUrl(sessions: RemoteSession[]): RemoteSession[] {
		if (!this.currentGitUrl) {
			return sessions.filter((s) => !s.git_url)
		}
		return sessions.filter((s) => s.git_url === this.currentGitUrl)
	}

	private postMessage(message: unknown): void {
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
		this.sessionMessages.clear()
		this.firstApiReqStarted.clear()

		this.panel?.dispose()
		this.disposables.forEach((d) => d.dispose())
	}

	private showPaymentRequiredPrompt(payload?: KilocodePayload | { text?: string; content?: string }): void {
		const { title, message, buyCreditsUrl, rawText } = this.parsePaymentRequiredPayload(payload)

		const actionLabel = buyCreditsUrl ? "Open billing" : undefined
		const actions = actionLabel ? [actionLabel] : []

		this.outputChannel.appendLine(`[AgentManager] Payment required: ${message}`)

		void vscode.window.showWarningMessage(`${title}: ${message}`, ...actions).then((selection) => {
			if (selection === actionLabel && buyCreditsUrl) {
				void vscode.env.openExternal(vscode.Uri.parse(buyCreditsUrl))
			}
		})
	}

	private showCliNotFoundError(): void {
		this.showCliError({ type: "spawn_error", message: "CLI not found" })
	}

	private createCliTerminal(name: string, message?: string): vscode.Terminal | null {
		if (typeof vscode.window.createTerminal !== "function") {
			this.outputChannel.appendLine(`[AgentManager] VS Code terminal unavailable; run "kilocode auth" manually.`)
			return null
		}

		const shellPath = process.platform === "win32" ? undefined : process.env.SHELL
		const shellName = shellPath ? path.basename(shellPath) : undefined
		const shellArgs = process.platform === "win32" ? undefined : shellName === "zsh" ? ["-l", "-i"] : ["-l"]

		return vscode.window.createTerminal({
			name,
			message,
			shellPath,
			shellArgs,
		})
	}

	/**
	 * Open a terminal and run the CLI install command (global installation).
	 * Uses the terminal to ensure the user's shell environment (nvm, fnm, volta, etc.) is respected.
	 */
	private runInstallInTerminal(): void {
		const terminal = this.createCliTerminal(
			"Install Kilocode CLI",
			t("kilocode:agentManager.terminal.installMessage"),
		)
		if (!terminal) {
			return
		}
		terminal.show()
		terminal.sendText(getCliInstallCommand())
		this.showCliAuthReminder()
	}

	private runAuthInTerminal(): void {
		const terminal = this.createCliTerminal("Kilocode CLI Login")
		if (!terminal) {
			return
		}
		terminal.show()
		terminal.sendText("kilocode auth")
	}

	private showCliAuthReminder(message?: string): void {
		const authLabel = t("kilocode:agentManager.actions.loginCli")
		const combined = this.buildAuthReminderMessage(message)
		this.outputChannel.appendLine(`[AgentManager] ${combined}`)
		void vscode.window.showWarningMessage(combined, authLabel).then((selection) => {
			if (selection === authLabel) {
				this.runAuthInTerminal()
			}
		})
	}

	private buildAuthReminderMessage(message?: string): string {
		const reminder = t("kilocode:agentManager.terminal.authReminder")
		const base = message || ""
		return base ? `${base}\n\n${reminder}` : reminder
	}

	private handleStartSessionApiFailure(error: { message?: string; authError?: boolean }): void {
		const message =
			error.authError === true
				? this.buildAuthReminderMessage(error.message || t("kilocode:agentManager.errors.sessionFailed"))
				: error.message || t("kilocode:agentManager.errors.sessionFailed")
		if (error.authError && message && message === this.lastAuthErrorMessage) {
			return
		}

		const authLabel = error.authError ? t("kilocode:agentManager.actions.loginCli") : undefined
		const actions = authLabel ? [authLabel] : []
		void vscode.window.showWarningMessage(message, ...actions).then((selection) => {
			if (selection === authLabel) {
				this.runAuthInTerminal()
			}
		})
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

	/**
	 * Open a terminal and run the local CLI install command.
	 * This installs the CLI to ~/.kilocode/cli/pkg for systems that don't support global installation (e.g., NixOS).
	 * Also adds the local bin directory to the user's PATH in their shell configuration and sources it immediately.
	 */
	private runLocalInstallInTerminal(): void {
		const shellPath = process.platform === "win32" ? undefined : process.env.SHELL
		const shellName = shellPath ? path.basename(shellPath) : undefined
		const shellArgs = process.platform === "win32" ? undefined : shellName === "zsh" ? ["-l", "-i"] : ["-l"]

		const terminal = vscode.window.createTerminal({
			name: "Install Kilocode CLI (Local)",
			message: "Installing Kilocode CLI locally to ~/.kilocode/cli/pkg",
			shellPath,
			shellArgs,
		})
		terminal.show()

		const binDir = getLocalCliBinDir()

		// Build command as array and join with && for sequential execution
		if (process.platform === "win32") {
			// Windows: Chain commands with && to ensure they run sequentially
			const psCommand = `$binDir = "${binDir.replace(/\\/g, "\\\\")}"; $currentPath = [Environment]::GetEnvironmentVariable("Path", "User"); if ($currentPath -notlike "*$binDir*") { [Environment]::SetEnvironmentVariable("Path", "$binDir;$currentPath", "User"); Write-Host "Added $binDir to user PATH"; $env:Path = "$binDir;$env:Path"; Write-Host "PATH updated in current session" } else { Write-Host "$binDir already in PATH" }`

			const commands = [
				getLocalCliInstallCommand(),
				`powershell -Command "${psCommand}"`,
				"echo.",
				"echo ✓ CLI installed locally and PATH updated!",
				"echo.",
				"echo Next step: Run 'kilocode auth' to authenticate",
			]
			terminal.sendText(commands.join(" && "))
		} else {
			// Unix: Chain commands with && to ensure they run sequentially
			const exportLine = `export PATH="${binDir}:$PATH"`

			// Determine the shell config file based on the shell
			let configFile = "~/.bashrc"
			let pathCommand = `grep -qxF '${exportLine}' ${configFile} || echo '${exportLine}' >> ${configFile}`
			let sourceCommand = `source ${configFile}`

			if (shellName === "zsh") {
				configFile = "~/.zshrc"
				pathCommand = `grep -qxF '${exportLine}' ${configFile} || echo '${exportLine}' >> ${configFile}`
				sourceCommand = `source ${configFile}`
			} else if (shellName === "fish") {
				// Fish uses a different syntax for PATH
				configFile = "~/.config/fish/config.fish"
				const fishPathLine = `fish_add_path ${binDir}`
				pathCommand = `grep -qxF '${fishPathLine}' ${configFile} || echo '${fishPathLine}' >> ${configFile}`
				sourceCommand = `source ${configFile}`
			}

			const commands = [
				"clear",
				getLocalCliInstallCommand(),
				'echo ""',
				'echo "✓ CLI installed locally"',
				'echo ""',
				pathCommand,
				sourceCommand,
				`echo "Added ${binDir} to PATH and reloaded config"`,
				'echo ""',
				"echo \"Next step: Run 'kilocode auth' to authenticate\"",
				"echo \"Alternatively, run '~/.kilocode/cli/pkg/node_modules/.bin/kilocode auth' to authenticate if not in PATH\"",
			]
			terminal.sendText(commands.join(" ; "))
		}
	}

	/**
	 * Open a terminal and run the local CLI update command.
	 * This updates the CLI in ~/.kilocode/cli/pkg for systems using local installation.
	 */
	private runLocalUpdateInTerminal(): void {
		const shellPath = process.platform === "win32" ? undefined : process.env.SHELL
		const shellName = shellPath ? path.basename(shellPath) : undefined
		const shellArgs = process.platform === "win32" ? undefined : shellName === "zsh" ? ["-l", "-i"] : ["-l"]

		const terminal = vscode.window.createTerminal({
			name: "Update Kilocode CLI (Local)",
			message: "Updating Kilocode CLI in ~/.kilocode/cli/pkg",
			shellPath,
			shellArgs,
		})
		terminal.show()

		// Update the CLI (npm install will update if already installed)
		const commands = [
			"clear",
			getLocalCliInstallCommand(),
			'echo ""',
			'echo "✓ CLI updated successfully!"',
			'echo ""',
			'echo "The updated CLI is ready to use"',
		]
		terminal.sendText(commands.join(" && "))
	}

	private showCliError(error?: { type: "cli_outdated" | "spawn_error" | "unknown"; message: string }): void {
		const hasNpm = canInstallCli((msg) => this.outputChannel.appendLine(`[AgentManager] ${msg}`))

		switch (error?.type) {
			case "cli_outdated":
				if (hasNpm) {
					// Offer to update via terminal (global or local)
					const updateGlobal = t("kilocode:agentManager.actions.updateGlobal")
					const updateLocal = t("kilocode:agentManager.actions.updateLocal")
					const manualUpdate = t("kilocode:agentManager.actions.updateInstructions")
					vscode.window
						.showWarningMessage(
							t("kilocode:agentManager.errors.cliOutdated"),
							updateGlobal,
							updateLocal,
							manualUpdate,
						)
						.then((selection) => {
							if (selection === updateGlobal) {
								this.runInstallInTerminal()
							} else if (selection === updateLocal) {
								this.runLocalUpdateInTerminal()
							} else if (selection === manualUpdate) {
								void vscode.env.openExternal(vscode.Uri.parse("https://kilo.ai/docs/cli"))
							}
						})
				} else {
					// No npm available, show manual instructions
					const actionLabel = t("kilocode:agentManager.actions.updateInstructions")
					vscode.window
						.showErrorMessage(t("kilocode:agentManager.errors.cliOutdated"), actionLabel)
						.then((selection) => {
							if (selection === actionLabel) {
								void vscode.env.openExternal(vscode.Uri.parse("https://kilo.ai/docs/cli"))
							}
						})
				}
				break
			case "spawn_error": {
				if (hasNpm) {
					// Offer to install via terminal (global or local)
					const installGlobal = t("kilocode:agentManager.actions.installGlobal")
					const installLocal = t("kilocode:agentManager.actions.installLocal")
					const manualInstall = t("kilocode:agentManager.actions.installInstructions")
					vscode.window
						.showErrorMessage(
							t("kilocode:agentManager.errors.cliNotFound"),
							installGlobal,
							installLocal,
							manualInstall,
						)
						.then((selection) => {
							if (selection === installGlobal) {
								this.runInstallInTerminal()
							} else if (selection === installLocal) {
								this.runLocalInstallInTerminal()
							} else if (selection === manualInstall) {
								void vscode.env.openExternal(vscode.Uri.parse("https://kilo.ai/docs/cli"))
							}
						})
				} else {
					// No npm available, show manual instructions
					const actionLabel = t("kilocode:agentManager.actions.installInstructions")
					vscode.window
						.showErrorMessage(t("kilocode:agentManager.errors.cliNotFound"), actionLabel)
						.then((selection) => {
							if (selection === actionLabel) {
								void vscode.env.openExternal(vscode.Uri.parse("https://kilo.ai/docs/cli"))
							}
						})
				}
				break
			}
			default: {
				const errorMessage = error?.message
					? t("kilocode:agentManager.errors.sessionFailedWithMessage", { message: error.message })
					: t("kilocode:agentManager.errors.sessionFailed")
				const actionLabel = t("kilocode:agentManager.actions.getHelp")
				vscode.window.showErrorMessage(errorMessage, actionLabel).then((selection) => {
					if (selection === actionLabel) {
						void vscode.env.openExternal(vscode.Uri.parse("https://kilo.ai/docs/cli"))
					}
				})
				break
			}
		}
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
