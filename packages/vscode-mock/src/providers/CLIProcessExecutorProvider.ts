import { spawn, exec, ChildProcess } from "child_process"
import { promisify } from "util"
import type { IProcessExecutor, ExecutionOptions, ExecutionResult, ProcessHandle, ProcessSignal } from "../types"
import { ProcessStatus } from "../types"

// Additional interfaces needed for this provider
export interface StreamingExecutionOptions extends ExecutionOptions {
	onStdout?: (data: string) => void
	onStderr?: (data: string) => void
	onExit?: (code: number | null, signal: string | null) => void
	onError?: (error: Error) => void
	input?: string
}

export interface SpawnOptions {
	cwd?: string
	env?: Record<string, string>
	stdio?: "pipe" | "inherit" | "ignore"
	detached?: boolean
	shell?: boolean | string
}

export interface ProcessInfo {
	pid: number
	name: string
	command: string
	status: ProcessStatus
}

export interface ProcessFilter {
	name?: string
	pid?: number
	status?: ProcessStatus
}

const execAsync = promisify(exec)

/**
 * Process handle implementation for long-running processes.
 */
class CLIProcessHandle implements ProcessHandle {
	private process: ChildProcess
	private stdoutCallbacks: Array<(data: string) => void> = []
	private stderrCallbacks: Array<(data: string) => void> = []
	private exitCallbacks: Array<(code: number | null, signal: string | null) => void> = []
	private errorCallbacks: Array<(error: Error) => void> = []

	constructor(process: ChildProcess) {
		this.process = process
		this.setupEventHandlers()
	}

	get pid(): number {
		return this.process.pid || 0
	}

	async kill(signal: ProcessSignal = "SIGTERM"): Promise<void> {
		return new Promise((resolve, reject) => {
			if (!this.process.kill(signal)) {
				reject(new Error(`Failed to kill process ${this.pid}`))
			} else {
				resolve()
			}
		})
	}

	async wait(): Promise<ExecutionResult> {
		return new Promise((resolve, reject) => {
			let stdout = ""
			let stderr = ""
			const startTime = Date.now()

			if (this.process.stdout) {
				this.process.stdout.on("data", (data) => {
					stdout += data.toString()
				})
			}

			if (this.process.stderr) {
				this.process.stderr.on("data", (data) => {
					stderr += data.toString()
				})
			}

			this.process.on("close", (code, signal) => {
				const duration = Date.now() - startTime
				resolve({
					exitCode: code || 0,
					stdout,
					stderr,
					success: code === 0,
					duration,
					command: this.process.spawnargs?.join(" ") || "",
					pid: this.pid,
					signal: signal || undefined,
				})
			})

			this.process.on("error", reject)
		})
	}

	async isRunning(): Promise<boolean> {
		try {
			return !this.process.killed && this.process.exitCode === null
		} catch {
			return false
		}
	}

	async write(data: string): Promise<void> {
		return new Promise((resolve, reject) => {
			if (!this.process.stdin) {
				reject(new Error("Process stdin is not available"))
				return
			}

			this.process.stdin.write(data, (error) => {
				if (error) {
					reject(error)
				} else {
					resolve()
				}
			})
		})
	}

	async end(): Promise<void> {
		return new Promise((resolve) => {
			if (this.process.stdin) {
				this.process.stdin.end()
			}
			resolve()
		})
	}

	onStdout(callback: (data: string) => void): void {
		this.stdoutCallbacks.push(callback)
	}

	onStderr(callback: (data: string) => void): void {
		this.stderrCallbacks.push(callback)
	}

	onExit(callback: (code: number | null, signal: string | null) => void): void {
		this.exitCallbacks.push(callback)
	}

	onError(callback: (error: Error) => void): void {
		this.errorCallbacks.push(callback)
	}

	dispose(): void {
		this.stdoutCallbacks = []
		this.stderrCallbacks = []
		this.exitCallbacks = []
		this.errorCallbacks = []

		if (!this.process.killed) {
			this.process.kill("SIGTERM")
		}
	}

	private setupEventHandlers(): void {
		if (this.process.stdout) {
			this.process.stdout.on("data", (data) => {
				const text = data.toString()
				this.stdoutCallbacks.forEach((callback) => callback(text))
			})
		}

		if (this.process.stderr) {
			this.process.stderr.on("data", (data) => {
				const text = data.toString()
				this.stderrCallbacks.forEach((callback) => callback(text))
			})
		}

		this.process.on("exit", (code, signal) => {
			this.exitCallbacks.forEach((callback) => callback(code, signal))
		})

		this.process.on("error", (error) => {
			this.errorCallbacks.forEach((callback) => callback(error))
		})
	}
}

/**
 * CLI implementation of the IProcessExecutor interface using Node.js child_process.
 * Provides comprehensive process execution capabilities for command-line environments.
 */
export class CLIProcessExecutorProvider implements IProcessExecutor {
	private currentWorkingDirectory: string = process.cwd()
	private environmentVariables: Record<string, string> = {}

	constructor() {
		// Filter out undefined values from process.env
		for (const [key, value] of Object.entries(process.env)) {
			if (value !== undefined) {
				this.environmentVariables[key] = value
			}
		}
	}

	async execute(command: string, options: ExecutionOptions = {}): Promise<ExecutionResult> {
		const startTime = Date.now()
		const execOptions = {
			cwd: options.cwd || this.currentWorkingDirectory,
			env: { ...this.environmentVariables, ...options.env },
			timeout: options.timeout,
			maxBuffer: options.maxBuffer || 1024 * 1024, // 1MB default
			encoding: options.encoding || ("utf8" as BufferEncoding),
			shell: typeof options.shell === "string" ? options.shell : undefined,
		}

		try {
			const { stdout, stderr } = await execAsync(command, execOptions)
			const duration = Date.now() - startTime

			return {
				exitCode: 0,
				stdout: stdout.toString(),
				stderr: stderr.toString(),
				success: true,
				duration,
				command,
			}
		} catch (error: any) {
			const duration = Date.now() - startTime
			return {
				exitCode: error.code || 1,
				stdout: error.stdout?.toString() || "",
				stderr: error.stderr?.toString() || "",
				success: false,
				duration,
				command,
				error,
			}
		}
	}

	async executeStreaming(command: string, options: StreamingExecutionOptions = {}): Promise<ExecutionResult> {
		return new Promise((resolve, reject) => {
			const startTime = Date.now()
			let stdout = ""
			let stderr = ""

			const execOptions = {
				cwd: options.cwd || this.currentWorkingDirectory,
				env: { ...this.environmentVariables, ...options.env },
				shell: typeof options.shell === "string" ? options.shell : undefined,
			}

			const childProcess = exec(command, execOptions)

			if (childProcess.stdout) {
				childProcess.stdout.on("data", (data) => {
					const text = data.toString()
					stdout += text
					options.onStdout?.(text)
				})
			}

			if (childProcess.stderr) {
				childProcess.stderr.on("data", (data) => {
					const text = data.toString()
					stderr += text
					options.onStderr?.(text)
				})
			}

			childProcess.on("close", (code, signal) => {
				const duration = Date.now() - startTime
				const result: ExecutionResult = {
					exitCode: code || 0,
					stdout,
					stderr,
					success: code === 0,
					duration,
					command,
					pid: childProcess.pid,
					signal: signal || undefined,
				}
				options.onExit?.(code, signal)
				resolve(result)
			})

			childProcess.on("error", (error) => {
				options.onError?.(error)
				reject(error)
			})

			// Handle input if provided
			if (options.input && childProcess.stdin) {
				childProcess.stdin.write(options.input)
				childProcess.stdin.end()
			}
		})
	}

	async spawn(command: string, options: SpawnOptions = {}): Promise<ProcessHandle> {
		const [cmd, ...args] = command.split(" ")
		const spawnOptions = {
			cwd: options.cwd || this.currentWorkingDirectory,
			env: { ...this.environmentVariables, ...options.env },
			stdio: options.stdio || ("pipe" as const),
			detached: options.detached || false,
			shell: options.shell || true,
		}

		const childProcess = spawn(cmd, args, spawnOptions)
		return new CLIProcessHandle(childProcess)
	}

	async executeInShell(command: string, shell: string, options: ExecutionOptions = {}): Promise<ExecutionResult> {
		return this.execute(command, { ...options, shell })
	}

	async executeSequence(commands: string[], options: ExecutionOptions = {}): Promise<ExecutionResult[]> {
		const results: ExecutionResult[] = []

		for (const command of commands) {
			const result = await this.execute(command, options)
			results.push(result)

			// Stop execution if a command fails
			if (!result.success) {
				break
			}
		}

		return results
	}

	async executeParallel(commands: string[], options: ExecutionOptions = {}): Promise<ExecutionResult[]> {
		const promises = commands.map((command) => this.execute(command, options))
		return Promise.all(promises)
	}

	async kill(processId: number | ProcessHandle, signal: ProcessSignal = "SIGTERM"): Promise<void> {
		if (typeof processId === "number") {
			try {
				process.kill(processId, signal)
			} catch (error) {
				throw new Error(`Failed to kill process ${processId}: ${error}`)
			}
		} else {
			await processId.kill(signal)
		}
	}

	async isRunning(processId: number | ProcessHandle): Promise<boolean> {
		if (typeof processId === "number") {
			try {
				process.kill(processId, 0) // Signal 0 checks if process exists
				return true
			} catch {
				return false
			}
		} else {
			return processId.isRunning()
		}
	}

	async getProcessInfo(processId: number | ProcessHandle): Promise<ProcessInfo> {
		const pid = typeof processId === "number" ? processId : processId.pid

		// Basic process info - in a real implementation, you'd use a library like 'ps-list'
		return {
			pid,
			name: "unknown",
			command: "unknown",
			status: ProcessStatus.Running,
		}
	}

	async listProcesses(filter?: ProcessFilter): Promise<ProcessInfo[]> {
		// In a real implementation, you'd use a library like 'ps-list' to get actual process info
		// For now, return empty array
		return []
	}

	getCwd(): string {
		return this.currentWorkingDirectory
	}

	setCwd(path: string): void {
		this.currentWorkingDirectory = path
		process.chdir(path)
	}

	getEnv(): Record<string, string> {
		return { ...this.environmentVariables }
	}

	setEnv(key: string, value: string): void {
		this.environmentVariables[key] = value
		process.env[key] = value
	}

	getDefaultShell(): string {
		return process.platform === "win32" ? "cmd.exe" : "/bin/sh"
	}

	async getAvailableShells(): Promise<string[]> {
		const shells = [this.getDefaultShell()]

		// Try to find common shells
		const commonShells =
			process.platform === "win32"
				? ["cmd.exe", "powershell.exe", "pwsh.exe"]
				: ["/bin/sh", "/bin/bash", "/bin/zsh", "/bin/fish"]

		for (const shell of commonShells) {
			try {
				await this.which(shell)
				if (!shells.includes(shell)) {
					shells.push(shell)
				}
			} catch {
				// Shell not found, skip
			}
		}

		return shells
	}

	async commandExists(command: string): Promise<boolean> {
		try {
			await this.which(command)
			return true
		} catch {
			return false
		}
	}

	async which(command: string): Promise<string | undefined> {
		try {
			// Simple which implementation using PATH
			const paths = (process.env.PATH || "").split(process.platform === "win32" ? ";" : ":")
			const extensions = process.platform === "win32" ? [".exe", ".cmd", ".bat", ".com"] : [""]

			for (const dir of paths) {
				for (const ext of extensions) {
					const fullPath = require("path").join(dir, command + ext)
					try {
						await require("fs/promises").access(
							fullPath,
							require("fs").constants.F_OK | require("fs").constants.X_OK,
						)
						return fullPath
					} catch {
						continue
					}
				}
			}
			return undefined
		} catch {
			return undefined
		}
	}

	/**
	 * Dispose resources and clean up.
	 */
	dispose(): void {
		// Clean up any resources if needed
	}
}
