import * as fs from "fs/promises"
import * as path from "path"
import type { ILogger, LogMetadata, LogContext } from "../types"
import { LogLevel } from "../types"

// Additional interfaces needed for this provider
export interface LogEntry {
	level: LogLevel
	message: string
	timestamp: Date
	meta: LogMetadata
	error?: Error
}

export interface LogTransport {
	name: string
	level: LogLevel
	enabled: boolean
	write(entry: LogEntry): Promise<void>
	flush(): Promise<void>
	close(): Promise<void>
}

export interface FileTransportOptions {
	filename: string
	maxSize?: number
	maxFiles?: number
	append?: boolean
	format?: (entry: LogEntry) => string
}

export interface ConsoleTransportOptions {
	level?: LogLevel
	colorize?: boolean
	format?: (entry: LogEntry) => string
}

export interface LogFormatter {
	format(entry: LogEntry): string
}

export interface ProgressLogger {
	update(current: number, message?: string): void
	increment(message?: string): void
	complete(message?: string): void
	fail(error: Error, message?: string): void
	getProgress(): number
}

/**
 * File transport for logging to files.
 */
class FileTransport implements LogTransport {
	name = "file"
	level: LogLevel
	enabled: boolean = true
	private options: FileTransportOptions
	private writeQueue: Promise<void> = Promise.resolve()

	constructor(level: LogLevel, options: FileTransportOptions) {
		this.level = level
		this.options = {
			maxSize: 10 * 1024 * 1024, // 10MB default
			maxFiles: 5,
			append: true,
			...options,
		}
	}

	async write(entry: LogEntry): Promise<void> {
		if (!this.enabled || entry.level < this.level) {
			return
		}

		const formatted = this.options.format ? this.options.format(entry) : this.defaultFormat(entry)

		// Queue writes to prevent race conditions
		this.writeQueue = this.writeQueue.then(async () => {
			await this.ensureDirectoryExists()
			await this.rotateIfNeeded()

			const mode = this.options.append ? "a" : "w"
			await fs.writeFile(this.options.filename, formatted + "\n", { flag: mode })
		})

		await this.writeQueue
	}

	async flush(): Promise<void> {
		await this.writeQueue
	}

	async close(): Promise<void> {
		await this.flush()
	}

	private defaultFormat(entry: LogEntry): string {
		const timestamp = entry.timestamp.toISOString()
		const levelName = Object.keys(LogLevel)[Object.values(LogLevel).indexOf(entry.level)]
		const level = levelName?.toUpperCase() || "UNKNOWN"
		const component = entry.meta.component ? `[${entry.meta.component}]` : ""

		let message = `${timestamp} [${level}] ${component} ${entry.message}`

		if (entry.error) {
			message += `\n${entry.error.stack || entry.error.message}`
		}

		return message
	}

	private async ensureDirectoryExists(): Promise<void> {
		const dir = path.dirname(this.options.filename)
		await fs.mkdir(dir, { recursive: true })
	}

	private async rotateIfNeeded(): Promise<void> {
		if (!this.options.maxSize) return

		try {
			const stats = await fs.stat(this.options.filename)
			if (stats.size >= this.options.maxSize) {
				await this.rotateFiles()
			}
		} catch {
			// File doesn't exist yet, no rotation needed
		}
	}

	private async rotateFiles(): Promise<void> {
		const { filename, maxFiles = 5 } = this.options
		const ext = path.extname(filename)
		const base = filename.slice(0, -ext.length)

		// Remove oldest file if we're at the limit
		const oldestFile = `${base}.${maxFiles}${ext}`
		try {
			await fs.unlink(oldestFile)
		} catch {
			// File doesn't exist, ignore
		}

		// Rotate existing files
		for (let i = maxFiles - 1; i >= 1; i--) {
			const currentFile = i === 1 ? filename : `${base}.${i}${ext}`
			const nextFile = `${base}.${i + 1}${ext}`

			try {
				await fs.rename(currentFile, nextFile)
			} catch {
				// File doesn't exist, ignore
			}
		}
	}
}

/**
 * Progress logger implementation for tracking long-running operations.
 */
class CLIProgressLogger implements ProgressLogger {
	private current: number = 0
	private total: number
	private label: string
	private logger: ILogger

	constructor(total: number, label: string, logger: ILogger) {
		this.total = total
		this.label = label
		this.logger = logger
	}

	update(current: number, message?: string): void {
		this.current = current
		const percentage = Math.round((current / this.total) * 100)
		const progressMessage = message || `${this.label} progress`
		this.logger.info(`${progressMessage}: ${current}/${this.total} (${percentage}%)`)
	}

	increment(message?: string): void {
		this.update(this.current + 1, message)
	}

	complete(message?: string): void {
		this.current = this.total
		const completionMessage = message || `${this.label} completed`
		this.logger.info(`${completionMessage}: ${this.total}/${this.total} (100%)`)
	}

	fail(error: Error, message?: string): void {
		const failureMessage = message || `${this.label} failed`
		this.logger.error(`${failureMessage}: ${error.message}`, error)
	}

	getProgress(): number {
		return Math.round((this.current / this.total) * 100)
	}
}

/**
 * Console transport for logging to stdout/stderr
 */
class ConsoleTransport implements LogTransport {
	name: string = "console"
	level: LogLevel
	enabled: boolean = true

	constructor(level: LogLevel = LogLevel.Info) {
		this.level = level
	}

	async write(entry: LogEntry): Promise<void> {
		if (!this.enabled || entry.level < this.level) return

		const timestamp = new Date(entry.timestamp).toISOString()
		const levelName = LogLevel[entry.level] || "UNKNOWN"
		const formattedMessage = `[${timestamp}] ${levelName}: ${entry.message}`

		// Log errors to stderr, everything else to stdout
		if (entry.level >= LogLevel.Error) {
			console.error(formattedMessage, entry.meta)
		} else {
			console.log(formattedMessage, entry.meta)
		}
	}

	async flush(): Promise<void> {
		// Console doesn't need flushing
	}

	async close(): Promise<void> {
		// Console doesn't need closing
	}
}

/**
 * CLI implementation of the ILogger interface.
 * Provides comprehensive logging capabilities for command-line environments.
 */
export class CLILoggerProvider implements ILogger {
	private level: LogLevel = LogLevel.Info
	private enabled: boolean = true
	private transports: LogTransport[] = []
	private context: LogContext = {}
	private timers = new Map<string, number>()

	constructor(level: LogLevel = LogLevel.Info) {
		this.level = level
		// Add default console transport
		this.addTransport(new ConsoleTransport(level))
	}

	debug(message: string, meta: LogMetadata = {}): void {
		this.log(LogLevel.Debug, message, meta)
	}

	info(message: string, meta: LogMetadata = {}): void {
		this.log(LogLevel.Info, message, meta)
	}

	warn(message: string, meta: LogMetadata = {}): void {
		this.log(LogLevel.Warn, message, meta)
	}

	error(message: string, error?: Error, meta: LogMetadata = {}): void {
		const entry: LogEntry = {
			level: LogLevel.Error,
			message,
			timestamp: new Date(),
			meta: { ...this.context, ...meta },
			error,
		}
		this.writeToTransports(entry)
	}

	log(level: LogLevel, message: string, meta: LogMetadata = {}): void {
		if (!this.enabled || level < this.level) {
			return
		}

		const entry: LogEntry = {
			level,
			message,
			timestamp: new Date(),
			meta: { ...this.context, ...meta },
		}

		this.writeToTransports(entry)
	}

	child(context: LogContext): ILogger {
		const childLogger = new CLILoggerProvider(this.level)
		childLogger.context = { ...this.context, ...context }
		childLogger.enabled = this.enabled
		childLogger.transports = [...this.transports]
		return childLogger
	}

	setLevel(level: number): void {
		this.level = level as LogLevel
	}

	getLevel(): number {
		return this.level
	}

	isLevelEnabled(level: LogLevel): boolean {
		return this.enabled && level >= this.level
	}

	addTransport(transport: LogTransport): void {
		this.transports.push(transport)
	}

	removeTransport(transport: LogTransport): void {
		const index = this.transports.indexOf(transport)
		if (index > -1) {
			this.transports.splice(index, 1)
		}
	}

	clearTransports(): void {
		this.transports = []
	}

	async flush(): Promise<void> {
		await Promise.all(
			this.transports
				.filter((transport) => transport && typeof transport.flush === "function")
				.map((transport) => transport.flush()),
		)
	}

	time(label: string): void {
		this.timers.set(label, Date.now())
	}

	timeEnd(label: string, level: LogLevel = LogLevel.Info): void {
		const startTime = this.timers.get(label)
		if (startTime) {
			const duration = Date.now() - startTime
			this.log(level, `${label}: ${duration}ms`)
			this.timers.delete(label)
		}
	}

	memory(label?: string, level: LogLevel = LogLevel.Debug): void {
		const memUsage = process.memoryUsage()
		const message = label ? `${label} - Memory usage` : "Memory usage"
		const memInfo = {
			rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
			heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
			heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
			external: `${Math.round(memUsage.external / 1024 / 1024)}MB`,
		}
		this.log(level, `${message}: ${JSON.stringify(memInfo)}`)
	}

	progress(total: number, label?: string): ProgressLogger {
		return new CLIProgressLogger(total, label || "Operation", this)
	}

	structured(level: LogLevel, data: Record<string, any>, message?: string): void {
		const structuredMessage = message || "Structured data"
		this.log(level, `${structuredMessage}: ${JSON.stringify(data, null, 2)}`)
	}

	setEnabled(enabled: boolean): void {
		this.enabled = enabled
	}

	isEnabled(): boolean {
		return this.enabled
	}

	/**
	 * Add a file transport for logging to files.
	 */
	addFileTransport(
		filename: string,
		level: LogLevel = LogLevel.Info,
		options: Partial<FileTransportOptions> = {},
	): void {
		const fileTransport = new FileTransport(level, { filename, ...options })
		this.addTransport(fileTransport)
	}

	/**
	 * Write log entry to all transports.
	 */
	private async writeToTransports(entry: LogEntry): Promise<void> {
		const promises = this.transports.map((transport) => transport.write(entry))
		await Promise.all(promises)
	}

	/**
	 * Dispose all transports and clean up resources.
	 */
	async dispose(): Promise<void> {
		await this.flush()
		await Promise.all(
			this.transports
				.filter((transport) => transport && typeof transport.close === "function")
				.map((transport) => transport.close()),
		)
		this.transports = []
		this.timers.clear()
	}
}
