import { PTYManager, PTYManagerOptions } from "./PTYManager"
import { TerminalBuffer } from "./TerminalBuffer"
import { AIActionTools } from "./AIActionTools"
import { AutonomousDebuggingLoop } from "./AutonomousDebuggingLoop"
import { OdooIntegrationPatterns } from "./OdooIntegrationPatterns"
import { SecurityPermissionGate } from "./SecurityPermissionGate"
import { EventEmitter } from "events"
import * as vscode from "vscode"

export interface AntiGravityTerminalConfig {
	shell?: string
	cwd?: string
	enableDebugging?: boolean
	enableOdooIntegration?: boolean
	enableSecurityGate?: boolean
	terminalBufferSize?: number
	maxFixAttempts?: number
	approvalRequired?: boolean
}

export interface TerminalSession {
	id: string
	ptyManager: PTYManager
	terminalBuffer: TerminalBuffer
	aiActionTools: AIActionTools
	debuggingLoop?: AutonomousDebuggingLoop
	odooIntegration?: OdooIntegrationPatterns
	securityGate: SecurityPermissionGate
	startTime: number
	isActive: boolean
}

/**
 * AntiGravity Terminal Service - Main integration service
 * Orchestrates all terminal components for AI agent integration
 */
export class AntiGravityTerminalService extends EventEmitter {
	private sessions: Map<string, TerminalSession> = new Map()
	private activeSessionId: string | null = null
	private config: AntiGravityTerminalConfig

	constructor(
		private outputChannel: vscode.OutputChannel,
		config: AntiGravityTerminalConfig = {},
	) {
		super()
		this.config = {
			shell: process.env.SHELL || "bash",
			cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd(),
			enableDebugging: true,
			enableOdooIntegration: false,
			enableSecurityGate: true,
			terminalBufferSize: 5000,
			maxFixAttempts: 3,
			approvalRequired: true,
			...config,
		}

		this.outputChannel.appendLine("[AntiGravity Terminal] Service initialized")
	}

	/**
	 * Create a new terminal session
	 */
	public async createSession(sessionId?: string): Promise<string> {
		const id = sessionId || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

		if (this.sessions.has(id)) {
			throw new Error(`Session already exists: ${id}`)
		}

		this.outputChannel.appendLine(`[AntiGravity Terminal] Creating session: ${id}`)

		try {
			// Create PTY Manager
			const ptyOptions: PTYManagerOptions = {
				shell: this.config.shell!,
				cwd: this.config.cwd!,
				terminalId: Date.now(),
			}
			const ptyManager = new PTYManager(ptyOptions)

			// Create Terminal Buffer
			const terminalBuffer = new TerminalBuffer(
				this.config.terminalBufferSize,
				50 * 1024 * 1024, // 50MB
			)

			// Create Security Gate
			const securityGate = new SecurityPermissionGate(this.outputChannel)

			// Create AI Action Tools
			const aiActionTools = new AIActionTools(ptyManager, terminalBuffer, this.outputChannel)

			// Create optional components
			let debuggingLoop: AutonomousDebuggingLoop | undefined
			if (this.config.enableDebugging) {
				debuggingLoop = new AutonomousDebuggingLoop(aiActionTools, this.outputChannel)
			}

			let odooIntegration: OdooIntegrationPatterns | undefined
			if (this.config.enableOdooIntegration) {
				odooIntegration = new OdooIntegrationPatterns(aiActionTools, this.outputChannel)
			}

			// Create session
			const session: TerminalSession = {
				id,
				ptyManager,
				terminalBuffer,
				aiActionTools,
				debuggingLoop,
				odooIntegration,
				securityGate,
				startTime: Date.now(),
				isActive: true,
			}

			// Set up event handlers
			this.setupSessionEventHandlers(session)

			// Store session
			this.sessions.set(id, session)
			this.activeSessionId = id

			// Start optional components
			if (debuggingLoop) {
				debuggingLoop.start()
			}
			if (odooIntegration) {
				odooIntegration.start()
			}

			this.emit("sessionCreated", session)
			this.outputChannel.appendLine(`[AntiGravity Terminal] Session created successfully: ${id}`)

			return id
		} catch (error) {
			this.outputChannel.appendLine(`[AntiGravity Terminal] Failed to create session: ${error}`)
			throw error
		}
	}

	/**
	 * Get active session
	 */
	public getActiveSession(): TerminalSession | null {
		return this.activeSessionId ? this.sessions.get(this.activeSessionId) || null : null
	}

	/**
	 * Get session by ID
	 */
	public getSession(sessionId: string): TerminalSession | null {
		return this.sessions.get(sessionId) || null
	}

	/**
	 * Get all sessions
	 */
	public getAllSessions(): TerminalSession[] {
		return Array.from(this.sessions.values())
	}

	/**
	 * Switch active session
	 */
	public setActiveSession(sessionId: string): boolean {
		const session = this.sessions.get(sessionId)
		if (session && session.isActive) {
			this.activeSessionId = sessionId
			this.emit("activeSessionChanged", session)
			return true
		}
		return false
	}

	/**
	 * Execute command in active session
	 */
	public async executeCommand(
		command: string,
		options: {
			sessionId?: string
			requireApproval?: boolean
			timeout?: number
		} = {},
	): Promise<any> {
		const sessionId = options.sessionId || this.activeSessionId
		const session = sessionId ? this.sessions.get(sessionId) : null

		if (!session) {
			throw new Error("No active session available")
		}

		// Check security approval
		if (this.config.enableSecurityGate) {
			const approval = await session.securityGate.checkApproval(command, "command", "ai_agent")

			if (!approval.approved) {
				throw new Error(`Command denied: ${approval.reason}`)
			}
		}

		// Execute command
		return await session.aiActionTools.executeShellCommand(command, {
			requireApproval: options.requireApproval ?? this.config.approvalRequired,
			timeout: options.timeout,
		})
	}

	/**
	 * Start listening for patterns in active session
	 */
	public startListening(
		patterns: Array<{ name: string; regex: RegExp; description?: string }>,
		sessionId?: string,
	): void {
		const session = sessionId ? this.sessions.get(sessionId) : this.getActiveSession()
		if (!session) {
			throw new Error("No active session available")
		}

		const listenPatterns = patterns.map((p) => ({
			name: p.name,
			regex: p.regex,
			description: p.description || `Listen for ${p.name}`,
			action: "trigger" as const,
		}))

		session.aiActionTools.terminalListenFor(listenPatterns)
	}

	/**
	 * Stop listening in active session
	 */
	public stopListening(sessionId?: string): void {
		const session = sessionId ? this.sessions.get(sessionId) : this.getActiveSession()
		if (!session) {
			return
		}

		session.aiActionTools.stopListening()
	}

	/**
	 * Get recent terminal output
	 */
	public getRecentOutput(lines = 50, sessionId?: string): string[] {
		const session = sessionId ? this.sessions.get(sessionId) : this.getActiveSession()
		if (!session) {
			return []
		}

		return session.aiActionTools.getRecentTerminalOutput(lines)
	}

	/**
	 * Search terminal history
	 */
	public searchHistory(
		query: string,
		options: { useRegex?: boolean; maxResults?: number; sessionId?: string } = {},
	): any[] {
		const session = options.sessionId ? this.sessions.get(options.sessionId) : this.getActiveSession()
		if (!session) {
			return []
		}

		return session.aiActionTools.searchTerminalHistory(query, {
			useRegex: options.useRegex,
			maxResults: options.maxResults,
		})
	}

	/**
	 * Get terminal errors
	 */
	public getTerminalErrors(limit = 50, sessionId?: string): string[] {
		const session = sessionId ? this.sessions.get(sessionId) : this.getActiveSession()
		if (!session) {
			return []
		}

		return session.aiActionTools.getTerminalErrors(limit)
	}

	/**
	 * Execute Odoo command (if Odoo integration is enabled)
	 */
	public async executeOdooCommand(
		presetName: string,
		parameters: Record<string, any> = {},
		sessionId?: string,
	): Promise<any> {
		const session = sessionId ? this.sessions.get(sessionId) : this.getActiveSession()
		if (!session || !session.odooIntegration) {
			throw new Error("Odoo integration not available")
		}

		return await session.odooIntegration.executeOdooCommand(presetName, parameters)
	}

	/**
	 * Get Odoo command presets
	 */
	public getOdooCommandPresets(category?: string, sessionId?: string): any[] {
		const session = sessionId ? this.sessions.get(sessionId) : this.getActiveSession()
		if (!session || !session.odooIntegration) {
			return []
		}

		return session.odooIntegration.getCommandPresets(category)
	}

	/**
	 * Get debugging sessions
	 */
	public getDebuggingSessions(sessionId?: string): any[] {
		const session = sessionId ? this.sessions.get(sessionId) : this.getActiveSession()
		if (!session || !session.debuggingLoop) {
			return []
		}

		return session.debuggingLoop.getSessions()
	}

	/**
	 * Get security statistics
	 */
	public getSecurityStats(sessionId?: string): any {
		const session = sessionId ? this.sessions.get(sessionId) : this.getActiveSession()
		if (!session) {
			return null
		}

		return session.securityGate.getSecurityStats()
	}

	/**
	 * Update configuration
	 */
	public updateConfig(updates: Partial<AntiGravityTerminalConfig>): void {
		this.config = { ...this.config, ...updates }
		this.emit("configUpdated", this.config)
	}

	/**
	 * Get current configuration
	 */
	public getConfig(): AntiGravityTerminalConfig {
		return { ...this.config }
	}

	/**
	 * Setup event handlers for a session
	 */
	private setupSessionEventHandlers(session: TerminalSession): void {
		// Forward PTY events
		session.ptyManager.on("output", (entry) => {
			session.terminalBuffer.addEntry(entry)
			this.emit("terminalOutput", { sessionId: session.id, entry })
		})

		session.ptyManager.on("commandStarted", (command) => {
			this.emit("commandStarted", { sessionId: session.id, command })
		})

		session.ptyManager.on("processExit", ({ exitCode }) => {
			this.emit("commandCompleted", { sessionId: session.id, exitCode })
		})

		// Forward AI Action Tools events
		session.aiActionTools.on("patternMatch", (match) => {
			this.emit("patternMatch", { sessionId: session.id, match })
		})

		session.aiActionTools.on("commandExecuted", (result) => {
			this.emit("commandExecuted", { sessionId: session.id, result })
		})

		// Forward debugging events
		if (session.debuggingLoop) {
			session.debuggingLoop.on("errorsDetected", (errors) => {
				this.emit("errorsDetected", { sessionId: session.id, errors })
			})

			session.debuggingLoop.on("fixAttempted", (attempt) => {
				this.emit("fixAttempted", { sessionId: session.id, attempt })
			})

			session.debuggingLoop.on("debuggingResolved", (debuggingSession) => {
				this.emit("debuggingResolved", { sessionId: session.id, debuggingSession })
			})
		}

		// Forward Odoo events
		if (session.odooIntegration) {
			session.odooIntegration.on("odooErrorDetected", (error) => {
				this.emit("odooErrorDetected", { sessionId: session.id, error })
			})

			session.odooIntegration.on("odooCommandExecuted", (result) => {
				this.emit("odooCommandExecuted", { sessionId: session.id, result })
			})
		}

		// Forward security events
		session.securityGate.on("approvalRequested", (request) => {
			this.emit("approvalRequested", { sessionId: session.id, request })
		})

		session.securityGate.on("approvalResponded", ({ request, response }) => {
			this.emit("approvalResponded", { sessionId: session.id, request, response })
		})
	}

	/**
	 * Close a session
	 */
	public async closeSession(sessionId: string): Promise<boolean> {
		const session = this.sessions.get(sessionId)
		if (!session) {
			return false
		}

		this.outputChannel.appendLine(`[AntiGravity Terminal] Closing session: ${sessionId}`)

		try {
			// Stop components
			if (session.debuggingLoop) {
				session.debuggingLoop.stop()
			}
			if (session.odooIntegration) {
				session.odooIntegration.stop()
			}

			// Stop listening
			session.aiActionTools.stopListening()

			// Kill PTY
			session.ptyManager.kill()

			// Dispose components
			session.ptyManager.dispose()
			session.aiActionTools.dispose()
			session.securityGate.dispose()
			if (session.debuggingLoop) {
				session.debuggingLoop.dispose()
			}
			if (session.odooIntegration && typeof session.odooIntegration.dispose === "function") {
				session.odooIntegration.dispose()
			}

			// Remove from sessions
			this.sessions.delete(sessionId)

			// Update active session if needed
			if (this.activeSessionId === sessionId) {
				this.activeSessionId = this.sessions.size > 0 ? Array.from(this.sessions.keys())[0] : null
			}

			session.isActive = false
			this.emit("sessionClosed", session)

			this.outputChannel.appendLine(`[AntiGravity Terminal] Session closed: ${sessionId}`)
			return true
		} catch (error) {
			this.outputChannel.appendLine(`[AntiGravity Terminal] Error closing session: ${error}`)
			return false
		}
	}

	/**
	 * Close all sessions
	 */
	public async closeAllSessions(): Promise<void> {
		const sessionIds = Array.from(this.sessions.keys())
		await Promise.all(sessionIds.map((id) => this.closeSession(id)))
	}

	/**
	 * Get service statistics
	 */
	public getStats(): {
		totalSessions: number
		activeSessions: number
		totalCommands: number
		totalErrors: number
		uptime: number
	} {
		const sessions = Array.from(this.sessions.values())
		const activeSessions = sessions.filter((s) => s.isActive).length

		return {
			totalSessions: sessions.length,
			activeSessions,
			totalCommands: 0, // Would need to track this
			totalErrors: 0, // Would need to track this
			uptime: Date.now() - (sessions[0]?.startTime || Date.now()),
		}
	}

	/**
	 * Dispose of the service
	 */
	public async dispose(): Promise<void> {
		this.outputChannel.appendLine("[AntiGravity Terminal] Disposing service")

		await this.closeAllSessions()
		this.removeAllListeners()

		this.outputChannel.appendLine("[AntiGravity Terminal] Service disposed")
	}
}
