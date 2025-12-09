import { spawn, ChildProcess } from "node:child_process"
import {
	CliOutputParser,
	type StreamEvent,
	type SessionCreatedStreamEvent,
	type WelcomeStreamEvent,
	type KilocodeStreamEvent,
} from "./CliOutputParser"
import { AgentRegistry } from "./AgentRegistry"
import { buildCliArgs } from "./CliArgsBuilder"
import type { ClineMessage } from "@roo-code/types"

/**
 * Timeout for pending sessions (ms) - if session_created event doesn't arrive within this time,
 * the session is considered failed. This prevents the UI from getting stuck in "Creating session..." state.
 */
const PENDING_SESSION_TIMEOUT_MS = 30_000

/**
 * Tracks a pending session while waiting for CLI's session_created event.
 * Note: This is only used for NEW sessions. Resume sessions go directly to activeSessions.
 */
interface PendingProcessInfo {
	process: ChildProcess
	parser: CliOutputParser
	prompt: string
	startTime: number
	parallelMode?: boolean
	desiredSessionId?: string
	desiredLabel?: string
	worktreeBranch?: string // Captured from welcome event before session_created
	sawApiReqStarted?: boolean // Track if api_req_started arrived before session_created
	gitUrl?: string
	stderrBuffer: string[] // Capture stderr for error detection
	timeoutId?: NodeJS.Timeout // Timer for auto-failing stuck pending sessions
}

interface ActiveProcessInfo {
	process: ChildProcess
	parser: CliOutputParser
}

export interface CliProcessHandlerCallbacks {
	onLog: (message: string) => void
	onDebugLog?: (message: string) => void // Verbose logging, disabled in production
	onSessionLog: (sessionId: string, line: string) => void
	onStateChanged: () => void
	onPendingSessionChanged: (pendingSession: { prompt: string; label: string; startTime: number } | null) => void
	onStartSessionFailed: (error?: { type: "cli_outdated" | "spawn_error" | "unknown"; message: string }) => void
	onChatMessages: (sessionId: string, messages: ClineMessage[]) => void
	onSessionCreated: (sawApiReqStarted: boolean) => void
}

export class CliProcessHandler {
	private activeSessions: Map<string, ActiveProcessInfo> = new Map()
	private pendingProcess: PendingProcessInfo | null = null

	constructor(
		private readonly registry: AgentRegistry,
		private readonly callbacks: CliProcessHandlerCallbacks,
	) {}

	/** Log verbose/debug messages (only when onDebugLog callback is provided) */
	private debugLog(message: string): void {
		this.callbacks.onDebugLog?.(message)
	}

	/** Clear the pending session timeout if it exists */
	private clearPendingTimeout(): void {
		if (this.pendingProcess?.timeoutId) {
			clearTimeout(this.pendingProcess.timeoutId)
		}
	}

	public spawnProcess(
		cliPath: string,
		workspace: string,
		prompt: string,
		options: { parallelMode?: boolean; sessionId?: string; label?: string; gitUrl?: string } | undefined,
		onCliEvent: (sessionId: string, event: StreamEvent) => void,
	): void {
		// Check if we're resuming an existing session (sessionId explicitly provided)
		const isResume = !!options?.sessionId

		if (isResume) {
			const existingSession = this.registry.getSession(options!.sessionId!)
			if (existingSession) {
				// Local session - update status to "creating"
				this.registry.updateSessionStatus(options!.sessionId!, "creating")
			} else {
				// Remote session (not in local registry) - create a local entry with "creating" status
				this.registry.createSession(options!.sessionId!, prompt, Date.now(), {
					parallelMode: options?.parallelMode,
					labelOverride: options?.label,
					gitUrl: options?.gitUrl,
				})
				this.registry.updateSessionStatus(options!.sessionId!, "creating")
			}
			this.debugLog(`Resuming session ${options!.sessionId}, setting to creating state`)
			this.callbacks.onStateChanged()
		} else {
			// New session - create pending session state
			const pendingSession = this.registry.setPendingSession(prompt, {
				parallelMode: options?.parallelMode,
				gitUrl: options?.gitUrl,
			})
			this.debugLog(`Pending session created, waiting for CLI session_created event`)
			this.callbacks.onPendingSessionChanged(pendingSession)
		}

		// Build CLI command
		const cliArgs = buildCliArgs(workspace, prompt, {
			parallelMode: options?.parallelMode,
			sessionId: options?.sessionId,
		})
		this.debugLog(`Command: ${cliPath} ${cliArgs.join(" ")}`)
		this.debugLog(`Working dir: ${workspace}`)

		// Spawn CLI process
		const proc = spawn(cliPath, cliArgs, {
			cwd: workspace,
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
			shell: false,
		})

		if (proc.pid) {
			this.debugLog(`Process PID: ${proc.pid}`)
		} else {
			this.callbacks.onLog(`WARNING: No PID - spawn may have failed`)
		}

		this.debugLog(`stdout exists: ${!!proc.stdout}`)
		this.debugLog(`stderr exists: ${!!proc.stderr}`)

		// Create parser for the process
		const parser = new CliOutputParser()

		if (isResume) {
			// For resume sessions, immediately add to activeSessions
			// We already know the sessionId, no need to wait for session_created
			const sessionId = options!.sessionId!
			this.registry.updateSessionStatus(sessionId, "running")
			this.activeSessions.set(sessionId, {
				process: proc,
				parser,
			})
			if (proc.pid) {
				this.registry.setSessionPid(sessionId, proc.pid)
			}
			this.debugLog(`Resume session ${sessionId} is now active`)
			this.callbacks.onStateChanged()
		} else {
			// Store pending process info for new sessions
			this.pendingProcess = {
				process: proc,
				parser,
				prompt,
				startTime: Date.now(),
				parallelMode: options?.parallelMode,
				desiredSessionId: options?.sessionId,
				desiredLabel: options?.label,
				gitUrl: options?.gitUrl,
				stderrBuffer: [],
				timeoutId: setTimeout(() => this.handlePendingTimeout(), PENDING_SESSION_TIMEOUT_MS),
			}
		}

		// Parse nd-json output from stdout
		proc.stdout?.on("data", (chunk) => {
			const chunkStr = chunk.toString()
			this.debugLog(`stdout chunk (${chunkStr.length} bytes): ${chunkStr.slice(0, 200)}`)

			const { events } = parser.parse(chunkStr)

			for (const event of events) {
				this.handleCliEventForPendingOrActive(proc, event, onCliEvent)
			}
		})

		// Handle stderr
		proc.stderr?.on("data", (data) => {
			const stderrStr = String(data).trim()
			this.debugLog(`stderr: ${stderrStr}`)

			// Capture stderr for pending process to detect CLI errors
			if (this.pendingProcess && this.pendingProcess.process === proc) {
				this.pendingProcess.stderrBuffer.push(stderrStr)
			}
		})

		// Handle process exit - pass the process reference so we know which one exited
		proc.on("exit", (code, signal) => {
			this.debugLog(`Process exited: code=${code}, signal=${signal}`)
			this.handleProcessExit(proc, code, signal, onCliEvent)
		})

		proc.on("error", (error) => {
			this.callbacks.onLog(`Process spawn error: ${error.message}`)
			this.handleProcessError(proc, error)
		})

		this.debugLog(`spawned CLI process pid=${proc.pid}`)
	}

	public stopProcess(sessionId: string): void {
		const info = this.activeSessions.get(sessionId)
		if (info) {
			info.process.kill("SIGTERM")
			this.activeSessions.delete(sessionId)
		}
	}

	public stopAllProcesses(): void {
		// Stop pending process if any
		if (this.pendingProcess) {
			this.clearPendingTimeout()
			this.pendingProcess.process.kill("SIGTERM")
			this.registry.clearPendingSession()
			this.pendingProcess = null
		}

		for (const [, info] of this.activeSessions.entries()) {
			info.process.kill("SIGTERM")
		}
		this.activeSessions.clear()
	}

	/**
	 * Cancel a pending session that hasn't received session_created yet.
	 * This allows users to manually cancel stuck session creation.
	 */
	public cancelPendingSession(): void {
		if (!this.pendingProcess) {
			return
		}

		this.debugLog(`Canceling pending session`)

		this.clearPendingTimeout()
		this.pendingProcess.process.kill("SIGTERM")
		this.registry.clearPendingSession()
		this.pendingProcess = null

		this.callbacks.onPendingSessionChanged(null)
		this.callbacks.onStateChanged()
	}

	public hasProcess(sessionId: string): boolean {
		return this.activeSessions.has(sessionId)
	}

	/**
	 * Write a JSON message to a session's stdin
	 */
	public async writeToStdin(sessionId: string, message: object): Promise<void> {
		const info = this.activeSessions.get(sessionId)
		if (!info?.process.stdin) {
			throw new Error(`Session ${sessionId} not found or stdin not available`)
		}

		return new Promise((resolve, reject) => {
			const jsonLine = JSON.stringify(message) + "\n"
			info.process.stdin!.write(jsonLine, (error: Error | null | undefined) => {
				if (error) {
					reject(error)
				} else {
					resolve()
				}
			})
		})
	}

	/**
	 * Check if a session has stdin available
	 */
	public hasStdin(sessionId: string): boolean {
		const info = this.activeSessions.get(sessionId)
		return !!info?.process.stdin
	}

	public dispose(): void {
		this.stopAllProcesses()
	}

	private handleCliEventForPendingOrActive(
		proc: ChildProcess,
		event: StreamEvent,
		onCliEvent: (sessionId: string, event: StreamEvent) => void,
	): void {
		// Check if this is a session_created event
		if (event.streamEventType === "session_created") {
			this.handleSessionCreated(event as SessionCreatedStreamEvent)
			return
		}

		// If this is the pending process, handle specially
		if (this.pendingProcess && this.pendingProcess.process === proc) {
			// Capture worktree branch from welcome event (arrives before session_created)
			if (event.streamEventType === "welcome") {
				const welcomeEvent = event as WelcomeStreamEvent
				if (welcomeEvent.worktreeBranch) {
					this.pendingProcess.worktreeBranch = welcomeEvent.worktreeBranch
					this.debugLog(`Captured worktree branch from welcome: ${welcomeEvent.worktreeBranch}`)
				}
				return
			}
			// Track api_req_started that arrives before session_created
			// This is needed so KilocodeEventProcessor knows the user echo has already happened
			if (event.streamEventType === "kilocode") {
				const payload = (event as KilocodeStreamEvent).payload
				if (payload?.say === "api_req_started") {
					this.pendingProcess.sawApiReqStarted = true
					this.debugLog(`Captured api_req_started before session_created`)
				}
			}
			// Events before session_created are typically status messages
			if (event.streamEventType === "status") {
				this.debugLog(`Pending session status: ${event.message}`)
			}
			return
		}

		// Find the session for this process
		const sessionId = this.findSessionIdForProcess(proc)
		if (sessionId) {
			onCliEvent(sessionId, event)
			this.callbacks.onStateChanged()
		}
	}

	private handlePendingTimeout(): void {
		if (!this.pendingProcess) {
			return
		}

		this.callbacks.onLog(
			`Pending session timed out after ${PENDING_SESSION_TIMEOUT_MS / 1000}s - no session_created event received`,
		)

		const stderrOutput = this.pendingProcess.stderrBuffer.join("\n")
		this.pendingProcess.process.kill("SIGTERM")
		this.registry.clearPendingSession()
		this.pendingProcess = null

		this.callbacks.onPendingSessionChanged(null)
		this.callbacks.onStartSessionFailed({
			type: "unknown",
			message: stderrOutput || "Session creation timed out - CLI did not respond",
		})
		this.callbacks.onStateChanged()
	}

	private handleSessionCreated(event: SessionCreatedStreamEvent): void {
		if (!this.pendingProcess) {
			this.debugLog(`Received session_created but no pending process`)
			return
		}

		this.clearPendingTimeout()

		const {
			process: proc,
			prompt,
			startTime,
			parser,
			parallelMode,
			worktreeBranch,
			desiredSessionId,
			desiredLabel,
			sawApiReqStarted,
			gitUrl,
		} = this.pendingProcess

		// Use desired sessionId when provided (resuming) to keep UI continuity
		const sessionId = desiredSessionId ?? event.sessionId
		const existing = this.registry.getSession(sessionId)

		let session: ReturnType<typeof this.registry.createSession>

		if (existing) {
			// Resuming existing session - update status to running (clears end state)
			this.registry.updateSessionStatus(sessionId, "running")
			this.registry.selectedId = sessionId
			session = existing
			this.debugLog(`Resuming existing session: ${sessionId}`)
		} else {
			// Create new session (also sets selectedId)
			session = this.registry.createSession(sessionId, prompt, startTime, {
				parallelMode,
				labelOverride: desiredLabel,
				gitUrl,
			})
			this.debugLog(`Created new session: ${sessionId}`)
		}

		this.debugLog(`Session created with CLI sessionId: ${event.sessionId}, mapped to: ${session.sessionId}`)

		// Apply worktree branch if captured from welcome event
		if (worktreeBranch && parallelMode) {
			this.registry.updateParallelModeInfo(session.sessionId, { branch: worktreeBranch })
			this.debugLog(`Applied worktree branch: ${worktreeBranch}`)
		}

		// Clear pending session state
		this.registry.clearPendingSession()
		this.pendingProcess = null

		if (proc.pid) {
			this.registry.setSessionPid(session.sessionId, proc.pid)
		}

		// Move to active session tracking
		this.activeSessions.set(session.sessionId, {
			process: proc,
			parser,
		})

		// Notify callbacks
		this.callbacks.onPendingSessionChanged(null)
		this.callbacks.onSessionCreated(sawApiReqStarted ?? false)
		this.callbacks.onStateChanged()
	}

	private handleProcessExit(
		proc: ChildProcess,
		code: number | null,
		signal: NodeJS.Signals | null,
		onCliEvent: (sessionId: string, event: StreamEvent) => void,
	): void {
		if (this.pendingProcess && this.pendingProcess.process === proc) {
			this.clearPendingTimeout()
			const stderrOutput = this.pendingProcess.stderrBuffer.join("\n")
			this.registry.clearPendingSession()
			this.callbacks.onPendingSessionChanged(null)
			this.pendingProcess = null

			if (code !== 0) {
				// Detect CLI version/compatibility issues from stderr
				const errorInfo = this.detectCliError(stderrOutput, code)
				this.callbacks.onStartSessionFailed(errorInfo)
			}
			this.callbacks.onStateChanged()
			return
		}

		// Find the active session for this process
		const sessionId = this.findSessionIdForProcess(proc)
		if (!sessionId) {
			return
		}

		const info = this.activeSessions.get(sessionId)
		if (!info) {
			return
		}

		// Flush any buffered parser output
		const { events } = info.parser.flush()
		for (const event of events) {
			onCliEvent(sessionId, event)
		}

		// Clean up
		this.activeSessions.delete(sessionId)

		if (code === 0) {
			this.registry.updateSessionStatus(sessionId, "done", code)
			this.callbacks.onSessionLog(sessionId, "Agent completed")
		} else {
			this.registry.updateSessionStatus(sessionId, "error", code ?? undefined)
			this.callbacks.onSessionLog(
				sessionId,
				`Agent exited with code ${code ?? "?"}${signal ? ` signal ${signal}` : ""}`,
			)
		}
		this.callbacks.onStateChanged()
	}

	private handleProcessError(proc: ChildProcess, error: Error): void {
		if (this.pendingProcess && this.pendingProcess.process === proc) {
			this.clearPendingTimeout()
			this.registry.clearPendingSession()
			this.callbacks.onPendingSessionChanged(null)
			this.pendingProcess = null
			this.callbacks.onStartSessionFailed({
				type: "spawn_error",
				message: error.message,
			})
			this.callbacks.onStateChanged()
			return
		}

		// Find the active session for this process
		const sessionId = this.findSessionIdForProcess(proc)
		if (sessionId) {
			this.callbacks.onSessionLog(sessionId, `Process error: ${error.message}`)
			this.registry.updateSessionStatus(sessionId, "error", undefined, error.message)
			this.callbacks.onStateChanged()
		}
	}

	private findSessionIdForProcess(proc: ChildProcess): string | null {
		for (const [sessionId, info] of this.activeSessions.entries()) {
			if (info.process === proc) {
				return sessionId
			}
		}
		return null
	}

	/**
	 * Detect CLI error type from stderr output.
	 * Used to provide helpful error messages for version mismatches.
	 */
	private detectCliError(
		stderrOutput: string,
		_exitCode: number | null,
	): { type: "cli_outdated" | "spawn_error" | "unknown"; message: string } {
		const lowerStderr = stderrOutput.toLowerCase()

		// Detect unknown option errors (indicates CLI version doesn't support --json-io)
		if (
			lowerStderr.includes("unknown option") ||
			lowerStderr.includes("unrecognized option") ||
			lowerStderr.includes("invalid option") ||
			lowerStderr.includes("--json-io")
		) {
			return {
				type: "cli_outdated",
				message: stderrOutput || "CLI does not support required options",
			}
		}

		// Detect command not found (shouldn't happen since we check path, but just in case)
		if (lowerStderr.includes("command not found") || lowerStderr.includes("not recognized")) {
			return {
				type: "spawn_error",
				message: stderrOutput || "CLI command not found",
			}
		}

		return {
			type: "unknown",
			message: stderrOutput || "Unknown error",
		}
	}
}
