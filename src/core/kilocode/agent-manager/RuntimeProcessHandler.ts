/**
 * RuntimeProcessHandler - Spawns agent processes using @kilocode/agent-runtime
 *
 * This handler uses Node.js fork() to spawn agent-runtime processes instead of
 * the CLI. Communication is via Node.js IPC (process.send/process.on('message'))
 * instead of stdin/stdout JSON.
 *
 * Key benefits:
 * - No CLI installation required
 * - More reliable IPC (Node.js native vs JSON parsing)
 * - Full process isolation per agent
 * - Configuration passed directly, no args building
 */

import { fork, type ChildProcess, type Serializable } from "node:child_process"
import * as path from "node:path"
import { AgentRegistry } from "./AgentRegistry"
import type {
	StreamEvent,
	KilocodeStreamEvent,
	SessionCreatedStreamEvent,
	KilocodePayload,
	ErrorStreamEvent,
	CompleteStreamEvent,
} from "./CliOutputParser"
import type { ClineMessage, ProviderSettings } from "@roo-code/types"
import { Package } from "../../../shared/package"

/**
 * Timeout for pending sessions (ms) - if "ready" message doesn't arrive within this time,
 * the session is considered failed.
 */
const PENDING_SESSION_TIMEOUT_MS = 30_000

/**
 * IPC messages from the agent process
 */
interface AgentIPCMessage {
	type: "ready" | "message" | "stateChange" | "error" | "warning" | "log"
	payload?: unknown
	state?: unknown
	error?: { message: string; stack?: string; context?: string }
	level?: string
	message?: string
	context?: string
	meta?: Record<string, unknown>
}

/**
 * IPC messages to the agent process
 */
interface ParentIPCMessage {
	type: "sendMessage" | "shutdown" | "injectConfig"
	payload?: unknown
}

/**
 * Tracks a pending session while waiting for agent's "ready" message
 */
interface PendingProcessInfo {
	process: ChildProcess
	prompt: string
	startTime: number
	parallelMode?: boolean
	desiredSessionId?: string
	desiredLabel?: string
	worktreeInfo?: { branch: string; path: string; parentBranch: string }
	provisionalSessionId?: string
	sawApiReqStarted?: boolean
	gitUrl?: string
	timeoutId?: NodeJS.Timeout
	model?: string
	images?: string[]
}

interface ActiveProcessInfo {
	process: ChildProcess
	sessionId: string
}

export interface RuntimeProcessHandlerCallbacks {
	onLog: (message: string) => void
	onDebugLog?: (message: string) => void
	onSessionLog: (sessionId: string, line: string) => void
	onStateChanged: () => void
	onPendingSessionChanged: (pendingSession: { prompt: string; label: string; startTime: number } | null) => void
	onStartSessionFailed: (
		error?:
			| { type: "spawn_error" | "unknown"; message: string }
			| { type: "api_req_failed"; message: string; payload?: KilocodePayload; authError?: boolean }
			| { type: "payment_required"; message: string; payload?: KilocodePayload },
	) => void
	onChatMessages: (sessionId: string, messages: ClineMessage[]) => void
	onSessionCreated: (sawApiReqStarted: boolean) => void
	onSessionRenamed?: (oldId: string, newId: string) => void
	onPaymentRequiredPrompt?: (payload: KilocodePayload) => void
	onSessionCompleted?: (sessionId: string, exitCode: number | null) => void
}

export class RuntimeProcessHandler {
	private activeSessions: Map<string, ActiveProcessInfo> = new Map()
	private pendingProcess: PendingProcessInfo | null = null
	// Track whether we've sent api_req_started for each session
	private sentApiReqStarted: Set<string> = new Set()
	// VS Code app root path for finding bundled binaries
	private vscodeAppRoot?: string

	constructor(
		private readonly registry: AgentRegistry,
		private readonly callbacks: RuntimeProcessHandlerCallbacks,
		private readonly extensionPath?: string,
		vscodeAppRoot?: string,
	) {
		this.vscodeAppRoot = vscodeAppRoot
	}

	// Debug logging disabled for performance - re-enable if needed for debugging
	// private debugLog(message: string): void {
	// 	this.callbacks.onDebugLog?.(message)
	// }

	private clearPendingTimeout(): void {
		if (this.pendingProcess?.timeoutId) {
			clearTimeout(this.pendingProcess.timeoutId)
		}
	}

	/**
	 * Filter out control messages that should not be displayed in the chat.
	 * - ask:completion_result: Control message for state machine, renders as empty "Kilo said"
	 */
	private filterDisplayableMessages(messages: ClineMessage[]): ClineMessage[] {
		return messages.filter((msg) => {
			// Filter out ask:completion_result - it's a control message for the state machine
			if (msg.type === "ask" && msg.ask === "completion_result") {
				return false
			}
			return true
		})
	}

	/**
	 * Resolve the path to the agent-runtime process entry point.
	 *
	 * In production (VSIX), the agent-runtime process is bundled by esbuild into
	 * dist/agent-runtime-process.js as a self-contained CJS bundle.
	 * In development, we use either require.resolve or the monorepo path.
	 */
	private getProcessEntryPath(): string {
		const fs = require("fs")

		// Production: Check for bundled file in extension's dist directory
		// The esbuild config bundles agent-runtime/src/process.ts to dist/agent-runtime-process.js
		if (this.extensionPath) {
			const productionPath = path.join(this.extensionPath, "dist", "agent-runtime-process.js")
			if (fs.existsSync(productionPath)) {
				this.callbacks.onLog(`Using production agent-runtime process: ${productionPath}`)
				return productionPath
			}
		}

		// Development: Try require.resolve for workspace dependency
		try {
			const entryPath = require.resolve("@kilocode/agent-runtime/process")
			return entryPath
		} catch {
			// Fallback: use relative path from monorepo root (development only)
			if (this.extensionPath) {
				// Extension path points to 'src' directory, go up one level to monorepo root
				const monorepoRoot = path.dirname(this.extensionPath)
				const devPath = path.join(monorepoRoot, "packages/agent-runtime/dist/process.js")
				if (fs.existsSync(devPath)) {
					return devPath
				}
			}

			// Last resort: compute from __dirname (may not work in all environments)
			const extensionRoot = path.resolve(__dirname, "../../../..")
			return path.join(extensionRoot, "packages/agent-runtime/dist/process.js")
		}
	}

	/**
	 * Build agent configuration from spawn options
	 */
	private buildAgentConfig(
		workspace: string,
		prompt: string,
		options?: {
			parallelMode?: boolean
			sessionId?: string
			label?: string
			gitUrl?: string
			apiConfiguration?: ProviderSettings
			worktreeInfo?: { branch: string; path: string; parentBranch: string }
			model?: string
			images?: string[]
			autoApprove?: boolean
		},
	): Record<string, unknown> {
		const config: Record<string, unknown> = {
			workspace,
			providerSettings: options?.apiConfiguration || {},
			mode: "code",
			autoApprove: options?.autoApprove ?? true, // Default to auto-approve for agent manager
			sessionId: options?.sessionId,
		}

		// Add model override if specified
		if (options?.model) {
			// Model is typically set via providerSettings
			if (config.providerSettings && typeof config.providerSettings === "object") {
				;(config.providerSettings as Record<string, unknown>).kilocodeModel = options.model
			}
		}

		// Add VS Code app root for finding bundled binaries (ripgrep, etc.)
		if (this.vscodeAppRoot) {
			config.vscodeAppRoot = this.vscodeAppRoot
		}

		// Add extension paths - required because the bundled agent-runtime process
		// can't use import.meta.url to auto-resolve paths in CJS format
		if (this.extensionPath) {
			config.extensionRootPath = this.extensionPath
			config.extensionBundlePath = path.join(this.extensionPath, "dist", "extension.js")
		}

		// Set appName to identify this as an agent-manager spawned process
		// Format: wrapper|<source>|<type>|<version>
		config.appName = `wrapper|agent-manager|cli|${Package.version}`

		return config
	}

	/**
	 * Spawn an agent process using fork()
	 *
	 * Note: cliPath parameter is accepted for CliProcessHandler compatibility but is ignored.
	 * RuntimeProcessHandler uses agent-runtime fork() instead of CLI spawn().
	 */
	public spawnProcess(
		_cliPath: string,
		workspace: string,
		prompt: string,
		options:
			| {
					parallelMode?: boolean
					sessionId?: string
					label?: string
					gitUrl?: string
					apiConfiguration?: ProviderSettings
					existingBranch?: string
					shellPath?: string // Ignored - for CliProcessHandler compatibility
					worktreeInfo?: { branch: string; path: string; parentBranch: string }
					model?: string
					images?: string[]
			  }
			| undefined,
		onEvent: (sessionId: string, event: StreamEvent) => void,
	): void {
		const isResume = !!options?.sessionId

		if (isResume) {
			const existingSession = this.registry.getSession(options!.sessionId!)
			if (existingSession) {
				this.registry.updateSessionStatus(options!.sessionId!, "creating")
			} else {
				this.registry.createSession(options!.sessionId!, prompt, Date.now(), {
					parallelMode: options?.parallelMode,
					labelOverride: options?.label,
					gitUrl: options?.gitUrl,
					model: options?.model,
				})
				this.registry.updateSessionStatus(options!.sessionId!, "creating")
			}

			// Update parallel mode info for resumed sessions if worktree info is provided
			// (e.g., when worktree was recreated during resume)
			if (options?.worktreeInfo) {
				this.registry.updateParallelModeInfo(options!.sessionId!, {
					branch: options.worktreeInfo.branch,
					worktreePath: options.worktreeInfo.path,
					parentBranch: options.worktreeInfo.parentBranch,
				})
				this.debugLog(
					`Updated parallel mode info for resumed session ${options!.sessionId}: branch=${options.worktreeInfo.branch}`,
				)
			}

			this.debugLog(`Resuming session ${options!.sessionId}, setting to creating state`)
			this.callbacks.onStateChanged()
		} else {
			const pendingSession = this.registry.setPendingSession(prompt, {
				parallelMode: options?.parallelMode,
				gitUrl: options?.gitUrl,
			})
			this.debugLog(`Pending session created, waiting for agent ready signal`)
			this.callbacks.onPendingSessionChanged(pendingSession)
		}

		// Build agent configuration
		const agentConfig = this.buildAgentConfig(workspace, prompt, options)

		// Get process entry point path
		const entryPath = this.getProcessEntryPath()
		this.debugLog(`Forking agent process from: ${entryPath}`)

		try {
			// Fork the agent-runtime process
			const proc = fork(entryPath, [], {
				cwd: workspace,
				env: {
					...process.env,
					AGENT_CONFIG: JSON.stringify(agentConfig),
					NO_COLOR: "1",
					FORCE_COLOR: "0",
				},
				stdio: ["pipe", "pipe", "pipe", "ipc"],
				detached: false,
			})

			// Store pending process info
			this.pendingProcess = {
				process: proc,
				prompt,
				startTime: Date.now(),
				parallelMode: options?.parallelMode,
				desiredSessionId: options?.sessionId,
				desiredLabel: options?.label,
				worktreeInfo: options?.worktreeInfo,
				gitUrl: options?.gitUrl,
				model: options?.model,
				images: options?.images,
			}

			// Set up timeout for pending session
			this.pendingProcess.timeoutId = setTimeout(() => {
				if (this.pendingProcess?.process === proc) {
					this.callbacks.onLog(`Agent session timed out after ${PENDING_SESSION_TIMEOUT_MS}ms`)
					this.handleSessionTimeout(proc, onEvent)
				}
			}, PENDING_SESSION_TIMEOUT_MS)

			// Handle IPC messages from agent
			proc.on("message", (msg: Serializable) => {
				this.handleAgentMessage(proc, msg as AgentIPCMessage, onEvent)
			})

			// Handle process exit
			proc.on("exit", (code, signal) => {
				this.handleProcessExit(proc, code, signal, onEvent)
			})

			// Handle process errors
			proc.on("error", (error) => {
				this.handleProcessError(proc, error)
			})

			// Capture stderr for debugging
			proc.stderr?.on("data", (data: Buffer) => {
				const stderr = data.toString()
				this.debugLog(`Agent stderr: ${stderr}`)
			})

			// Capture stdout for debugging (should be minimal since we use IPC)
			proc.stdout?.on("data", (data: Buffer) => {
				const stdout = data.toString()
				this.debugLog(`Agent stdout: ${stdout}`)
			})
		} catch (error) {
			this.callbacks.onLog(`Failed to fork agent process: ${error}`)
			this.callbacks.onStartSessionFailed({
				type: "spawn_error",
				message: `Failed to start agent: ${error instanceof Error ? error.message : String(error)}`,
			})

			// Clean up pending state
			this.registry.clearPendingSession()
			this.callbacks.onPendingSessionChanged(null)
		}
	}

	/**
	 * Handle IPC message from agent process
	 */
	private handleAgentMessage(
		proc: ChildProcess,
		msg: AgentIPCMessage,
		onEvent: (sessionId: string, event: StreamEvent) => void,
	): void {
		const sessionId = this.getSessionIdForProcess(proc)
		this.debugLog(`[IPC IN] Agent message: type=${msg.type}, sessionId=${sessionId || "pending"}`)

		switch (msg.type) {
			case "ready":
				this.handleAgentReady(proc, onEvent)
				break

			case "message":
				this.handleExtensionMessage(proc, msg.payload, onEvent)
				break

			case "stateChange":
				this.handleStateChange(proc, msg.state, onEvent)
				break

			case "error":
				this.handleAgentError(proc, msg.error, onEvent)
				break

			case "warning":
				this.debugLog(`Agent warning: ${msg.error?.message}`)
				break

			case "log":
				this.handleAgentLog(proc, msg)
				break

			default:
				this.debugLog(`Unknown agent message type: ${msg.type}`)
		}
	}

	/**
	 * Handle agent "ready" message - similar to session_created
	 */
	private handleAgentReady(proc: ChildProcess, onEvent: (sessionId: string, event: StreamEvent) => void): void {
		if (!this.pendingProcess || this.pendingProcess.process !== proc) {
			return
		}

		this.clearPendingTimeout()

		// Generate or use provided session ID
		const sessionId = this.pendingProcess.desiredSessionId || this.generateSessionId()
		const prompt = this.pendingProcess.prompt

		this.debugLog(`Agent ready, creating session: ${sessionId}`)

		// Create the session in registry
		this.registry.createSession(sessionId, prompt, Date.now(), {
			parallelMode: this.pendingProcess.parallelMode,
			labelOverride: this.pendingProcess.desiredLabel,
			gitUrl: this.pendingProcess.gitUrl,
			model: this.pendingProcess.model,
		})
		this.registry.updateSessionStatus(sessionId, "running")

		// Update parallel mode info with worktree details if available
		if (this.pendingProcess.worktreeInfo) {
			this.registry.updateParallelModeInfo(sessionId, {
				branch: this.pendingProcess.worktreeInfo.branch,
				worktreePath: this.pendingProcess.worktreeInfo.path,
				parentBranch: this.pendingProcess.worktreeInfo.parentBranch,
			})
			this.debugLog(
				`Updated parallel mode info for session ${sessionId}: branch=${this.pendingProcess.worktreeInfo.branch}, path=${this.pendingProcess.worktreeInfo.path}`,
			)
		}

		// Capture data before clearing pendingProcess
		const images = this.pendingProcess.images
		const capturedPrompt = this.pendingProcess.prompt

		// Move to active sessions
		this.activeSessions.set(sessionId, {
			process: proc,
			sessionId,
		})

		// Clear pending state
		this.registry.clearPendingSession()
		this.pendingProcess = null

		this.callbacks.onStateChanged()
		this.callbacks.onPendingSessionChanged(null)
		this.callbacks.onSessionCreated(false)

		// Send session_created event
		const sessionCreatedEvent: SessionCreatedStreamEvent = {
			streamEventType: "session_created",
			sessionId: sessionId,
			timestamp: Date.now(),
		}
		onEvent(sessionId, sessionCreatedEvent)

		// Send the initial task message
		this.sendMessage(sessionId, {
			type: "newTask",
			text: capturedPrompt,
			images: images,
		})
	}

	/**
	 * Handle extension message from agent
	 */
	private handleExtensionMessage(
		proc: ChildProcess,
		payload: unknown,
		onEvent: (sessionId: string, event: StreamEvent) => void,
	): void {
		const sessionId = this.getSessionIdForProcess(proc)
		if (!sessionId) {
			this.debugLog(`Received message from unknown process`)
			return
		}

		// Convert extension message to StreamEvent
		const extMsg = payload as {
			type: string
			state?: unknown
			chatMessages?: ClineMessage[]
			[key: string]: unknown
		}

		this.debugLog(
			`Extension message type: ${extMsg.type}, hasState: ${!!extMsg.state}, hasChatMessages: ${!!extMsg.chatMessages}`,
		)

		if (extMsg.type === "state" && extMsg.state) {
			// State update - extract chat messages if present
			const state = extMsg.state as { chatMessages?: ClineMessage[]; clineMessages?: ClineMessage[] }
			// Handle both property names - extension uses clineMessages internally
			const chatMessages = state.chatMessages || state.clineMessages
			if (chatMessages && chatMessages.length > 0) {
				// Filter out control messages that shouldn't be displayed
				const filteredMessages = this.filterDisplayableMessages(chatMessages)

				this.debugLog(
					`Forwarding ${filteredMessages.length} chat messages to webview (filtered ${chatMessages.length - filteredMessages.length})`,
				)
				// Log the last message to see what's being sent
				const lastMsg = filteredMessages[filteredMessages.length - 1]
				this.debugLog(
					`Last message: type=${lastMsg?.type}, say=${lastMsg?.say}, text=${lastMsg?.text?.slice(0, 100)}...`,
				)

				// Send api_req_started the first time we get actual content
				// The webview state machine needs this to transition from "creating" to "streaming"
				if (!this.sentApiReqStarted.has(sessionId)) {
					this.debugLog(`Sending api_req_started state event for session ${sessionId}`)
					this.sentApiReqStarted.add(sessionId)
					const stateEvent: KilocodeStreamEvent = {
						streamEventType: "kilocode",
						payload: {
							ts: Date.now(),
							type: "say",
							say: "api_req_started",
						},
					}
					onEvent(sessionId, stateEvent)
				}

				this.callbacks.onChatMessages(sessionId, filteredMessages)
			} else {
				this.debugLog(`State message has no chatMessages or clineMessages`)
			}
		}

		// Convert to kilocode event for compatibility
		if (extMsg.chatMessages || extMsg.state) {
			const kilocodeEvent: KilocodeStreamEvent = {
				streamEventType: "kilocode",
				payload: {
					ts: Date.now(),
					say: extMsg.type === "state" ? "text" : undefined,
					text: JSON.stringify(extMsg),
				},
			}
			onEvent(sessionId, kilocodeEvent)
		}
	}

	/**
	 * Handle state change from agent
	 */
	private handleStateChange(
		proc: ChildProcess,
		state: unknown,
		onEvent: (sessionId: string, event: StreamEvent) => void,
	): void {
		const sessionId = this.getSessionIdForProcess(proc)
		if (!sessionId) {
			this.debugLog(`State change from unknown process`)
			return
		}

		const stateObj = state as { chatMessages?: ClineMessage[]; clineMessages?: ClineMessage[] }
		// Handle both property names - extension uses clineMessages internally
		const chatMessages = stateObj.chatMessages || stateObj.clineMessages
		if (chatMessages) {
			// Filter out control messages that shouldn't be displayed
			const filteredMessages = this.filterDisplayableMessages(chatMessages)
			this.debugLog(
				`State change: forwarding ${filteredMessages.length} chat messages (filtered ${chatMessages.length - filteredMessages.length})`,
			)
			this.callbacks.onChatMessages(sessionId, filteredMessages)
		} else {
			this.debugLog(`State change has no chatMessages or clineMessages`)
		}
	}

	/**
	 * Handle agent error
	 */
	private handleAgentError(
		proc: ChildProcess,
		error: { message: string; stack?: string; context?: string } | undefined,
		onEvent: (sessionId: string, event: StreamEvent) => void,
	): void {
		const sessionId = this.getSessionIdForProcess(proc)
		const errorMsg = error?.message || "Unknown agent error"

		this.callbacks.onLog(`Agent error: ${errorMsg}`)

		if (this.pendingProcess?.process === proc) {
			// Error during session creation
			this.clearPendingTimeout()
			this.callbacks.onStartSessionFailed({
				type: "spawn_error",
				message: errorMsg,
			})
			this.registry.clearPendingSession()
			this.pendingProcess = null
			this.callbacks.onPendingSessionChanged(null)
		} else if (sessionId) {
			// Error in active session
			const errorEvent: ErrorStreamEvent = {
				streamEventType: "error",
				error: errorMsg,
				timestamp: new Date().toISOString(),
			}
			onEvent(sessionId, errorEvent)
		}
	}

	/**
	 * Handle agent log message
	 */
	private handleAgentLog(proc: ChildProcess, msg: AgentIPCMessage): void {
		const sessionId = this.getSessionIdForProcess(proc)
		const logMsg = `[${msg.level}] ${msg.context || "Agent"}: ${msg.message}`

		// Always log to debug output for visibility
		this.debugLog(logMsg)

		if (sessionId) {
			this.callbacks.onSessionLog(sessionId, logMsg)
		}
	}

	/**
	 * Handle session timeout
	 */
	private handleSessionTimeout(proc: ChildProcess, onEvent: (sessionId: string, event: StreamEvent) => void): void {
		this.callbacks.onStartSessionFailed({
			type: "unknown",
			message: "Agent session timed out waiting for ready signal",
		})

		// Kill the process
		proc.kill("SIGTERM")

		// Clean up pending state
		this.registry.clearPendingSession()
		this.pendingProcess = null
		this.callbacks.onPendingSessionChanged(null)
	}

	/**
	 * Handle process exit
	 */
	private handleProcessExit(
		proc: ChildProcess,
		code: number | null,
		signal: string | null,
		onEvent: (sessionId: string, event: StreamEvent) => void,
	): void {
		const sessionId = this.getSessionIdForProcess(proc)

		this.debugLog(`Agent process exited: code=${code}, signal=${signal}`)

		if (this.pendingProcess?.process === proc) {
			// Exit during pending state
			this.clearPendingTimeout()
			this.callbacks.onStartSessionFailed({
				type: "unknown",
				message: `Agent process exited unexpectedly (code: ${code}, signal: ${signal})`,
			})
			this.registry.clearPendingSession()
			this.pendingProcess = null
			this.callbacks.onPendingSessionChanged(null)
		} else if (sessionId) {
			// Exit of active session
			this.activeSessions.delete(sessionId)
			this.sentApiReqStarted.delete(sessionId)

			// Update session status based on exit code
			if (code === 0) {
				this.registry.updateSessionStatus(sessionId, "done")
			} else if (signal === "SIGTERM" || signal === "SIGINT" || signal === "SIGKILL") {
				this.registry.updateSessionStatus(sessionId, "stopped")
			} else {
				this.registry.updateSessionStatus(sessionId, "error")
			}

			this.callbacks.onStateChanged()
			this.callbacks.onSessionCompleted?.(sessionId, code)

			// Send complete event
			const completeEvent: CompleteStreamEvent = {
				streamEventType: "complete",
				exitCode: code ?? -1,
				sessionId: sessionId,
			}
			onEvent(sessionId, completeEvent)
		}
	}

	/**
	 * Handle process spawn error
	 */
	private handleProcessError(proc: ChildProcess, error: Error): void {
		this.callbacks.onLog(`Agent process error: ${error.message}`)

		if (this.pendingProcess?.process === proc) {
			this.clearPendingTimeout()
			this.callbacks.onStartSessionFailed({
				type: "spawn_error",
				message: error.message,
			})
			this.registry.clearPendingSession()
			this.pendingProcess = null
			this.callbacks.onPendingSessionChanged(null)
		}
	}

	/**
	 * Get session ID for a process
	 */
	private getSessionIdForProcess(proc: ChildProcess): string | undefined {
		for (const [sessionId, info] of this.activeSessions) {
			if (info.process === proc) {
				return sessionId
			}
		}
		return undefined
	}

	/**
	 * Generate a unique session ID
	 */
	private generateSessionId(): string {
		const timestamp = Date.now()
		const random = Math.random().toString(36).substring(2, 8)
		return `agent_${timestamp}_${random}`
	}

	/**
	 * Send a message to an active session
	 */
	public sendMessage(sessionId: string, message: unknown): Promise<void> {
		const info = this.activeSessions.get(sessionId)
		if (!info) {
			return Promise.reject(new Error(`No active session: ${sessionId}`))
		}

		const ipcMessage: ParentIPCMessage = {
			type: "sendMessage",
			payload: message,
		}

		return new Promise((resolve, reject) => {
			info.process.send(ipcMessage, (error) => {
				if (error) {
					reject(error)
				} else {
					resolve()
				}
			})
		})
	}

	/**
	 * Stop a session by ID
	 */
	public stopProcess(sessionId: string): void {
		const info = this.activeSessions.get(sessionId)
		if (info) {
			// Send shutdown message first for graceful termination
			const shutdownMsg: ParentIPCMessage = { type: "shutdown" }
			info.process.send(shutdownMsg)

			// Force kill after timeout
			setTimeout(() => {
				if (info.process.exitCode === null) {
					info.process.kill("SIGKILL")
				}
			}, 5000)
		}
	}

	/**
	 * Terminate a process gracefully
	 */
	public terminateProcess(sessionId: string): void {
		const info = this.activeSessions.get(sessionId)
		if (info && info.process.exitCode === null) {
			// Try graceful shutdown first
			const shutdownMsg: ParentIPCMessage = { type: "shutdown" }
			info.process.send(shutdownMsg)

			setTimeout(() => {
				if (info.process.exitCode === null) {
					info.process.kill("SIGTERM")
				}
			}, 1000)
		}
	}

	/**
	 * Stop all active processes
	 */
	public stopAllProcesses(): void {
		// Stop pending process
		if (this.pendingProcess) {
			this.clearPendingTimeout()
			this.pendingProcess.process.kill("SIGTERM")
			this.pendingProcess = null
		}

		// Stop all active sessions
		for (const [sessionId, info] of this.activeSessions) {
			if (info.process.exitCode === null) {
				info.process.kill("SIGTERM")
			}
		}
		this.activeSessions.clear()
	}

	/**
	 * Cancel a pending session
	 */
	public cancelPendingSession(): void {
		if (this.pendingProcess) {
			this.clearPendingTimeout()
			this.pendingProcess.process.kill("SIGTERM")
			this.registry.clearPendingSession()
			this.pendingProcess = null
			this.callbacks.onPendingSessionChanged(null)
		}
	}

	/**
	 * Check if a session has an active process
	 */
	public hasActiveProcess(sessionId: string): boolean {
		return this.activeSessions.has(sessionId)
	}

	/**
	 * Get count of active sessions
	 */
	public getActiveSessionCount(): number {
		return this.activeSessions.size
	}

	/**
	 * Check if there's a pending session
	 */
	public hasPendingSession(): boolean {
		return this.pendingProcess !== null
	}

	/**
	 * Alias for hasActiveProcess - for CliProcessHandler compatibility
	 */
	public hasProcess(sessionId: string): boolean {
		return this.hasActiveProcess(sessionId)
	}

	/**
	 * Alias for hasPendingSession - for CliProcessHandler compatibility
	 */
	public hasPendingProcess(): boolean {
		return this.hasPendingSession()
	}

	/**
	 * Write to stdin - for CliProcessHandler compatibility
	 * In RuntimeProcessHandler, this sends via IPC instead of stdin
	 */
	public async writeToStdin(sessionId: string, message: object): Promise<void> {
		return this.sendMessage(sessionId, message)
	}

	/**
	 * Check if session has stdin available - for CliProcessHandler compatibility
	 * In RuntimeProcessHandler, we use IPC so this always returns true for active sessions
	 */
	public hasStdin(sessionId: string): boolean {
		return this.hasActiveProcess(sessionId)
	}

	/**
	 * Dispose all resources
	 */
	public dispose(): void {
		this.stopAllProcesses()
	}
}
