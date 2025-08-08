import { CLIFileSystemProvider } from "./CLIFileSystemProvider"
import { CLIUserInterfaceProvider } from "./CLIUserInterfaceProvider"
import { CLIConfigurationProvider } from "./CLIConfigurationProvider"
import { CLIProcessExecutorProvider } from "./CLIProcessExecutorProvider"
import { CLILoggerProvider } from "./CLILoggerProvider"

// Import shared types to avoid duplication
import { PlatformFeatures } from "../types"

import type {
	IPlatformAdapter,
	LogLevel,
	ConfigurationScope,
	ILogger,
	LogContext,
	LogMetadata,
	ExecutionOptions,
	ExecutionResult,
	ProgressReporter,
	ProgressOptions,
	InputOptions,
	ConfirmationOptions,
} from "../types"

/**
 * CLI platform adapter that combines all CLI providers into a single adapter.
 * Provides comprehensive platform-specific functionality for command-line environments.
 */
export class CLIPlatformAdapter implements IPlatformAdapter {
	readonly name = "cli"
	readonly fileSystem: CLIFileSystemProvider
	readonly userInterface: CLIUserInterfaceProvider
	readonly configuration: CLIConfigurationProvider
	readonly processExecutor: CLIProcessExecutorProvider
	readonly logger: CLILoggerProvider

	private initialized = false
	private disposed = false

	constructor(
		options: {
			interactive?: boolean
			configName?: string
			logLevel?: LogLevel
		} = {},
	) {
		this.fileSystem = new CLIFileSystemProvider()
		this.userInterface = new CLIUserInterfaceProvider(options.interactive)
		this.configuration = new CLIConfigurationProvider(options.configName)
		this.processExecutor = new CLIProcessExecutorProvider()
		this.logger = new CLILoggerProvider(options.logLevel)
	}

	async initialize(): Promise<void> {
		if (this.initialized) {
			return
		}

		// this.logger.info("Initializing CLI platform adapter")

		try {
			// Initialize configuration first as other services may depend on it
			await this.configuration.initialize()
			// this.logger.debug("Configuration provider initialized")

			// Other providers don't need explicit initialization
			// this.logger.debug("All providers initialized successfully")

			this.initialized = true
			// this.logger.info("CLI platform adapter initialized successfully")
		} catch (error) {
			this.logger.error("Failed to initialize CLI platform adapter", error as Error)
			throw error
		}
	}

	async dispose(): Promise<void> {
		if (this.disposed) {
			return
		}

		this.logger.info("Disposing CLI platform adapter")

		try {
			// Dispose providers in reverse order of initialization
			this.processExecutor.dispose()
			this.configuration.dispose()
			this.userInterface.dispose()
			this.fileSystem.dispose()

			// Dispose logger last
			await this.logger.dispose()

			this.disposed = true
		} catch (error) {
			console.error("Error disposing CLI platform adapter:", error)
			throw error
		}
	}

	supportsFeature(feature: string): boolean {
		switch (feature) {
			case PlatformFeatures.RichFormatting:
				return this.userInterface.supportsRichFormatting()

			case PlatformFeatures.InteractiveInput:
				return this.userInterface.isInteractive()

			case PlatformFeatures.FileWatching:
				return true // File system provider supports watching

			case PlatformFeatures.ProcessSpawning:
				return true // Process executor supports spawning

			case PlatformFeatures.ProgressReporting:
				return true // User interface supports progress

			case PlatformFeatures.ColorOutput:
				return this.userInterface.supportsRichFormatting()

			case PlatformFeatures.FileDialogs:
				return this.userInterface.isInteractive() // Basic file dialogs via prompts

			default:
				return false
		}
	}

	/**
	 * Get platform-specific information.
	 */
	getPlatformInfo(): Record<string, any> {
		return {
			name: this.name,
			platform: process.platform,
			arch: process.arch,
			nodeVersion: process.version,
			interactive: this.userInterface.isInteractive(),
			supportsColor: this.userInterface.supportsRichFormatting(),
			cwd: this.processExecutor.getCwd(),
			env: Object.keys(this.processExecutor.getEnv()).length,
		}
	}

	/**
	 * Set interactive mode for the user interface.
	 */
	setInteractive(interactive: boolean): void {
		this.userInterface.setInteractive(interactive)
	}

	/**
	 * Get the current working directory.
	 */
	getCwd(): string {
		return this.processExecutor.getCwd()
	}

	/**
	 * Change the current working directory.
	 */
	async setCwd(path: string): Promise<void> {
		await this.processExecutor.setCwd(path)
	}

	/**
	 * Check if the adapter is initialized.
	 */
	isInitialized(): boolean {
		return this.initialized
	}

	/**
	 * Check if the adapter is disposed.
	 */
	isDisposed(): boolean {
		return this.disposed
	}

	/**
	 * Create a child logger with additional context.
	 */
	createChildLogger(context: LogContext): ILogger {
		return this.logger.child(context)
	}

	/**
	 * Execute a command and return the result.
	 */
	async executeCommand(command: string, options?: ExecutionOptions): Promise<ExecutionResult> {
		return this.processExecutor.execute(command, options)
	}

	/**
	 * Show a progress indicator while executing a task.
	 */
	async showProgress<T>(
		title: string,
		task: (progress: ProgressReporter) => Promise<T>,
		options?: ProgressOptions,
	): Promise<T> {
		return this.userInterface.showProgress(title, task, options)
	}

	/**
	 * Ask the user a question.
	 */
	async askQuestion(prompt: string, options?: InputOptions): Promise<string | undefined> {
		return this.userInterface.askQuestion(prompt, options)
	}

	/**
	 * Ask the user for confirmation.
	 */
	async askConfirmation(prompt: string, options?: ConfirmationOptions): Promise<boolean> {
		return this.userInterface.askConfirmation(prompt, options)
	}

	/**
	 * Read a file as string.
	 */
	async readFile(path: string, encoding?: BufferEncoding): Promise<string> {
		return this.fileSystem.readFile(path, encoding)
	}

	/**
	 * Write content to a file.
	 */
	async writeFile(path: string, content: string | Buffer, encoding?: BufferEncoding): Promise<void> {
		return this.fileSystem.writeFile(path, content, encoding)
	}

	/**
	 * Check if a file or directory exists.
	 */
	async exists(path: string): Promise<boolean> {
		return this.fileSystem.exists(path)
	}

	/**
	 * Get configuration value.
	 */
	getConfig<T>(key: string, defaultValue?: T): T | undefined {
		return this.configuration.get(key, defaultValue)
	}

	/**
	 * Set configuration value.
	 */
	async setConfig<T>(key: string, value: T, scope?: ConfigurationScope): Promise<void> {
		return this.configuration.set(key, value, scope)
	}

	/**
	 * Log an info message.
	 */
	logInfo(message: string, meta?: LogMetadata): void {
		this.logger.info(message, meta)
	}

	/**
	 * Log an error message.
	 */
	logError(message: string, error?: Error, meta?: LogMetadata): void {
		this.logger.error(message, error, meta)
	}

	/**
	 * Log a debug message.
	 */
	logDebug(message: string, meta?: LogMetadata): void {
		this.logger.debug(message, meta)
	}

	/**
	 * Log a warning message.
	 */
	logWarn(message: string, meta?: LogMetadata): void {
		this.logger.warn(message, meta)
	}
}
