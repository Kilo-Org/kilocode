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
import { CliProcessHandler, type CliProcessHandlerCallbacks } from "./CliProcessHandler"
import type { StreamEvent, KilocodeStreamEvent, KilocodePayload, WelcomeStreamEvent } from "./CliOutputParser"
import { RemoteSessionService } from "./RemoteSessionService"
import { KilocodeEventProcessor } from "./KilocodeEventProcessor"
import type { RemoteSession } from "./types"
import { getUri } from "../../webview/getUri"
import { getNonce } from "../../webview/getNonce"
import { getViteDevServerConfig } from "../../webview/getViteDevServerConfig"
import { getRemoteUrl } from "../../../services/code-index/managed/git-utils"
import { normalizeGitUrl } from "./normalizeGitUrl"
import type { ClineMessage } from "@roo-code/types"

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

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly outputChannel: vscode.OutputChannel,
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
				}
			},
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
					void this.startAgentSession(message.prompt as string, {
						parallelMode: message.parallelMode as boolean | undefined,
					})
					break
				case "agentManager.stopSession":
					this.stopAgentSession(message.sessionId as string)
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
				case "agentManager.selectSession":
					this.selectSession(message.sessionId as string | null)
					break
				case "agentManager.refreshRemoteSessions":
					void this.fetchAndPostRemoteSessions()
					break
				case "agentManager.refreshSessionMessages":
					void this.refreshSessionMessages(message.sessionId as string)
					break
			}
		} catch (error) {
			this.outputChannel.appendLine(`Error handling message: ${error}`)
		}
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
		options?: { parallelMode?: boolean; resumeSessionId?: string; resumeSessionLabel?: string },
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

		// Check if trying to use parallel mode from within a worktree
		if (options?.parallelMode && this.isInsideWorktree(workspaceFolder)) {
			this.outputChannel.appendLine("ERROR: Cannot use parallel mode from within a git worktree")
			void vscode.window.showErrorMessage(
				"Parallel mode cannot be used from within a git worktree. Please open the main repository to use this feature.",
			)
			this.postMessage({ type: "agentManager.startSessionFailed" })
			return
		}

		const cliPath = await findKilocodeCli((msg) => this.outputChannel.appendLine(`[AgentManager] ${msg}`))
		if (!cliPath) {
			this.outputChannel.appendLine("ERROR: kilocode CLI not found")
			this.showCliNotFoundError()
			this.postMessage({ type: "agentManager.startSessionFailed" })
			return
		}

		// Preserve existing label when resuming a session (prefer local, fallback to passed label)
		const existingLabel = options?.resumeSessionId
			? (this.registry.getSession(options.resumeSessionId)?.label ?? options.resumeSessionLabel)
			: undefined

		// Get git URL for the workspace (used for filtering sessions)
		let gitUrl: string | undefined
		try {
			gitUrl = normalizeGitUrl(await getRemoteUrl(workspaceFolder))
		} catch (error) {
			this.outputChannel.appendLine(
				`[AgentManager] Could not get git URL: ${error instanceof Error ? error.message : String(error)}`,
			)
		}

		this.processHandler.spawnProcess(
			cliPath,
			workspaceFolder,
			prompt,
			{
				parallelMode: options?.parallelMode,
				sessionId: options?.resumeSessionId,
				label: existingLabel,
				gitUrl,
			},
			(sessionId, event) => {
				this.handleCliEvent(sessionId, event)
			},
		)
	}

	/**
	 * Handle a JSON event from the CLI stdout
	 */
	private handleCliEvent(sessionId: string, event: StreamEvent): void {
		switch (event.streamEventType) {
			case "kilocode":
				this.handleKilocodeEvent(sessionId, event)
				break
			case "status":
				this.parseParallelModeStatus(sessionId, event.message)
				this.log(sessionId, event.message)
				break
			case "output":
				this.parseParallelModeOutput(sessionId, event.content)
				this.log(sessionId, `[${event.source}] ${event.content}`)
				break
			case "error":
				this.registry.updateSessionStatus(sessionId, "error", undefined, event.error)
				this.log(sessionId, `Error: ${event.error}`)
				if (event.details) {
					this.log(sessionId, `Details: ${JSON.stringify(event.details)}`)
				}
				break
			case "complete":
				this.registry.updateSessionStatus(sessionId, "done", event.exitCode)
				this.log(sessionId, "Agent completed")
				void this.fetchAndPostRemoteSessions()
				break
			case "interrupted":
				this.registry.updateSessionStatus(sessionId, "stopped", undefined, event.reason)
				this.log(sessionId, event.reason || "Execution interrupted")
				break
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
		this.processHandler.stopProcess(sessionId)

		this.registry.updateSessionStatus(sessionId, "stopped", undefined, "Stopped by user")
		this.log(sessionId, "Stopped by user")
		this.postStateToWebview()

		this.firstApiReqStarted.delete(sessionId)
	}

	/**
	 * Send a follow-up message to a running agent session via stdin.
	 * If the session is not running, starts a new session with the message.
	 */
	public async sendMessage(sessionId: string, content: string, sessionLabel?: string): Promise<void> {
		if (!this.processHandler.hasStdin(sessionId)) {
			// Session is not running - start (or restore) a session with this message as continuation
			this.outputChannel.appendLine(`[AgentManager] Session ${sessionId} not running, starting new session`)
			const session = this.registry.getSession(sessionId)

			await this.startAgentSession(content, {
				parallelMode: session?.parallelMode?.enabled,
				resumeSessionId: session?.sessionId ?? sessionId,
				resumeSessionLabel: session?.label ?? sessionLabel,
			})
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

	private showCliNotFoundError(): void {
		this.showCliError({ type: "spawn_error", message: "CLI not found" })
	}

	private showCliError(error?: { type: "cli_outdated" | "spawn_error" | "unknown"; message: string }): void {
		let errorMessage: string
		let actionLabel: string

		switch (error?.type) {
			case "cli_outdated":
				errorMessage = t("kilocode:agentManager.errors.cliOutdated")
				actionLabel = t("kilocode:agentManager.actions.updateInstructions")
				break
			case "spawn_error":
				errorMessage = t("kilocode:agentManager.errors.cliNotFound")
				actionLabel = t("kilocode:agentManager.actions.installInstructions")
				break
			default:
				errorMessage = error?.message
					? t("kilocode:agentManager.errors.sessionFailedWithMessage", { message: error.message })
					: t("kilocode:agentManager.errors.sessionFailed")
				actionLabel = t("kilocode:agentManager.actions.getHelp")
				break
		}

		vscode.window.showErrorMessage(errorMessage, actionLabel).then((selection) => {
			if (selection === actionLabel) {
				void vscode.env.openExternal(vscode.Uri.parse("https://kilo.ai/docs/cli"))
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
