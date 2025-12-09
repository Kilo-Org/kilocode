import { spawn, ChildProcess } from "node:child_process"
import { CliOutputParser, type StreamEvent, type SessionCreatedStreamEvent } from "./CliOutputParser"
import { AgentRegistry } from "./AgentRegistry"
import { buildCliArgs } from "./CliArgsBuilder"
import type { ClineMessage } from "@roo-code/types"

const SESSION_TIMEOUT_MS = 120_000 // 2 minutes

export interface SpawnOptions {
	gitUrl?: string
}

interface PendingProcessInfo {
	process: ChildProcess
	parser: CliOutputParser
	prompt: string
	startTime: number
	timeout: NodeJS.Timeout
	gitUrl?: string
}

interface ActiveProcessInfo {
	process: ChildProcess
	parser: CliOutputParser
	timeout: NodeJS.Timeout
}

export interface CliProcessHandlerCallbacks {
	onLog: (message: string) => void
	onSessionLog: (sessionId: string, line: string) => void
	onStateChanged: () => void
	onPendingSessionChanged: (pendingSession: { prompt: string; label: string; startTime: number } | null) => void
	onStartSessionFailed: () => void
	onChatMessages: (sessionId: string, messages: ClineMessage[]) => void
	onSessionCreated: () => void
}

export class CliProcessHandler {
	private activeSessions: Map<string, ActiveProcessInfo> = new Map()
	private pendingProcess: PendingProcessInfo | null = null

	constructor(
		private readonly registry: AgentRegistry,
		private readonly callbacks: CliProcessHandlerCallbacks,
	) {}

	public spawnProcess(
		cliPath: string,
		workspace: string,
		prompt: string,
		onCliEvent: (sessionId: string, event: StreamEvent) => void,
		options?: SpawnOptions,
	): void {
		// Set pending session state
		const pendingSession = this.registry.setPendingSession(prompt, options)
		this.callbacks.onLog(`Pending session created, waiting for CLI session_created event`)
		this.callbacks.onPendingSessionChanged(pendingSession)

		// Build CLI command
		const cliArgs = buildCliArgs(workspace, prompt)
		this.callbacks.onLog(`Command: ${cliPath} ${cliArgs.join(" ")}`)
		this.callbacks.onLog(`Working dir: ${workspace}`)

		// Spawn CLI process
		const proc = spawn(cliPath, cliArgs, {
			cwd: workspace,
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
			shell: false,
		})

		if (proc.pid) {
			this.callbacks.onLog(`Process PID: ${proc.pid}`)
		} else {
			this.callbacks.onLog(`WARNING: No PID - spawn may have failed`)
		}

		this.callbacks.onLog(`stdout exists: ${!!proc.stdout}`)
		this.callbacks.onLog(`stderr exists: ${!!proc.stderr}`)

		// Create parser for pending process
		const parser = new CliOutputParser()

		// Set timeout for pending session
		const timeout = setTimeout(() => {
			this.callbacks.onLog(`Pending session timed out`)
			this.registry.clearPendingSession()
			proc.kill("SIGTERM")
			this.callbacks.onPendingSessionChanged(null)
			this.callbacks.onStartSessionFailed()
		}, SESSION_TIMEOUT_MS)

		// Store pending process info
		this.pendingProcess = {
			process: proc,
			parser,
			prompt,
			startTime: pendingSession.startTime,
			timeout,
			gitUrl: options?.gitUrl,
		}

		// Parse nd-json output from stdout
		proc.stdout?.on("data", (chunk) => {
			const chunkStr = chunk.toString()
			this.callbacks.onLog(`stdout chunk (${chunkStr.length} bytes): ${chunkStr.slice(0, 200)}`)

			const { events } = parser.parse(chunkStr)

			for (const event of events) {
				this.handleCliEventForPendingOrActive(proc, event, onCliEvent)
			}
		})

		// Handle stderr
		proc.stderr?.on("data", (data) => {
			const stderrStr = String(data).trim()
			this.callbacks.onLog(`stderr: ${stderrStr}`)
		})

		// Handle process exit - pass the process reference so we know which one exited
		proc.on("exit", (code, signal) => {
			this.callbacks.onLog(`Process exited: code=${code}, signal=${signal}`)
			this.handleProcessExit(proc, code, signal, onCliEvent)
		})

		proc.on("error", (error) => {
			this.callbacks.onLog(`Process spawn error: ${error.message}`)
			this.handleProcessError(proc, error)
		})

		this.callbacks.onLog(`spawned CLI process pid=${proc.pid}`)
	}

	public stopProcess(sessionId: string): void {
		const info = this.activeSessions.get(sessionId)
		if (info) {
			info.process.kill("SIGTERM")
			clearTimeout(info.timeout)
			this.activeSessions.delete(sessionId)
		}
	}

	public stopAllProcesses(): void {
		// Stop pending process if any
		if (this.pendingProcess) {
			clearTimeout(this.pendingProcess.timeout)
			this.pendingProcess.process.kill("SIGTERM")
			this.registry.clearPendingSession()
			this.pendingProcess = null
		}

		for (const [sessionId, info] of this.activeSessions.entries()) {
			info.process.kill("SIGTERM")
			clearTimeout(info.timeout)
		}
		this.activeSessions.clear()
	}

	public hasProcess(sessionId: string): boolean {
		return this.activeSessions.has(sessionId)
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
			// Events before session_created are typically status messages
			if (event.streamEventType === "status") {
				this.callbacks.onLog(`Pending session status: ${event.message}`)
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

	private handleSessionCreated(event: SessionCreatedStreamEvent): void {
		if (!this.pendingProcess) {
			this.callbacks.onLog(`Received session_created but no pending process`)
			return
		}

		const { process: proc, prompt, startTime, timeout, parser, gitUrl } = this.pendingProcess

		// Clear pending timeout
		clearTimeout(timeout)

		// Create the actual session with CLI's sessionId
		const session = this.registry.createSession(event.sessionId, prompt, startTime, gitUrl ? { gitUrl } : undefined)
		this.callbacks.onLog(`Session created with CLI sessionId: ${session.sessionId}`)

		// Clear pending session state
		this.registry.clearPendingSession()
		this.pendingProcess = null

		if (proc.pid) {
			this.registry.setSessionPid(session.sessionId, proc.pid)
		}

		// Set new timeout for the active session
		const sessionTimeout = setTimeout(() => {
			this.callbacks.onSessionLog(session.sessionId, "Timed out. Killing agent.")
			this.registry.updateSessionStatus(session.sessionId, "error", undefined, "Timeout")
			proc.kill("SIGTERM")
			this.callbacks.onStateChanged()
		}, SESSION_TIMEOUT_MS)

		// Move to active session tracking
		this.activeSessions.set(session.sessionId, {
			process: proc,
			parser,
			timeout: sessionTimeout,
		})

		// Notify callbacks
		this.callbacks.onPendingSessionChanged(null)
		this.callbacks.onSessionCreated()
		this.callbacks.onStateChanged()
	}

	private handleProcessExit(
		proc: ChildProcess,
		code: number | null,
		signal: NodeJS.Signals | null,
		onCliEvent: (sessionId: string, event: StreamEvent) => void,
	): void {
		// Check if this is the pending process
		if (this.pendingProcess && this.pendingProcess.process === proc) {
			clearTimeout(this.pendingProcess.timeout)
			this.registry.clearPendingSession()
			this.pendingProcess = null
			this.callbacks.onPendingSessionChanged(null)

			if (code !== 0) {
				this.callbacks.onStartSessionFailed()
			}
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
		clearTimeout(info.timeout)
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
		// Check if this is the pending process
		if (this.pendingProcess && this.pendingProcess.process === proc) {
			clearTimeout(this.pendingProcess.timeout)
			this.registry.clearPendingSession()
			this.pendingProcess = null
			this.callbacks.onPendingSessionChanged(null)
			this.callbacks.onStartSessionFailed()
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
}
