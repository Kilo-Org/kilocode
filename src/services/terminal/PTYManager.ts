import * as pty from "@lydell/node-pty"
import * as vscode from "vscode"
import { EventEmitter } from "events"
import stripAnsi from "strip-ansi"

export interface PTYManagerOptions {
	shell: string
	cwd: string
	env?: Record<string, string>
	terminalId?: number
}

export interface TerminalBufferEntry {
	timestamp: number
	content: string
	type: "stdout" | "stderr"
	cleanContent: string
}

export interface PatternMatch {
	pattern: RegExp
	matches: string[]
	timestamp: number
}

export interface CommandExecution {
	command: string
	startTime: number
	endTime?: number
	exitCode?: number
	output: string[]
}

/**
 * PTY Manager - Enhanced terminal management for AI agents
 * Provides proactive context-aware terminal capabilities with node-pty integration
 */
export class PTYManager extends EventEmitter {
	private ptyProcess: pty.IPty | null = null
	private buffer: TerminalBufferEntry[] = []
	private maxBufferSize = 1000
	private activePatterns: Map<string, RegExp> = new Map()
	private currentCommand: CommandExecution | null = null
	private commandHistory: CommandExecution[] = []
	private isListening = false
	private terminalId: number

	constructor(private options: PTYManagerOptions) {
		super()
		this.terminalId = options.terminalId || Date.now()
		this.initializePTY()
	}

	private initializePTY(): void {
		const env = {
			...process.env,
			...this.options.env,
			// Kilo Code specific environment variables
			KILOCODE_TERMINAL_ID: this.terminalId.toString(),
			KILOCODE_AI_ENABLED: "true",
		}

		this.ptyProcess = pty.spawn(this.options.shell, [], {
			name: "xterm-256color",
			cwd: this.options.cwd,
			env,
			cols: 80,
			rows: 30,
		})

		this.setupPTYEventHandlers()
	}

	private setupPTYEventHandlers(): void {
		if (!this.ptyProcess) return

		this.ptyProcess.onData((data: string) => {
			this.handleTerminalOutput(data, "stdout")
		})

		this.ptyProcess.onExit(({ exitCode, signal }) => {
			this.handleProcessExit({ exitCode, signal })
		})
	}

	private handleTerminalOutput(data: string, type: "stdout" | "stderr"): void {
		const cleanContent = stripAnsi(data)
		const entry: TerminalBufferEntry = {
			timestamp: Date.now(),
			content: data,
			type,
			cleanContent,
		}

		this.addToBuffer(entry)
		this.emit("output", entry)

		if (this.isListening) {
			this.checkForPatterns(cleanContent)
		}

		if (this.currentCommand) {
			this.currentCommand.output.push(data)
		}
	}

	private handleProcessExit({ exitCode, signal }: { exitCode?: number; signal?: number }): void {
		if (this.currentCommand) {
			this.currentCommand.endTime = Date.now()
			this.currentCommand.exitCode = exitCode
			this.commandHistory.push(this.currentCommand)
			this.currentCommand = null
		}

		this.emit("processExit", { exitCode, signal })
	}

	private addToBuffer(entry: TerminalBufferEntry): void {
		this.buffer.push(entry)

		// Maintain buffer size limit
		if (this.buffer.length > this.maxBufferSize) {
			this.buffer = this.buffer.slice(-this.maxBufferSize)
		}
	}

	private checkForPatterns(content: string): void {
		for (const [name, pattern] of Array.from(this.activePatterns.entries())) {
			const matches = content.match(pattern)
			if (matches) {
				this.emit("patternMatch", {
					pattern,
					matches,
					timestamp: Date.now(),
					patternName: name,
				})
			}
		}
	}

	/**
	 * Execute a command in the terminal
	 */
	public executeCommand(command: string): Promise<CommandExecution> {
		return new Promise((resolve, reject) => {
			if (!this.ptyProcess) {
				reject(new Error("PTY process not initialized"))
				return
			}

			this.currentCommand = {
				command,
				startTime: Date.now(),
				output: [],
			}

			// Set up one-time listener for command completion
			const onProcessExit = ({ exitCode }: { exitCode?: number }) => {
				this.off("processExit", onProcessExit)
				if (this.currentCommand) {
					resolve(this.currentCommand)
				}
			}

			this.once("processExit", onProcessExit)

			try {
				this.ptyProcess.write(command + "\r")
				this.emit("commandStarted", command)
			} catch (error) {
				this.off("processExit", onProcessExit)
				reject(error)
			}
		})
	}

	/**
	 * Write data directly to the terminal
	 */
	public write(data: string): void {
		if (this.ptyProcess) {
			this.ptyProcess.write(data)
		}
	}

	/**
	 * Resize the terminal
	 */
	public resize(cols: number, rows: number): void {
		if (this.ptyProcess) {
			this.ptyProcess.resize(cols, rows)
		}
	}

	/**
	 * Start listening for specific patterns in terminal output
	 */
	public startListening(patterns: { name: string; regex: RegExp }[]): void {
		this.isListening = true
		this.activePatterns.clear()

		for (const pattern of patterns) {
			this.activePatterns.set(pattern.name, pattern.regex)
		}

		this.emit("listeningStarted", patterns)
	}

	/**
	 * Stop listening for patterns
	 */
	public stopListening(): void {
		this.isListening = false
		this.activePatterns.clear()
		this.emit("listeningStopped")
	}

	/**
	 * Get recent terminal output for AI context
	 */
	public getRecentOutput(lines = 50): TerminalBufferEntry[] {
		return this.buffer.slice(-lines)
	}

	/**
	 * Get clean output (ANSI codes stripped) for AI processing
	 */
	public getCleanRecentOutput(lines = 50): string[] {
		return this.getRecentOutput(lines).map((entry) => entry.cleanContent)
	}

	/**
	 * Search terminal buffer for content
	 */
	public searchBuffer(query: string, useRegex = false): TerminalBufferEntry[] {
		const searchPattern = useRegex
			? new RegExp(query, "i")
			: new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")

		return this.buffer.filter(
			(entry) => searchPattern.test(entry.content) || searchPattern.test(entry.cleanContent),
		)
	}

	/**
	 * Get command history
	 */
	public getCommandHistory(): CommandExecution[] {
		return [...this.commandHistory]
	}

	/**
	 * Get the current running command
	 */
	public getCurrentCommand(): CommandExecution | null {
		return this.currentCommand
	}

	/**
	 * Clear the terminal buffer
	 */
	public clearBuffer(): void {
		this.buffer = []
		this.emit("bufferCleared")
	}

	/**
	 * Kill the PTY process
	 */
	public kill(): void {
		if (this.ptyProcess) {
			this.ptyProcess.kill()
			this.ptyProcess = null
		}
	}

	/**
	 * Check if the PTY process is active
	 */
	public isActive(): boolean {
		return this.ptyProcess !== null
	}

	/**
	 * Get terminal info
	 */
	public getTerminalInfo(): { terminalId: number; shell: string; cwd: string; isActive: boolean } {
		return {
			terminalId: this.terminalId,
			shell: this.options.shell,
			cwd: this.options.cwd,
			isActive: this.isActive(),
		}
	}

	/**
	 * Set buffer size limit
	 */
	public setBufferSizeLimit(limit: number): void {
		this.maxBufferSize = limit
		if (this.buffer.length > limit) {
			this.buffer = this.buffer.slice(-limit)
		}
	}

	/**
	 * Dispose of the PTY manager
	 */
	public dispose(): void {
		this.kill()
		this.removeAllListeners()
		this.buffer = []
		this.activePatterns.clear()
		this.commandHistory = []
		this.currentCommand = null
	}
}
