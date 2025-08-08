/**
 * Shared type definitions for the VS Code mock package
 * These replace the types that were previously imported from @kilo-code/core
 */

// Log levels
export enum LogLevel {
	Debug = 0,
	Info = 1,
	Warn = 2,
	Error = 3,
}

// Platform features
export enum PlatformFeatures {
	Interactive = "interactive",
	RichFormatting = "richFormatting",
	FileDialogs = "fileDialogs",
	Notifications = "notifications",
	FileWatching = "fileWatching",
	ProcessSpawning = "processSpawning",
	ProgressReporting = "progressReporting",
	InteractiveInput = "interactiveInput",
	ColorOutput = "colorOutput",
}

// Configuration scopes
export enum ConfigurationScope {
	Global = "global",
	Workspace = "workspace",
	WorkspaceFolder = "workspaceFolder",
}

// Core interfaces
export interface IPlatformAdapter {
	readonly name: string
	readonly fileSystem: any
	readonly userInterface: any
	readonly configuration: any
	readonly processExecutor: any
	readonly logger: any
	initialize(): Promise<void>
	dispose(): Promise<void>
	isInitialized(): boolean
	isDisposed(): boolean
	supportsFeature(feature: string): boolean
}

export interface ILogger {
	info(message: string, meta?: LogMetadata): void
	debug(message: string, meta?: LogMetadata): void
	warn(message: string, meta?: LogMetadata): void
	error(message: string, error?: Error, meta?: LogMetadata): void
	child(context: LogContext): ILogger
	getLevel(): number
	setLevel(level: number): void
	time(label: string): void
	timeEnd(label: string): void
}

// Console transport implementation
export class ConsoleTransport {
	name = "console"
	level: LogLevel
	enabled: boolean = true

	constructor(level: LogLevel = LogLevel.Info) {
		this.level = level
	}

	async write(entry: any): Promise<void> {
		if (!this.enabled || entry.level < this.level) {
			return
		}

		const timestamp = entry.timestamp.toISOString()
		const levelName = Object.keys(LogLevel)[Object.values(LogLevel).indexOf(entry.level)]
		const component = entry.meta.component ? `[${entry.meta.component}]` : ""

		let message = `${timestamp} [${levelName}] ${component} ${entry.message}`

		if (entry.error) {
			message += `\n${entry.error.stack || entry.error.message}`
		}

		switch (entry.level) {
			case LogLevel.Error:
				console.error(message)
				break
			case LogLevel.Warn:
				console.warn(message)
				break
			case LogLevel.Debug:
				console.debug(message)
				break
			default:
				console.log(message)
		}
	}

	async flush(): Promise<void> {
		// Console doesn't need flushing
	}

	async close(): Promise<void> {
		// Console doesn't need closing
	}
}

export interface LogContext {
	[key: string]: any
}

export interface LogMetadata {
	[key: string]: any
}

export interface ExecutionOptions {
	cwd?: string
	env?: Record<string, string>
	timeout?: number
	shell?: boolean | string
	maxBuffer?: number
	encoding?: BufferEncoding
}

export interface ExecutionResult {
	success: boolean
	exitCode: number
	stdout: string
	stderr: string
	error?: Error
	duration?: number
	command?: string
	pid?: number
	signal?: string
}

export interface SpawnOptions {
	cwd?: string
	env?: Record<string, string>
	stdio?: "pipe" | "inherit" | "ignore"
	detached?: boolean
	shell?: boolean | string
}

export interface ProgressReporter {
	report(message: string): void
	report(increment: number, message?: string): void
}

export interface ProgressOptions {
	location?: string
	title?: string
	cancellable?: boolean
}

export interface InputOptions {
	placeholder?: string
	prompt?: string
	password?: boolean
	ignoreFocusOut?: boolean
}

export interface ConfirmationOptions {
	modal?: boolean
	detail?: string
}

// File System types
export interface IFileSystem {
	readFile(path: string, encoding?: string): Promise<string>
	writeFile(path: string, content: string, encoding?: string): Promise<void>
	appendFile(path: string, content: string, encoding?: string): Promise<void>
	exists(path: string): Promise<boolean>
	stat(path: string): Promise<FileStats>
	readdir(path: string): Promise<DirectoryEntry[]>
	mkdir(path: string, recursive?: boolean): Promise<void>
	rmdir(path: string, recursive?: boolean): Promise<void>
	unlink(path: string): Promise<void>
	copy(source: string, destination: string, options?: CopyOptions): Promise<void>
	move(source: string, destination: string): Promise<void>
	watch(path: string, callback: (event: FileWatchEvent) => void): FileWatcher
	resolve(...paths: string[]): string
	relative(from: string, to: string): string
	join(...paths: string[]): string
	dirname(path: string): string
	basename(path: string, ext?: string): string
	extname(path: string): string
}

export interface FileStats {
	isFile: boolean
	isDirectory: boolean
	size: number
	mtime: Date
	ctime: Date
}

export interface DirectoryEntry {
	name: string
	isFile: boolean
	isDirectory: boolean
}

export interface CopyOptions {
	overwrite?: boolean
	recursive?: boolean
}

export interface FileWatchEvent {
	type: "create" | "change" | "delete"
	path: string
}

export interface FileWatcher {
	dispose(): void
}

// Configuration types
export interface IConfiguration {
	get<T>(key: string, defaultValue?: T): T | undefined
	has(key: string): boolean
	set<T>(key: string, value: T, scope?: ConfigurationScope): Promise<void>
	delete(key: string, scope?: ConfigurationScope): Promise<void>
	getAll(): Record<string, any>
	watch(key: string | undefined, callback: ConfigurationChangeCallback): ConfigurationWatcher
	validate(schema: ConfigurationSchema): ConfigurationValidationResult
	getMetadata(key: string): ConfigurationMetadata | undefined
	getEnv(key: string): string | undefined
}

export interface ConfigurationChangeEvent {
	key: string
	newValue: any
	oldValue: any
	scope: ConfigurationScope
}

export interface ConfigurationChangeCallback {
	(event: ConfigurationChangeEvent): void
}

export interface ConfigurationWatcher {
	dispose(): void
}

export interface ConfigurationSchema {
	properties: {
		[key: string]: {
			type: string
			default?: any
			description?: string
			enum?: any[]
		}
	}
	required?: string[]
}

export interface ConfigurationValidationResult {
	valid: boolean
	errors: string[]
	warnings?: string[]
}

export interface ConfigurationMetadata {
	scope: ConfigurationScope
	source: string
	overridden: boolean
	type?: string
	readOnly?: boolean
}

export enum ConfigurationFormat {
	JSON = "json",
	YAML = "yaml",
	TOML = "toml",
}

// User Interface types
export interface IUserInterface {
	showMessage(message: string, type?: MessageType, actions?: string[]): Promise<string | undefined>
	showProgress<T>(
		title: string,
		task: (progress: ProgressReporter) => Promise<T>,
		options?: ProgressOptions,
	): Promise<T>
	askQuestion(prompt: string, options?: InputOptions): Promise<string | undefined>
	askConfirmation(prompt: string, options?: ConfirmationOptions): Promise<boolean>
	askSelection<T>(prompt: string, items: T[], options?: SelectionOptions<T>): Promise<T | undefined>
	askMultiSelection<T>(prompt: string, items: T[], options?: MultiSelectionOptions<T>): Promise<T[]>
	pickFile(options?: FilePickerOptions): Promise<string | undefined>
	pickFolder(options?: FolderPickerOptions): Promise<string | undefined>
	saveFile(options?: SaveDialogOptions): Promise<string | undefined>
	writeOutput(message: string, options?: OutputOptions): void
	clearOutput(): void
	setStatus(message: string, timeout?: number): void
	isInteractive(): boolean
	supportsRichFormatting(): boolean
	dispose(): void
}

export enum MessageType {
	Info = "info",
	Warning = "warning",
	Error = "error",
}

export interface SelectionOptions<T> {
	placeholder?: string
	canPickMany?: boolean
	matchOnDescription?: boolean
	matchOnDetail?: boolean
}

export interface MultiSelectionOptions<T> {
	placeholder?: string
	matchOnDescription?: boolean
	matchOnDetail?: boolean
}

export interface FilePickerOptions {
	title?: string
	defaultPath?: string
	filters?: Record<string, string[]>
	canSelectFiles?: boolean
	canSelectFolders?: boolean
	canSelectMany?: boolean
}

export interface FolderPickerOptions {
	title?: string
	defaultPath?: string
	canSelectMany?: boolean
}

export interface SaveDialogOptions {
	title?: string
	defaultPath?: string
	filters?: Record<string, string[]>
}

export interface OutputOptions {
	newline?: boolean
	timestamp?: boolean
	level?: string
}

// Process Executor types
export interface IProcessExecutor {
	execute(command: string, options?: ExecutionOptions): Promise<ExecutionResult>
	spawn(command: string, options?: SpawnOptions): Promise<ProcessHandle>
	getCwd(): string
	setCwd(path: string): void
	getEnv(): Record<string, string>
	setEnv(key: string, value: string): void
}

export interface SpawnOptions {
	cwd?: string
	env?: Record<string, string>
	stdio?: "pipe" | "inherit" | "ignore"
	detached?: boolean
	shell?: boolean | string
}

export interface ProcessHandle {
	pid: number
	kill(signal?: ProcessSignal): void
	wait(): Promise<ExecutionResult>
	onExit(callback: (code: number | null, signal?: string | null) => void): void
	onStdout(callback: (data: string) => void): void
	onStderr(callback: (data: string) => void): void
	isRunning(): Promise<boolean>
}

export enum ProcessSignal {
	SIGTERM = "SIGTERM",
	SIGKILL = "SIGKILL",
	SIGINT = "SIGINT",
}

export enum ProcessStatus {
	Running = "running",
	Completed = "completed",
	Failed = "failed",
	Killed = "killed",
}

// Logger types
export interface ITimingLogger {
	time(label: string): void
	timeEnd(label: string): void
}

export interface IProgressLogger {
	startProgress(label: string): void
	updateProgress(label: string, progress: number, message?: string): void
	endProgress(label: string): void
}

export interface ConsoleTransport {
	log(level: LogLevel, message: string, meta?: LogMetadata): void
}

export interface TimingLogger extends ITimingLogger {}
export interface ProgressLogger extends IProgressLogger {}
