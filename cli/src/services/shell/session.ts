import { spawn, ChildProcess } from "child_process"
import { detectDefaultShell } from "default-shell"
import { EventEmitter } from "events"
import { logs } from "../logs.js"

export interface ShellSessionOptions {
	timeout?: number
	encoding?: BufferEncoding
}

export interface CommandResult {
	stdout: string
	stderr: string
	exitCode: number
	cwd: string
}

/**
 * Manages a persistent interactive shell session
 * Uses sentinels to track command completion and directory changes
 */
export class ShellSession extends EventEmitter {
	private shellProcess: ChildProcess | null = null
	private currentCwd: string = process.cwd()
	private isReady = false
	private pendingCommand: {
		resolve: (result: CommandResult) => void
		reject: (error: Error) => void
		timeoutId: NodeJS.Timeout
	} | null = null
	private stdoutBuffer = ""
	private stderrBuffer = ""
	private options: Required<ShellSessionOptions>

	constructor(options: ShellSessionOptions = {}) {
		super()
		this.options = {
			timeout: 30000, // 30 seconds
			encoding: "utf8",
			...options,
		}
	}

	/**
	 * Ensure the shell session is initialized and ready
	 */
	async ensureSession(initialCwd: string): Promise<void> {
		if (this.shellProcess && this.isReady) {
			// Session already active, just ensure we're in the right directory
			if (this.currentCwd !== initialCwd) {
				await this.chdir(initialCwd)
			}
			return
		}

		if (this.shellProcess) {
			// Session exists but not ready - this shouldn't happen with our current implementation
			return
		}

		// Start new shell session
		await this.startShell(initialCwd)
	}

	/**
	 * Start the shell process
	 */
	private async startShell(initialCwd: string): Promise<void> {
		const shell = detectDefaultShell() || "/bin/bash" // Fallback to bash if detection fails
		logs.debug(`Starting shell session with: ${shell}`, "ShellSession")

		this.shellProcess = spawn(shell, [], {
			cwd: initialCwd,
			stdio: ["pipe", "pipe", "pipe"],
			env: {
				...process.env,
				// Disable prompts to reduce noise
				PS1: "",
				// For zsh compatibility
				prompt: "",
				RPROMPT: "",
			},
			detached: false,
		})

		this.currentCwd = initialCwd
		this.setupEventHandlers()

		// Mark shell as ready (it becomes ready immediately since we use sentinels)
		this.isReady = true
	}

	/**
	 * Set up event handlers for the shell process
	 */
	private setupEventHandlers(): void {
		if (!this.shellProcess) return

		this.shellProcess.stdout!.on("data", (data) => {
			const output = data.toString(this.options.encoding)
			logs.debug(`Shell stdout: ${output.trim()}`, "ShellSession")
			this.stdoutBuffer += output
			this.checkForSentinel()
		})

		this.shellProcess.stderr!.on("data", (data) => {
			const output = data.toString(this.options.encoding)
			logs.debug(`Shell stderr: ${output.trim()}`, "ShellSession")
			this.stderrBuffer += output
		})

		this.shellProcess.on("close", (code, signal) => {
			logs.debug(`Shell process closed with code: ${code}, signal: ${signal}`, "ShellSession")
			this.shellProcess = null
			this.isReady = false
			this.emit("closed", code, signal)

			if (this.pendingCommand) {
				this.pendingCommand.reject(new Error(`Shell process exited unexpectedly with code ${code}`))
				this.pendingCommand = null
			}
		})

		this.shellProcess.on("error", (error) => {
			logs.error("Shell process error", "ShellSession", { error })
			this.emit("error", error)

			if (this.pendingCommand) {
				this.pendingCommand.reject(error)
				this.pendingCommand = null
			}
		})
	}

	/**
	 * Wait for the shell to be ready
	 */
	private async waitForReady(): Promise<void> {
		if (this.isReady) return

		return new Promise((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				reject(new Error("Shell session initialization timeout"))
			}, this.options.timeout)

			const checkReady = () => {
				if (this.isReady) {
					clearTimeout(timeoutId)
					resolve()
				} else {
					setImmediate(checkReady)
				}
			}

			checkReady()
		})
	}

	/**
	 * Check for sentinel in output to detect command completion
	 */
	private checkForSentinel(): void {
		const sentinelPattern = /__KILO_DONE__:(\d+):(.*)\n$/
		const match = this.stdoutBuffer.match(sentinelPattern)

		if (match && this.pendingCommand) {
			const exitCode = parseInt(match[1] || "0", 10)
			const cwd = match[2] || this.currentCwd

			// Extract output before sentinel (everything up to the sentinel)
			const sentinelIndex = this.stdoutBuffer.lastIndexOf("__KILO_DONE__")
			const outputBeforeSentinel = this.stdoutBuffer.slice(0, sentinelIndex)

			// Split stdout and stderr from the combined output
			// Since we wrap the command, the output before the sentinel includes both stdout and stderr
			const stdout = outputBeforeSentinel.trim()
			const stderr = this.stderrBuffer.trim()

			// Clear buffers
			this.stdoutBuffer = ""
			this.stderrBuffer = ""

			// Update current directory
			this.currentCwd = cwd

			// Resolve pending command
			clearTimeout(this.pendingCommand.timeoutId)
			this.pendingCommand.resolve({
				stdout,
				stderr,
				exitCode,
				cwd,
			})
			this.pendingCommand = null
		}
	}

	/**
	 * Execute a command in the persistent shell
	 */
	async run(command: string): Promise<CommandResult> {
		if (!this.shellProcess || !this.isReady) {
			throw new Error("Shell session not ready")
		}

		if (this.pendingCommand) {
			throw new Error("Command already in progress")
		}

		return new Promise<CommandResult>((resolve, reject) => {
			// Clear any previous output
			this.stdoutBuffer = ""
			this.stderrBuffer = ""

			// Set up timeout
			const timeoutId = setTimeout(() => {
				this.pendingCommand = null
				reject(new Error(`Command timeout after ${this.options.timeout}ms: ${command}`))
			}, this.options.timeout)

			this.pendingCommand = { resolve, reject, timeoutId }

			// Wrap command with sentinel to ensure it's always printed
			// This works across all shells and doesn't rely on PROMPT_COMMAND
			const wrappedCommand = `${command}; printf "__KILO_DONE__:$?:$(pwd)\\n"`

			// Send command to shell
			const commandWithNewline = wrappedCommand + "\n"
			this.shellProcess!.stdin!.write(commandWithNewline, this.options.encoding, (error) => {
				if (error) {
					clearTimeout(timeoutId)
					this.pendingCommand = null
					reject(error)
				}
			})
		})
	}

	/**
	 * Change directory in the shell
	 */
	private async chdir(directory: string): Promise<void> {
		const result = await this.run(`cd "${directory.replace(/"/g, '\\"')}"`)
		if (result.exitCode !== 0) {
			throw new Error(`Failed to change directory to ${directory}: ${result.stderr}`)
		}
		this.currentCwd = result.cwd
	}

	/**
	 * Get the current working directory
	 */
	getCurrentDirectory(): string {
		return this.currentCwd
	}

	/**
	 * Check if the session is ready
	 */
	isSessionReady(): boolean {
		return this.isReady && this.shellProcess !== null
	}

	/**
	 * Dispose of the shell session
	 */
	dispose(): void {
		if (this.pendingCommand) {
			clearTimeout(this.pendingCommand.timeoutId)
			this.pendingCommand.reject(new Error("Shell session disposed"))
			this.pendingCommand = null
		}

		if (this.shellProcess) {
			this.shellProcess.kill()
			this.shellProcess = null
		}

		this.isReady = false
		this.stdoutBuffer = ""
		this.stderrBuffer = ""
		this.emit("disposed")
	}
}
