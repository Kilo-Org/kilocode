import { spawn, ChildProcess } from "node:child_process"
import * as path from "node:path"
import {
	CliOutputParser,
	type StreamEvent,
	type SessionCreatedStreamEvent,
	type WelcomeStreamEvent,
	type KilocodeStreamEvent,
	type KilocodePayload,
} from "./CliOutputParser"
import { AgentRegistry } from "./AgentRegistry"
import { buildCliArgs } from "./CliArgsBuilder"
import { buildParallelModeWorktreePath } from "./parallelModeParser"
import type { ClineMessage, ProviderSettings } from "@roo-code/types"
import { extractApiReqFailedMessage, extractPayloadMessage } from "./askErrorParser"
import { buildProviderEnvOverrides } from "./providerEnvMapper"
import { captureAgentManagerLoginIssue, getPlatformDiagnostics } from "./telemetry"

/**
 * Timeout for pending sessions (ms) - if session_created event doesn't arrive within this time,
 * the session is considered failed. This prevents the UI from getting stuck in "Creating session..." state.
 */
const PENDING_SESSION_TIMEOUT_MS = 30_000

/**
 * Maximum size for stdout buffer (bytes) - prevents memory issues when buffering output
 * before session_created. We only need enough to detect configuration errors.
 */
const MAX_STDOUT_BUFFER_SIZE = 64 * 1024

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
	worktreePath?: string // Captured from welcome event before session_created
	provisionalSessionId?: string // Used to show streaming content before session_created
	sawApiReqStarted?: boolean // Track if api_req_started arrived before session_created
	gitUrl?: string
	stderrBuffer: string[] // Capture stderr for error detection
	stdoutBuffer: string[] // Capture raw stdout for configuration error detection when JSON is truncated
	timeoutId?: NodeJS.Timeout // Timer for auto-failing stuck pending sessions
	hadShellPath?: boolean // Track if shell PATH was used (for telemetry)
	cliPath?: string // CLI path for error telemetry
	configurationError?: string // Captured from welcome event instructions (indicates misconfigured CLI)
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
	onStartSessionFailed: (
		error?:
			| { type: "cli_outdated" | "spawn_error" | "unknown" | "cli_configuration_error"; message: string }
			| { type: "api_req_failed"; message: string; payload?: KilocodePayload; authError?: boolean }
			| { type: "payment_required"; message: string; payload?: KilocodePayload },
	) => void
	onChatMessages: (sessionId: string, messages: ClineMessage[]) => void
	onSessionCreated: (sawApiReqStarted: boolean) => void
	onSessionRenamed?: (oldId: string, newId: string) => void
	onPaymentRequiredPrompt?: (payload: KilocodePayload) => void
	onSessionCompleted?: (sessionId: string, exitCode: number | null) => void // Called when process exits successfully
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

	/** Extract configuration error from welcome event if present */
	private extractConfigErrorFromWelcome(welcomeEvent: WelcomeStreamEvent): string | undefined {
		if (welcomeEvent.instructions && welcomeEvent.instructions.length > 0) {
			return welcomeEvent.instructions.join("\n")
		}
		return undefined
	}

	/** Clear the pending session timeout if it exists */
	private clearPendingTimeout(): void {
		if (this.pendingProcess?.timeoutId) {
			clearTimeout(this.pendingProcess.timeoutId)
		}
	}

	private buildEnvWithApiConfiguration(apiConfiguration?: ProviderSettings, shellPath?: string): NodeJS.ProcessEnv {
		const baseEnv = { ...process.env }

		// On macOS/Linux, use the shell PATH to ensure CLI can access tools like git
		// This is critical when the editor is launched from Finder/Spotlight, as the
		// extension host doesn't inherit the user's shell environment
		if (shellPath) {
			baseEnv.PATH = shellPath
			this.debugLog(`Using shell PATH for CLI spawn`)
		}

		const overrides = buildProviderEnvOverrides(
			apiConfiguration,
			baseEnv,
			(message) => this.callbacks.onLog(message),
			(message) => this.debugLog(message),
		)

		return {
			...baseEnv,
			...overrides,
			NO_COLOR: "1",
			FORCE_COLOR: "0",
			KILO_PLATFORM: "agent-manager",
		}
	}

	public spawnProcess(
		cliPath: string,
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
					/** Shell PATH from login shell - ensures CLI can access tools like git on macOS */
					shellPath?: string
			  }
			| undefined,
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
			existingBranch: options?.existingBranch,
		})
		const env = this.buildEnvWithApiConfiguration(options?.apiConfiguration, options?.shellPath)

		// On Windows, batch files must be launched via cmd.exe to handle paths with spaces reliably.
		const isWindowsBatch =
			process.platform === "win32" && [".cmd", ".bat"].includes(path.extname(cliPath).toLowerCase())
		const spawnCommand = isWindowsBatch ? process.env.ComSpec || "cmd.exe" : cliPath
		const spawnArgs = isWindowsBatch ? ["/d", "/s", "/c", cliPath, ...cliArgs] : cliArgs

		this.debugLog(`Command: ${spawnCommand} ${spawnArgs.join(" ")}`)
		this.debugLog(`Working dir: ${workspace}`)

		// Spawn CLI process
		const proc = spawn(spawnCommand, spawnArgs, {
			cwd: workspace,
			stdio: ["pipe", "pipe", "pipe"],
			env,
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
				stdoutBuffer: [],
				timeoutId: setTimeout(() => this.handlePendingTimeout(), PENDING_SESSION_TIMEOUT_MS),
				hadShellPath: !!options?.shellPath, // Track for telemetry
				cliPath,
			}
		}

		// Parse nd-json output from stdout
		proc.stdout?.on("data", (chunk) => {
			const chunkStr = chunk.toString()
			this.debugLog(`stdout chunk (${chunkStr.length} bytes): ${chunkStr.slice(0, 200)}`)

			// Capture raw stdout for configuration error detection (in case JSON is truncated)
			// Cap buffer size to prevent memory issues
			if (this.pendingProcess && this.pendingProcess.process === proc) {
				this.pendingProcess.stdoutBuffer.push(chunkStr)
				this.capStdoutBuffer()
			}

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

	/**
	 * Terminate a running process but keep it tracked until it exits.
	 * This is useful when we want the normal CLI shutdown logic to run and for
	 * the exit handler to update session status (e.g., "Finish to branch").
	 */
	public terminateProcess(sessionId: string, signal: NodeJS.Signals = "SIGTERM"): void {
		const info = this.activeSessions.get(sessionId)
		if (!info) {
			return
		}

		info.process.kill(signal)
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

	public hasPendingProcess(): boolean {
		return this.pendingProcess !== null
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
			// Capture worktree branch and configuration errors from welcome event (arrives before session_created)
			if (event.streamEventType === "welcome") {
				const welcomeEvent = event as WelcomeStreamEvent
				const derivedWorktreePath =
					!welcomeEvent.worktreePath && welcomeEvent.worktreeBranch
						? buildParallelModeWorktreePath(welcomeEvent.worktreeBranch)
						: undefined
				const resolvedWorktreePath = welcomeEvent.worktreePath ?? derivedWorktreePath

				if (welcomeEvent.worktreeBranch) {
					this.pendingProcess.worktreeBranch = welcomeEvent.worktreeBranch
					this.debugLog(`Captured worktree branch from welcome: ${welcomeEvent.worktreeBranch}`)
				}
				if (resolvedWorktreePath) {
					this.pendingProcess.worktreePath = resolvedWorktreePath
					const logMessage = derivedWorktreePath
						? `Derived worktree path from branch: ${resolvedWorktreePath}`
						: `Captured worktree path from welcome: ${resolvedWorktreePath}`
					this.callbacks.onLog(logMessage)
					this.debugLog(logMessage)
				}
				if (
					this.pendingProcess.parallelMode &&
					this.pendingProcess.provisionalSessionId &&
					(welcomeEvent.worktreeBranch || resolvedWorktreePath)
				) {
					this.registry.updateParallelModeInfo(this.pendingProcess.provisionalSessionId, {
						branch: welcomeEvent.worktreeBranch,
						worktreePath: resolvedWorktreePath,
					})
				}
				const configError = this.extractConfigErrorFromWelcome(welcomeEvent)
				if (configError) {
					this.pendingProcess.configurationError = configError
					this.debugLog(`Captured CLI configuration error: ${configError}`)
				}
				return
			}

			if (event.streamEventType === "kilocode") {
				const payload = (event as KilocodeStreamEvent).payload

				// Handle error cases that should abort session creation
				if (payload?.ask === "payment_required_prompt") {
					this.handlePaymentRequiredDuringPending(payload)
					return
				}
				if (payload?.ask === "api_req_failed") {
					this.handleApiReqFailedDuringPending(payload)
					return
				}

				// Track api_req_started that arrives before session_created
				// This is needed so KilocodeEventProcessor knows the user echo has already happened
				if (payload?.say === "api_req_started") {
					this.pendingProcess.sawApiReqStarted = true
					this.debugLog(`Captured api_req_started before session_created`)
				}

				// Create provisional session on first content event (prompt echo, api_req_started, streaming text, etc.)
				if (!this.pendingProcess.provisionalSessionId) {
					this.createProvisionalSession(proc)
				}

				// Forward the event to the provisional session
				if (this.pendingProcess.provisionalSessionId) {
					onCliEvent(this.pendingProcess.provisionalSessionId, event)
					this.callbacks.onStateChanged()
				}
				return
			}

			// If we have a provisional session, forward non-kilocode events to it as well
			if (this.pendingProcess.provisionalSessionId) {
				onCliEvent(this.pendingProcess.provisionalSessionId, event)
				this.callbacks.onStateChanged()
				return
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

	/** Create a provisional session to show streaming content before session_created arrives. */
	private createProvisionalSession(proc: ChildProcess): void {
		if (!this.pendingProcess || this.pendingProcess.provisionalSessionId) {
			return
		}

		const provisionalId = `provisional-${Date.now()}`
		this.pendingProcess.provisionalSessionId = provisionalId

		const { prompt, startTime, parallelMode, desiredLabel, gitUrl, parser, worktreeBranch, worktreePath } =
			this.pendingProcess

		this.registry.createSession(provisionalId, prompt, startTime, {
			parallelMode,
			labelOverride: desiredLabel,
			gitUrl,
		})

		if (parallelMode && (worktreeBranch || worktreePath)) {
			this.registry.updateParallelModeInfo(provisionalId, {
				branch: worktreeBranch,
				worktreePath,
			})
		}

		this.activeSessions.set(provisionalId, { process: proc, parser })

		if (proc.pid) {
			this.registry.setSessionPid(provisionalId, proc.pid)
		}

		this.registry.clearPendingSession()
		this.callbacks.onPendingSessionChanged(null)
		this.callbacks.onSessionCreated(this.pendingProcess?.sawApiReqStarted ?? false)

		this.debugLog(`Created provisional session: ${provisionalId}`)
		this.callbacks.onStateChanged()
	}

	/** Upgrade provisional session to real session ID when session_created arrives. */
	private upgradeProvisionalSession(
		provisionalSessionId: string,
		realSessionId: string,
		worktreeBranch: string | undefined,
		worktreePath: string | undefined,
		parallelMode: boolean | undefined,
	): void {
		this.debugLog(`Upgrading provisional session ${provisionalSessionId} -> ${realSessionId}`)

		this.registry.renameSession(provisionalSessionId, realSessionId)

		const activeInfo = this.activeSessions.get(provisionalSessionId)
		if (activeInfo) {
			this.activeSessions.delete(provisionalSessionId)
			this.activeSessions.set(realSessionId, activeInfo)
		}

		this.callbacks.onSessionRenamed?.(provisionalSessionId, realSessionId)

		if (parallelMode && (worktreeBranch || worktreePath)) {
			this.registry.updateParallelModeInfo(realSessionId, {
				branch: worktreeBranch,
				worktreePath,
			})
		}

		this.pendingProcess = null
		this.callbacks.onStateChanged()
	}

	private handlePendingTimeout(): void {
		if (!this.pendingProcess) {
			return
		}

		this.callbacks.onLog(
			`Pending session timed out after ${PENDING_SESSION_TIMEOUT_MS / 1000}s - no session_created event received`,
		)

		const stderrOutput = this.pendingProcess.stderrBuffer.join("\n")
		const hadShellPath = this.pendingProcess.hadShellPath
		this.pendingProcess.process.kill("SIGTERM")
		this.registry.clearPendingSession()
		this.pendingProcess = null

		const { platform, shell } = getPlatformDiagnostics()

		// Enhanced telemetry for session_timeout to help diagnose issues like #4579
		captureAgentManagerLoginIssue({
			issueType: "session_timeout",
			platform,
			shell,
			hasStderr: !!stderrOutput,
			// Truncate stderr to first 500 chars to avoid sending too much data
			stderrPreview: stderrOutput ? stderrOutput.slice(0, 500) : undefined,
			// Track if our shell PATH fix was applied (helps verify fix effectiveness)
			hadShellPath,
		})

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
			worktreePath,
			desiredSessionId,
			desiredLabel,
			sawApiReqStarted,
			gitUrl,
			provisionalSessionId,
		} = this.pendingProcess

		// Use desired sessionId when provided (resuming) to keep UI continuity
		const sessionId = desiredSessionId ?? event.sessionId

		// If we created a provisional session, upgrade it instead of creating a second session entry.
		// In some edge cases, fall back to the active session mapped to this process.
		const provisionalIdFromProcess = this.findSessionIdForProcess(proc)
		const effectiveProvisionalSessionId =
			provisionalSessionId ??
			(provisionalIdFromProcess?.startsWith("provisional-") ? provisionalIdFromProcess : undefined)

		if (effectiveProvisionalSessionId && effectiveProvisionalSessionId !== sessionId) {
			this.upgradeProvisionalSession(
				effectiveProvisionalSessionId,
				sessionId,
				worktreeBranch,
				worktreePath,
				parallelMode,
			)
			return
		}

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

		const resolvedWorktreePath =
			worktreePath || (parallelMode && worktreeBranch ? buildParallelModeWorktreePath(worktreeBranch) : undefined)

		if (resolvedWorktreePath && parallelMode) {
			this.registry.updateParallelModeInfo(session.sessionId, { worktreePath: resolvedWorktreePath })
			const logMessage =
				worktreePath && worktreePath === resolvedWorktreePath
					? `Applied worktree path: ${resolvedWorktreePath}`
					: `Applied derived worktree path: ${resolvedWorktreePath}`
			this.callbacks.onLog(logMessage)
			this.debugLog(logMessage)
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

			// Start with any config error captured during streaming
			let configurationError = this.pendingProcess.configurationError

			// Flush any buffered parser output - welcome event JSON might be split across chunks
			const { events } = this.pendingProcess.parser.flush()
			for (const event of events) {
				if (event.streamEventType === "welcome" && !configurationError) {
					configurationError = this.extractConfigErrorFromWelcome(event as WelcomeStreamEvent)
					if (configurationError) {
						this.debugLog(`Captured CLI configuration error from flush: ${configurationError}`)
					}
				}
			}

			// Fallback: Check raw stdout for configuration error patterns if JSON parsing didn't capture it
			if (!configurationError) {
				const rawStdout = this.pendingProcess.stdoutBuffer.join("")
				configurationError = this.detectConfigurationErrorFromRawOutput(rawStdout)
				if (configurationError) {
					this.debugLog(`Captured CLI configuration error from raw output: ${configurationError}`)
				}
			}

			const stderrOutput = this.pendingProcess.stderrBuffer.join("\n")
			this.registry.clearPendingSession()
			this.callbacks.onPendingSessionChanged(null)
			this.pendingProcess = null

			// Check for CLI configuration error (e.g., missing kilocodeToken)
			// CLI may exit with code 0 when showing configuration error instructions
			if (configurationError) {
				this.callbacks.onStartSessionFailed({
					type: "cli_configuration_error",
					message: configurationError,
				})
				this.callbacks.onStateChanged()
				return
			}

			if (code !== 0) {
				// Detect CLI version/compatibility issues from stderr
				const errorInfo = this.detectCliError(stderrOutput, code)
				this.callbacks.onStartSessionFailed(errorInfo)
			} else {
				// Generic fallback: CLI exited with code 0 before session_created
				// This ensures the user never gets "nothing happened"
				this.callbacks.onStartSessionFailed({
					type: "unknown",
					message: stderrOutput || "CLI exited before creating a session",
				})
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

		// Exit code handling (matching cloud-agent backend behavior):
		// - 0: Success
		// - 124: CLI timeout exceeded
		// - 130 (128+2): SIGINT - user interrupted
		// - 137 (128+9): SIGKILL - force killed
		// - 143 (128+15): SIGTERM - terminated
		// - Other non-zero: Error
		const INTERRUPTED_EXIT_CODES = [130, 137, 143]
		const TIMEOUT_EXIT_CODE = 124

		if (code === 0) {
			this.registry.updateSessionStatus(sessionId, "done", code)
			this.callbacks.onSessionLog(sessionId, "Agent completed")
			// Notify that session completed successfully (for state machine transition)
			this.callbacks.onSessionCompleted?.(sessionId, code)
		} else if (code === TIMEOUT_EXIT_CODE) {
			this.registry.updateSessionStatus(sessionId, "error", code, "CLI timeout exceeded")
			this.callbacks.onSessionLog(sessionId, "Agent timed out")
		} else if (code !== null && INTERRUPTED_EXIT_CODES.includes(code)) {
			// User or system interrupted - not an error, just stopped
			this.registry.updateSessionStatus(sessionId, "stopped", code)
			this.callbacks.onSessionLog(sessionId, "Agent was interrupted")
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
			const cliPath = this.pendingProcess.cliPath
			this.clearPendingTimeout()
			this.registry.clearPendingSession()
			this.callbacks.onPendingSessionChanged(null)
			this.pendingProcess = null

			// Capture spawn error telemetry with context for debugging.
			const { platform, shell } = getPlatformDiagnostics()
			const cliPathExtension = cliPath ? path.extname(cliPath).slice(1).toLowerCase() || undefined : undefined
			captureAgentManagerLoginIssue({
				issueType: "cli_spawn_error",
				platform,
				shell,
				errorMessage: error.message,
				cliPath,
				cliPathExtension,
			})

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

	private handlePaymentRequiredDuringPending(payload: KilocodePayload): void {
		this.handlePendingAskFailure(payload, "payment_required", () => ({
			message: extractPayloadMessage(payload, "Paid model requires credits or billing setup."),
		}))
	}

	private handleApiReqFailedDuringPending(payload: KilocodePayload): void {
		this.handlePendingAskFailure(payload, "api_req_failed", () => extractApiReqFailedMessage(payload))
	}

	private handlePendingAskFailure(
		payload: KilocodePayload,
		type: "payment_required" | "api_req_failed",
		build: () => { message: string; authError?: boolean },
	): void {
		if (!this.pendingProcess) {
			return
		}

		this.debugLog(`Received ${type} before session_created`)
		this.clearPendingAndNotify(true)

		const details = build()
		this.callbacks.onStartSessionFailed({
			type,
			payload,
			...details,
		})
	}

	private clearPendingAndNotify(killProcess: boolean): void {
		if (!this.pendingProcess) {
			return
		}

		this.clearPendingTimeout()
		if (killProcess) {
			this.pendingProcess.process.kill("SIGTERM")
		}
		this.registry.clearPendingSession()
		this.pendingProcess = null
		this.callbacks.onPendingSessionChanged(null)
		this.callbacks.onStateChanged()
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

	/**
	 * Cap the stdout buffer size to prevent memory issues.
	 * Keeps the most recent data up to MAX_STDOUT_BUFFER_SIZE.
	 */
	private capStdoutBuffer(): void {
		if (!this.pendingProcess) {
			return
		}

		const buffer = this.pendingProcess.stdoutBuffer
		const totalSize = buffer.reduce((sum, chunk) => sum + chunk.length, 0)

		if (totalSize > MAX_STDOUT_BUFFER_SIZE) {
			// Join, trim from the start, and replace buffer with single trimmed string
			const joined = buffer.join("")
			const trimmed = joined.slice(joined.length - MAX_STDOUT_BUFFER_SIZE)
			this.pendingProcess.stdoutBuffer = [trimmed]
		}
	}

	/**
	 * Detect configuration errors from raw stdout output.
	 * This is a fallback for when the CLI sends truncated JSON that can't be parsed.
	 * Looks for patterns like "Configuration Error" or "instructions" containing error text.
	 */
	private detectConfigurationErrorFromRawOutput(rawOutput: string): string | undefined {
		// Look for "Configuration Error" pattern in the raw output
		// The CLI outputs this when config.json is incomplete or invalid
		if (rawOutput.includes('"instructions":') && rawOutput.includes("Configuration Error")) {
			// Return a generic configuration error message since we can't parse the full details
			return "CLI configuration is incomplete or invalid. Please run 'kilocode config' or 'kilocode auth' to configure."
		}

		// Also check for common configuration error indicators
		if (
			rawOutput.includes("kilocodeToken is required") ||
			rawOutput.includes("config.json is incomplete") ||
			rawOutput.includes("apiKey is required")
		) {
			return "CLI configuration is incomplete or invalid. Please run 'kilocode config' or 'kilocode auth' to configure."
		}

		return undefined
	}
}
