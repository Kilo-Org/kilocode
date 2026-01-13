// Copyright 2009-2025 Weibo, Inc.
// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

import { RPCProtocol } from "../deps/vscode/vs/workbench/services/extensions/common/rpcProtocol.js"
import { IRPCProtocol } from "../deps/vscode/vs/workbench/services/extensions/common/proxyIdentifier.js"
import { PersistentProtocol } from "../deps/vscode/vs/base/parts/ipc/common/ipc.net.js"
import { MainContext, ExtHostContext } from "../deps/vscode/vs/workbench/api/common/extHost.protocol.js"
import {
	IRPCProtocolLogger,
	RequestInitiator,
} from "../deps/vscode/vs/workbench/services/extensions/common/rpcProtocol.js"
import { UriComponents, UriDto } from "../deps/vscode/vs/base/common/uri.js"
import { LogLevel } from "../deps/vscode/vs/platform/log/common/log.js"
import { ILoggerResource } from "../deps/vscode/vs/platform/log/common/log.js"
import { TerminalLaunchConfig } from "../deps/vscode/vs/workbench/api/common/extHost.protocol.js"
import { IRawFileMatch2 } from "../deps/vscode/vs/workbench/services/search/common/search.js"
import { VSBuffer } from "../deps/vscode/vs/base/common/buffer.js"
import { SerializedError, transformErrorFromSerialization } from "../deps/vscode/vs/base/common/errors.js"
import { IRemoteConsoleLog } from "../deps/vscode/vs/base/common/console.js"
import { FileType, FilePermission, FileSystemProviderErrorCode } from "../deps/vscode/vs/platform/files/common/files.js"
import * as fs from "fs"
import { promisify } from "util"
import { exec } from "child_process"
import { ConfigurationModel } from "../deps/vscode/vs/platform/configuration/common/configurationModels.js"
import { NullLogService } from "../deps/vscode/vs/platform/log/common/log.js"
import { ExtensionIdentifier } from "../deps/vscode/vs/platform/extensions/common/extensions.js"
import { ExtensionActivationReason } from "../deps/vscode/vs/workbench/services/extensions/common/extensions.js"
import { IExtensionDescription } from "../deps/vscode/vs/platform/extensions/common/extensions.js"
import { Dto } from "../deps/vscode/vs/workbench/services/extensions/common/proxyIdentifier.js"
import { ExtensionManager } from "./extensionManager.js"
import { WebViewManager } from "./webViewManager.js"

// Promisify Node.js fs functions
const fsStat = promisify(fs.stat)
const fsReadDir = promisify(fs.readdir)
const fsReadFile = promisify(fs.readFile)
const fsWriteFile = promisify(fs.writeFile)
const fsRename = promisify(fs.rename)
const fsCopyFile = promisify(fs.copyFile)
const fsUnlink = promisify(fs.unlink)
const fsLstat = promisify(fs.lstat)
const fsMkdir = promisify(fs.mkdir)

class RPCLogger implements IRPCProtocolLogger {
	logIncoming(msgLength: number, req: number, initiator: RequestInitiator, msg: string, data?: any): void {
		if (msg == "ack") {
			return
		}
		console.log(`[RPC] ExtHost: ${msg}`)
	}

	logOutgoing(msgLength: number, req: number, initiator: RequestInitiator, msg: string, data?: any): void {
		if (msg == "ack" || msg == "reply:") {
			return
		}
		console.log(`[RPC] Main: ${msg}`)
	}
}

export class RPCManager {
	private rpcProtocol: IRPCProtocol
	private logger: RPCLogger
	private extensionManager: ExtensionManager

	constructor(
		private protocol: PersistentProtocol,
		extensionManager: ExtensionManager,
	) {
		this.logger = new RPCLogger()
		this.rpcProtocol = new RPCProtocol(this.protocol, this.logger)
		this.extensionManager = extensionManager
		this.setupDefaultProtocols()
		this.setupExtensionRequiredProtocols()
		this.setupRooCodeRequiredProtocols()
	}

	public startInitialize(): void {
		// ExtHostConfiguration
		const extHostConfiguration = this.rpcProtocol.getProxy(ExtHostContext.ExtHostConfiguration)

		// Send initialization configuration message
		extHostConfiguration.$initializeConfiguration({
			defaults: ConfigurationModel.createEmptyModel(new NullLogService()),
			policy: ConfigurationModel.createEmptyModel(new NullLogService()),
			application: ConfigurationModel.createEmptyModel(new NullLogService()),
			userLocal: ConfigurationModel.createEmptyModel(new NullLogService()),
			userRemote: ConfigurationModel.createEmptyModel(new NullLogService()),
			workspace: ConfigurationModel.createEmptyModel(new NullLogService()),
			folders: [],
			configurationScopes: [],
		})

		const extHostWorkspace = this.rpcProtocol.getProxy(ExtHostContext.ExtHostWorkspace)

		// Initialize workspace
		extHostWorkspace.$initializeWorkspace(null, true)
	}

	// Protocols needed for extHost process startup and initialization
	public setupDefaultProtocols(): void {
		if (!this.rpcProtocol) {
			throw new Error("RPCProtocol not initialized")
		}

		// MainThreadErrors
		this.rpcProtocol.set(MainContext.MainThreadErrors, {
			dispose(): void {
				// Nothing to do
			},
			$onUnexpectedError(err: any | SerializedError): void {
				if (err && err.$isError) {
					err = transformErrorFromSerialization(err)
				}
				console.error("Unexpected error:", err)
				/*
                if (err instanceof Error && err.stack) {
                    console.error('Stack trace:', err.stack);
                }
                    */
			},
		})

		// MainThreadConsole
		this.rpcProtocol.set(MainContext.MainThreadConsole, {
			dispose(): void {
				// Nothing to do
			},
			$logExtensionHostMessage(entry: IRemoteConsoleLog): void {
				// Parse the entry
				const args = this.parseRemoteConsoleLog(entry)

				// Log based on severity
				switch (entry.severity) {
					case "log":
					case "info":
						console.log("[Extension Host]", ...args)
						break
					case "warn":
						console.warn("[Extension Host]", ...args)
						break
					case "error":
						console.error("[Extension Host]", ...args)
						break
					case "debug":
						console.debug("[Extension Host]", ...args)
						break
					default:
						console.log("[Extension Host]", ...args)
				}
			},
			parseRemoteConsoleLog(entry: IRemoteConsoleLog): any[] {
				const args: any[] = []

				try {
					// Parse the arguments string as JSON
					const parsedArguments = JSON.parse(entry.arguments)
					args.push(...parsedArguments)
				} catch (error) {
					// If parsing fails, just log the raw arguments string
					args.push("Unable to log remote console arguments", entry.arguments)
				}

				return args
			},
		})

		// MainThreadLogger
		this.rpcProtocol.set(MainContext.MainThreadLogger, {
			$log(file: UriComponents, messages: [LogLevel, string][]): void {
				console.log("Logger message:", { file, messages })
			},
			$flush(file: UriComponents): void {
				console.log("Flush logger:", file)
			},
			$createLogger(file: UriComponents, options?: any): Promise<void> {
				console.log("Create logger:", { file, options })
				return Promise.resolve()
			},
			$registerLogger(logger: UriDto<ILoggerResource>): Promise<void> {
				console.log("Register logger (id: ", logger.id, ", name: ", logger.name, ")")
				return Promise.resolve()
			},
			$deregisterLogger(resource: UriComponents): Promise<void> {
				console.log("Deregister logger:", resource)
				return Promise.resolve()
			},
			$setVisibility(resource: UriComponents, visible: boolean): Promise<void> {
				console.log("Set logger visibility:", { resource, visible })
				return Promise.resolve()
			},
		})

		// MainThreadCommands
		this.rpcProtocol.set(MainContext.MainThreadCommands, {
			$registerCommand(id: string): void {
				console.log("Register command:", id)
			},
			$unregisterCommand(id: string): void {
				console.log("Unregister command:", id)
			},
			$executeCommand<T>(id: string, ...args: any[]): Promise<T> {
				console.log("Execute command:", id, args)
				return Promise.resolve(null as T)
			},
			$fireCommandActivationEvent(id: string): void {
				console.log("Fire command activation event:", id)
			},
			$getCommands(): Promise<string[]> {
				return Promise.resolve([])
			},
			dispose(): void {
				console.log("Dispose MainThreadCommands")
			},
		})

		// MainThreadTerminalService
		this.rpcProtocol.set(MainContext.MainThreadTerminalService, {
			$registerProcessSupport(isSupported: boolean): void {
				console.log("Register process support:", isSupported)
			},
			$createTerminal(extHostTerminalId: string, config: TerminalLaunchConfig): Promise<void> {
				console.log("Create terminal:", { extHostTerminalId, config })
				return Promise.resolve()
			},
			$dispose(id: string): void {
				console.log("Dispose terminal:", id)
			},
			$hide(id: string): void {
				console.log("Hide terminal:", id)
			},
			$sendText(id: string, text: string, shouldExecute: boolean): void {
				console.log("Send text to terminal:", { id, text, shouldExecute })
			},
			$show(id: string, preserveFocus: boolean): void {
				console.log("Show terminal:", { id, preserveFocus })
			},
			$registerProfileProvider(id: string, extensionIdentifier: string): void {
				console.log("Register profile provider:", { id, extensionIdentifier })
			},
			$unregisterProfileProvider(id: string): void {
				console.log("Unregister profile provider:", id)
			},
			$registerCompletionProvider(id: string, extensionIdentifier: string, ...triggerCharacters: string[]): void {
				console.log("Register completion provider:", { id, extensionIdentifier, triggerCharacters })
			},
			$unregisterCompletionProvider(id: string): void {
				console.log("Unregister completion provider:", id)
			},
			$registerQuickFixProvider(id: string, extensionIdentifier: string): void {
				console.log("Register quick fix provider:", { id, extensionIdentifier })
			},
			$unregisterQuickFixProvider(id: string): void {
				console.log("Unregister quick fix provider:", id)
			},
			$setEnvironmentVariableCollection(
				extensionIdentifier: string,
				persistent: boolean,
				collection: any,
				descriptionMap: any,
			): void {
				console.log("Set environment variable collection:", {
					extensionIdentifier,
					persistent,
					collection,
					descriptionMap,
				})
			},
			$startSendingDataEvents(): void {
				console.log("Start sending data events")
			},
			$stopSendingDataEvents(): void {
				console.log("Stop sending data events")
			},
			$startSendingCommandEvents(): void {
				console.log("Start sending command events")
			},
			$stopSendingCommandEvents(): void {
				console.log("Stop sending command events")
			},
			$startLinkProvider(): void {
				console.log("Start link provider")
			},
			$stopLinkProvider(): void {
				console.log("Stop link provider")
			},
			$sendProcessData(terminalId: number, data: string): void {
				console.log("Send process data:", { terminalId, data })
			},
			$sendProcessReady(terminalId: number, pid: number, cwd: string, windowsPty: any): void {
				console.log("Send process ready:", { terminalId, pid, cwd, windowsPty })
			},
			$sendProcessProperty(terminalId: number, property: any): void {
				console.log("Send process property:", { terminalId, property })
			},
			$sendProcessExit(terminalId: number, exitCode: number | undefined): void {
				console.log("Send process exit:", { terminalId, exitCode })
			},
			dispose(): void {
				console.log("Dispose MainThreadTerminalService")
			},
		})

		// MainThreadWindow
		this.rpcProtocol.set(MainContext.MainThreadWindow, {
			$getInitialState(): Promise<{ isFocused: boolean; isActive: boolean }> {
				console.log("Get initial state")
				return Promise.resolve({ isFocused: false, isActive: false })
			},
			async $openUri(uri: UriComponents, uriString: string | undefined, options: any): Promise<boolean> {
				console.log("Open URI:", { uri, uriString, options })

				try {
					// Use the uriString if provided, otherwise construct from uri components
					const urlToOpen = uriString || this.constructUriString(uri)

					if (!urlToOpen) {
						console.error("No valid URL to open")
						return false
					}

					console.log("Opening URL in browser:", urlToOpen)

					// Open URL in default browser based on platform
					const execAsync = promisify(exec)
					let command: string

					switch (process.platform) {
						case "darwin": // macOS
							command = `open "${urlToOpen}"`
							break
						case "win32": // Windows
							command = `start "" "${urlToOpen}"`
							break
						default: // Linux and others
							command = `xdg-open "${urlToOpen}"`
							break
					}

					await execAsync(command)
					console.log("Successfully opened URL in browser")
					return true
				} catch (error) {
					console.error("Failed to open URI:", error)
					return false
				}
			},
			constructUriString(uri: UriComponents): string | null {
				if (!uri) return null

				const scheme = uri.scheme || "https"
				const authority = uri.authority || ""
				const path = uri.path || ""
				const query = uri.query ? `?${uri.query}` : ""
				const fragment = uri.fragment ? `#${uri.fragment}` : ""

				// Construct the full URI
				if (authority) {
					return `${scheme}://${authority}${path}${query}${fragment}`
				} else if (path) {
					return `${scheme}:${path}${query}${fragment}`
				}

				return null
			},
			$asExternalUri(uri: UriComponents, options: any): Promise<UriComponents> {
				console.log("As external URI:", { uri, options })
				return Promise.resolve(uri)
			},
			dispose(): void {
				console.log("Dispose MainThreadWindow")
			},
		})

		// MainThreadSearch
		this.rpcProtocol.set(MainContext.MainThreadSearch, {
			$registerFileSearchProvider(handle: number, scheme: string): void {
				console.log("Register file search provider:", { handle, scheme })
			},
			$registerAITextSearchProvider(handle: number, scheme: string): void {
				console.log("Register AI text search provider:", { handle, scheme })
			},
			$registerTextSearchProvider(handle: number, scheme: string): void {
				console.log("Register text search provider:", { handle, scheme })
			},
			$unregisterProvider(handle: number): void {
				console.log("Unregister provider:", handle)
			},
			$handleFileMatch(handle: number, session: number, data: UriComponents[]): void {
				console.log("Handle file match:", { handle, session, data })
			},
			$handleTextMatch(handle: number, session: number, data: IRawFileMatch2[]): void {
				console.log("Handle text match:", { handle, session, data })
			},
			$handleTelemetry(eventName: string, data: any): void {
				console.log("Handle telemetry:", { eventName, data })
			},
			dispose(): void {
				console.log("Dispose MainThreadSearch")
			},
		})

		// MainThreadTask
		this.rpcProtocol.set(MainContext.MainThreadTask, {
			$createTaskId(task: any): Promise<string> {
				console.log("Create task ID:", task)
				return Promise.resolve("task-id")
			},
			$registerTaskProvider(handle: number, type: string): Promise<void> {
				console.log("Register task provider:", { handle, type })
				return Promise.resolve()
			},
			$unregisterTaskProvider(handle: number): Promise<void> {
				console.log("Unregister task provider:", handle)
				return Promise.resolve()
			},
			$fetchTasks(filter?: any): Promise<any[]> {
				console.log("Fetch tasks:", filter)
				return Promise.resolve([])
			},
			$getTaskExecution(value: any): Promise<any> {
				console.log("Get task execution:", value)
				return Promise.resolve(null)
			},
			$executeTask(task: any): Promise<any> {
				console.log("Execute task:", task)
				return Promise.resolve(null)
			},
			$terminateTask(id: string): Promise<void> {
				console.log("Terminate task:", id)
				return Promise.resolve()
			},
			$registerTaskSystem(scheme: string, info: any): void {
				console.log("Register task system:", { scheme, info })
			},
			$customExecutionComplete(id: string, result?: number): Promise<void> {
				console.log("Custom execution complete:", { id, result })
				return Promise.resolve()
			},
			$registerSupportedExecutions(custom?: boolean, shell?: boolean, process?: boolean): Promise<void> {
				console.log("Register supported executions:", { custom, shell, process })
				return Promise.resolve()
			},
			dispose(): void {
				console.log("Dispose MainThreadTask")
			},
		})

		// MainThreadConfiguration
		this.rpcProtocol.set(MainContext.MainThreadConfiguration, {
			$updateConfigurationOption(
				target: any,
				key: string,
				value: any,
				overrides: any,
				scopeToLanguage: boolean | undefined,
			): Promise<void> {
				console.log("Update configuration option:", { target, key, value, overrides, scopeToLanguage })
				return Promise.resolve()
			},
			$removeConfigurationOption(
				target: any,
				key: string,
				overrides: any,
				scopeToLanguage: boolean | undefined,
			): Promise<void> {
				console.log("Remove configuration option:", { target, key, overrides, scopeToLanguage })
				return Promise.resolve()
			},
			dispose(): void {
				console.log("Dispose MainThreadConfiguration")
			},
		})

		// MainThreadFileSystem
		this.rpcProtocol.set(MainContext.MainThreadFileSystem, {
			async $registerFileSystemProvider(
				handle: number,
				scheme: string,
				capabilities: any,
				readonlyMessage?: any,
			): Promise<void> {
				console.log("Register file system provider:", { handle, scheme, capabilities, readonlyMessage })
			},
			$unregisterProvider(handle: number): void {
				console.log("Unregister provider:", handle)
			},
			$onFileSystemChange(handle: number, resource: any[]): void {
				console.log("File system change:", { handle, resource })
			},
			async $stat(resource: UriComponents): Promise<any> {
				console.log("Stat:", resource)
				try {
					const filePath = this.uriToPath(resource)
					const stats = await fsStat(filePath)

					return {
						type: this.getFileType(stats),
						ctime: stats.birthtimeMs,
						mtime: stats.mtimeMs,
						size: stats.size,
						permissions: stats.mode & 0o444 ? FilePermission.Readonly : undefined,
					}
				} catch (error) {
					console.error("Error in $stat:", error)
					throw this.handleFileSystemError(error)
				}
			},
			async $readdir(resource: UriComponents): Promise<[string, FileType][]> {
				console.log("Read directory:", resource)
				try {
					const filePath = this.uriToPath(resource)
					const entries = await fsReadDir(filePath, { withFileTypes: true })

					return entries.map((entry) => {
						let type = FileType.Unknown
						if (entry.isFile()) {
							type = FileType.File
						} else if (entry.isDirectory()) {
							type = FileType.Directory
						}

						// Check if it's a symbolic link
						if (entry.isSymbolicLink()) {
							type |= FileType.SymbolicLink
						}

						return [entry.name, type] as [string, FileType]
					})
				} catch (error) {
					console.error("Error in $readdir:", error)
					throw this.handleFileSystemError(error)
				}
			},
			async $readFile(resource: UriComponents): Promise<any> {
				console.log("Read file:", resource)
				try {
					const filePath = this.uriToPath(resource)
					const buffer = await fsReadFile(filePath)
					return VSBuffer.wrap(buffer)
				} catch (error) {
					console.error("Error in $readFile:", error)
					throw this.handleFileSystemError(error)
				}
			},
			async $writeFile(resource: UriComponents, content: any): Promise<void> {
				console.log("Write file:", { resource, content })
				try {
					const filePath = this.uriToPath(resource)
					const buffer = content instanceof VSBuffer ? content.buffer : content
					await fsWriteFile(filePath, buffer)
				} catch (error) {
					console.error("Error in $writeFile:", error)
					throw this.handleFileSystemError(error)
				}
			},
			async $rename(resource: UriComponents, target: UriComponents, opts: any): Promise<void> {
				console.log("Rename:", { resource, target, opts })
				try {
					const sourcePath = this.uriToPath(resource)
					const targetPath = this.uriToPath(target)

					// Check if target exists and handle overwrite option
					if (opts.overwrite) {
						try {
							await fsUnlink(targetPath)
						} catch (error) {
							// Ignore error if file doesn't exist
						}
					}

					await fsRename(sourcePath, targetPath)
				} catch (error) {
					console.error("Error in $rename:", error)
					throw this.handleFileSystemError(error)
				}
			},
			async $copy(resource: UriComponents, target: UriComponents, opts: any): Promise<void> {
				console.log("Copy:", { resource, target, opts })
				try {
					const sourcePath = this.uriToPath(resource)
					const targetPath = this.uriToPath(target)

					// Check if target exists and handle overwrite option
					if (opts.overwrite) {
						try {
							await fsUnlink(targetPath)
						} catch (error) {
							// Ignore error if file doesn't exist
						}
					}

					await fsCopyFile(sourcePath, targetPath)
				} catch (error) {
					console.error("Error in $copy:", error)
					throw this.handleFileSystemError(error)
				}
			},
			async $mkdir(resource: UriComponents): Promise<void> {
				console.log("Make directory:", resource)
				try {
					const dirPath = this.uriToPath(resource)
					await fsMkdir(dirPath, { recursive: true })
				} catch (error) {
					console.error("Error in $mkdir:", error)
					throw this.handleFileSystemError(error)
				}
			},
			async $delete(resource: UriComponents, opts: any): Promise<void> {
				console.log("Delete:", { resource, opts })
				try {
					const filePath = this.uriToPath(resource)

					// Check if it's a directory
					const stats = await fsLstat(filePath)
					if (stats.isDirectory()) {
						// For directories, we need to implement recursive deletion
						// This is a simplified version
						await fs.promises.rm(filePath, { recursive: true })
					} else {
						await fsUnlink(filePath)
					}
				} catch (error) {
					console.error("Error in $delete:", error)
					throw this.handleFileSystemError(error)
				}
			},
			async $ensureActivation(scheme: string): Promise<void> {
				console.log("Ensure activation:", scheme)
				// No-op implementation
				return Promise.resolve()
			},
			dispose(): void {
				console.log("Dispose MainThreadFileSystem")
			},

			// Helper methods
			uriToPath(uri: UriComponents): string {
				// Convert URI to file path
				// This is a simplified implementation
				if (uri.scheme !== "file") {
					throw new Error(`Unsupported URI scheme: ${uri.scheme}`)
				}

				// Handle Windows paths
				let filePath = uri.path || ""
				if (process.platform === "win32" && filePath.startsWith("/")) {
					filePath = filePath.substring(1)
				}

				return filePath
			},

			getFileType(stats: fs.Stats): FileType {
				let type = FileType.Unknown

				if (stats.isFile()) {
					type = FileType.File
				} else if (stats.isDirectory()) {
					type = FileType.Directory
				}

				// Check if it's a symbolic link
				if (stats.isSymbolicLink()) {
					type |= FileType.SymbolicLink
				}

				return type
			},

			handleFileSystemError(error: any): Error {
				// Map Node.js errors to VSCode file system errors
				if (error.code === "ENOENT") {
					const err = new Error(error.message)
					err.name = FileSystemProviderErrorCode.FileNotFound
					return err
				} else if (error.code === "EACCES" || error.code === "EPERM") {
					const err = new Error(error.message)
					err.name = FileSystemProviderErrorCode.NoPermissions
					return err
				} else if (error.code === "EEXIST") {
					const err = new Error(error.message)
					err.name = FileSystemProviderErrorCode.FileExists
					return err
				} else if (error.code === "EISDIR") {
					const err = new Error(error.message)
					err.name = FileSystemProviderErrorCode.FileIsADirectory
					return err
				} else if (error.code === "ENOTDIR") {
					const err = new Error(error.message)
					err.name = FileSystemProviderErrorCode.FileNotADirectory
					return err
				}

				// Default error
				return error
			},
		})

		// MainThreadLanguageModelTools
		this.rpcProtocol.set(MainContext.MainThreadLanguageModelTools, {
			$getTools(): Promise<any[]> {
				console.log("Getting language model tools")
				return Promise.resolve([])
			},
			$invokeTool(dto: any, token: any): Promise<any> {
				console.log("Invoking language model tool:", dto)
				return Promise.resolve({})
			},
			$countTokensForInvocation(callId: string, input: string, token: any): Promise<number> {
				console.log("Counting tokens for invocation:", { callId, input })
				return Promise.resolve(0)
			},
			$registerTool(id: string): void {
				console.log("Registering language model tool:", id)
			},
			$unregisterTool(name: string): void {
				console.log("Unregistering language model tool:", name)
			},
			dispose(): void {
				console.log("Disposing MainThreadLanguageModelTools")
			},
		})
	}

	// Protocols needed for general extension loading process
	public setupExtensionRequiredProtocols(): void {
		if (!this.rpcProtocol) {
			return
		}

		this.rpcProtocol.set(MainContext.MainThreadExtensionService, {
			$getExtension: async (extensionId: string): Promise<Dto<IExtensionDescription> | undefined> => {
				console.log(`Getting extension: ${extensionId}`)
				return this.extensionManager.getExtensionDescription(extensionId)
			},
			$activateExtension: async (
				extensionId: ExtensionIdentifier,
				reason: ExtensionActivationReason,
			): Promise<void> => {
				console.log(`Activating extension ${extensionId.value} with reason:`, reason)
				await this.extensionManager.activateExtension(extensionId.value, this.rpcProtocol)
			},
			$onWillActivateExtension: async (extensionId: ExtensionIdentifier): Promise<void> => {
				console.log(`Extension ${extensionId.value} will be activated`)
			},
			$onDidActivateExtension: (
				extensionId: ExtensionIdentifier,
				codeLoadingTime: number,
				activateCallTime: number,
				activateResolvedTime: number,
				activationReason: ExtensionActivationReason,
			): void => {
				console.log(`Extension ${extensionId.value} was activated with reason:`, activationReason)
			},
			$onExtensionActivationError: async (
				extensionId: ExtensionIdentifier,
				error: any,
				missingExtensionDependency: any | null,
			): Promise<void> => {
				console.error(`Extension ${extensionId.value} activation error:`, error)
			},
			$onExtensionRuntimeError: (extensionId: ExtensionIdentifier, error: any): void => {
				console.error(`Extension ${extensionId.value} runtime error:`, error)
			},
			$setPerformanceMarks: async (marks: { name: string; startTime: number }[]): Promise<void> => {
				console.log("Setting performance marks:", marks)
			},
			$asBrowserUri: async (uri: any): Promise<any> => {
				console.log("Converting to browser URI:", uri)
				return uri
			},
			dispose: () => {
				console.log("Disposing MainThreadExtensionService")
			},
		})

		this.rpcProtocol.set(MainContext.MainThreadTelemetry, {
			$publicLog(eventName: string, data?: any): void {
				console.log(`[Telemetry] ${eventName}`, data)
			},
			$publicLog2<E extends any = never, T extends any = never>(eventName: string, data?: any): void {
				console.log(`[Telemetry] ${eventName}`, data)
			},
			dispose(): void {
				console.log("Disposing MainThreadTelemetry")
			},
		})

		this.rpcProtocol.set(MainContext.MainThreadDebugService, {
			$registerDebugTypes(debugTypes: string[]): void {
				console.log("Register debug types:", debugTypes)
			},
			$sessionCached(sessionID: string): void {
				console.log("Session cached:", sessionID)
			},
			$acceptDAMessage(handle: number, message: any): void {
				console.log("Accept debug adapter message:", { handle, message })
			},
			$acceptDAError(handle: number, name: string, message: string, stack: string | undefined): void {
				console.error("Debug adapter error:", { handle, name, message, stack })
			},
			$acceptDAExit(handle: number, code: number | undefined, signal: string | undefined): void {
				console.log("Debug adapter exit:", { handle, code, signal })
			},
			async $registerDebugConfigurationProvider(
				type: string,
				triggerKind: any,
				hasProvideMethod: boolean,
				hasResolveMethod: boolean,
				hasResolve2Method: boolean,
				handle: number,
			): Promise<void> {
				console.log("Register debug configuration provider:", {
					type,
					triggerKind,
					hasProvideMethod,
					hasResolveMethod,
					hasResolve2Method,
					handle,
				})
			},
			async $registerDebugAdapterDescriptorFactory(type: string, handle: number): Promise<void> {
				console.log("Register debug adapter descriptor factory:", { type, handle })
			},
			$unregisterDebugConfigurationProvider(handle: number): void {
				console.log("Unregister debug configuration provider:", handle)
			},
			$unregisterDebugAdapterDescriptorFactory(handle: number): void {
				console.log("Unregister debug adapter descriptor factory:", handle)
			},
			async $startDebugging(folder: any, nameOrConfig: string | any, options: any): Promise<boolean> {
				console.log("Start debugging:", { folder, nameOrConfig, options })
				return true
			},
			async $stopDebugging(sessionId: string | undefined): Promise<void> {
				console.log("Stop debugging:", sessionId)
			},
			$setDebugSessionName(id: string, name: string): void {
				console.log("Set debug session name:", { id, name })
			},
			async $customDebugAdapterRequest(id: string, command: string, args: any): Promise<any> {
				console.log("Custom debug adapter request:", { id, command, args })
				return null
			},
			async $getDebugProtocolBreakpoint(id: string, breakpoinId: string): Promise<any> {
				console.log("Get debug protocol breakpoint:", { id, breakpoinId })
				return undefined
			},
			$appendDebugConsole(value: string): void {
				console.log("Debug console:", value)
			},
			async $registerBreakpoints(breakpoints: any[]): Promise<void> {
				console.log("Register breakpoints:", breakpoints)
			},
			async $unregisterBreakpoints(
				breakpointIds: string[],
				functionBreakpointIds: string[],
				dataBreakpointIds: string[],
			): Promise<void> {
				console.log("Unregister breakpoints:", { breakpointIds, functionBreakpointIds, dataBreakpointIds })
			},
			$registerDebugVisualizer(extensionId: string, id: string): void {
				console.log("Register debug visualizer:", { extensionId, id })
			},
			$unregisterDebugVisualizer(extensionId: string, id: string): void {
				console.log("Unregister debug visualizer:", { extensionId, id })
			},
			$registerDebugVisualizerTree(treeId: string, canEdit: boolean): void {
				console.log("Register debug visualizer tree:", { treeId, canEdit })
			},
			$unregisterDebugVisualizerTree(treeId: string): void {
				console.log("Unregister debug visualizer tree:", treeId)
			},
			$registerCallHierarchyProvider(handle: number, supportsResolve: boolean): void {
				console.log("Register call hierarchy provider:", { handle, supportsResolve })
			},
			dispose(): void {
				console.log("Disposing MainThreadDebugService")
			},
		})
	}

	public setupRooCodeRequiredProtocols(): void {
		if (!this.rpcProtocol) {
			return
		}

		// MainThreadTextEditors
		this.rpcProtocol.set(MainContext.MainThreadTextEditors, {
			$tryShowTextDocument(resource: UriComponents, options: any): Promise<string | undefined> {
				console.log("Try show text document:", { resource, options })
				return Promise.resolve(undefined)
			},
			$tryShowEditor(id: string, position?: any): Promise<void> {
				console.log("Try show editor:", { id, position })
				return Promise.resolve()
			},
			$tryHideEditor(id: string): Promise<void> {
				console.log("Try hide editor:", id)
				return Promise.resolve()
			},
			$trySetSelections(id: string, selections: any[]): Promise<void> {
				console.log("Try set selections:", { id, selections })
				return Promise.resolve()
			},
			$tryRevealRange(id: string, range: any, revealType: any): Promise<void> {
				console.log("Try reveal range:", { id, range, revealType })
				return Promise.resolve()
			},
			$trySetOptions(id: string, options: any): Promise<void> {
				console.log("Try set options:", { id, options })
				return Promise.resolve()
			},
			$tryApplyEdits(id: string, modelVersionId: number, edits: any[], opts: any): Promise<boolean> {
				console.log("Try apply edits:", { id, modelVersionId, edits, opts })
				return Promise.resolve(true)
			},
			$registerTextEditorDecorationType(extensionId: ExtensionIdentifier, key: string, options: any): void {
				console.log("Register text editor decoration type:", { extensionId, key, options })
			},
			$removeTextEditorDecorationType(key: string): void {
				console.log("Remove text editor decoration type:", key)
			},
			$trySetDecorations(id: string, key: string, ranges: any[]): Promise<void> {
				console.log("Try set decorations:", { id, key, ranges })
				return Promise.resolve()
			},
			$trySetDecorationsFast(id: string, key: string, ranges: any[]): Promise<void> {
				console.log("Try set decorations fast:", { id, key, ranges })
				return Promise.resolve()
			},
			$tryInsertSnippet(id: string, snippet: any, location: any, options: any): Promise<boolean> {
				console.log("Try insert snippet:", { id, snippet, location, options })
				return Promise.resolve(true)
			},
			$getDiffInformation(id: string): Promise<any> {
				console.log("Get diff information:", id)
				return Promise.resolve(null)
			},
			dispose(): void {
				console.log("Dispose MainThreadTextEditors")
			},
		})

		// MainThreadStorage
		this.rpcProtocol.set(MainContext.MainThreadStorage, {
			$initializeExtensionStorage(shared: boolean, extensionId: string): Promise<string | undefined> {
				console.log("Initialize extension storage:", { shared, extensionId })
				return Promise.resolve(undefined)
			},
			$setValue(shared: boolean, extensionId: string, value: object): Promise<void> {
				console.log("Set value:", { shared, extensionId, value })
				return Promise.resolve()
			},
			$registerExtensionStorageKeysToSync(extension: any, keys: string[]): void {
				console.log("Register extension storage keys to sync:", { extension, keys })
			},
			dispose(): void {
				console.log("Dispose MainThreadStorage")
			},
		})

		// MainThreadOutputService
		this.rpcProtocol.set(MainContext.MainThreadOutputService, {
			$register(
				label: string,
				file: UriComponents,
				languageId: string | undefined,
				extensionId: string,
			): Promise<string> {
				console.log("Register output channel:", { label, file, languageId, extensionId })
				return Promise.resolve(`output-${extensionId}-${label}`)
			},
			$update(channelId: string, mode: any, till?: number): Promise<void> {
				console.log("Update output channel:", { channelId, mode, till })
				return Promise.resolve()
			},
			$reveal(channelId: string, preserveFocus: boolean): Promise<void> {
				console.log("Reveal output channel:", { channelId, preserveFocus })
				return Promise.resolve()
			},
			$close(channelId: string): Promise<void> {
				console.log("Close output channel:", channelId)
				return Promise.resolve()
			},
			$dispose(channelId: string): Promise<void> {
				console.log("Dispose output channel:", channelId)
				return Promise.resolve()
			},
			dispose(): void {
				console.log("Dispose MainThreadOutputService")
			},
		})

		// Create a single WebViewManager instance
		const webViewManager = new WebViewManager(this.rpcProtocol)

		// MainThreadWebviewViews
		this.rpcProtocol.set(MainContext.MainThreadWebviewViews, webViewManager)

		// MainThreadDocumentContentProviders
		this.rpcProtocol.set(MainContext.MainThreadDocumentContentProviders, {
			$registerTextContentProvider(handle: number, scheme: string): void {
				console.log("Register text content provider:", { handle, scheme })
			},
			$unregisterTextContentProvider(handle: number): void {
				console.log("Unregister text content provider:", handle)
			},
			$onVirtualDocumentChange(uri: UriComponents, value: string): Promise<void> {
				console.log("Virtual document change:", { uri, value })
				return Promise.resolve()
			},
			dispose(): void {
				console.log("Dispose MainThreadDocumentContentProviders")
			},
		})

		// MainThreadUrls
		this.rpcProtocol.set(MainContext.MainThreadUrls, {
			$registerUriHandler(
				handle: number,
				extensionId: ExtensionIdentifier,
				extensionDisplayName: string,
			): Promise<void> {
				console.log("Register URI handler:", { handle, extensionId, extensionDisplayName })
				return Promise.resolve()
			},
			$unregisterUriHandler(handle: number): Promise<void> {
				console.log("Unregister URI handler:", handle)
				return Promise.resolve()
			},
			$createAppUri(uri: UriComponents): Promise<UriComponents> {
				console.log("Create app URI:", uri)
				return Promise.resolve(uri)
			},
			dispose(): void {
				console.log("Dispose MainThreadUrls")
			},
		})

		// MainThreadWebviews
		this.rpcProtocol.set(MainContext.MainThreadWebviews, webViewManager)
	}

	public getRPCProtocol(): IRPCProtocol | null {
		return this.rpcProtocol
	}
}
