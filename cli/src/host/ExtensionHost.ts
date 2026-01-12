import { EventEmitter } from "events"
import { createVSCodeAPIMock, type IdentityInfo, type ExtensionContext } from "./VSCode.js"
import { logs } from "../services/logs.js"
import type { ExtensionMessage, WebviewMessage, ExtensionState, ModeConfig } from "../types/messages.js"
import { getTelemetryService } from "../services/telemetry/index.js"
import { argsToMessage } from "../utils/safe-stringify.js"

export interface ExtensionHostOptions {
	workspacePath: string
	extensionBundlePath: string // Direct path to extension.js
	extensionRootPath: string // Root path for extension assets
	identity?: IdentityInfo // Identity information for VSCode environment
	customModes?: ModeConfig[] // Custom modes configuration
	appendSystemPrompt?: string // Custom text to append to system prompt
}

// Extension module interface
interface ExtensionModule {
	activate: (context: unknown) => Promise<KiloCodeAPI> | KiloCodeAPI
	deactivate?: () => Promise<void> | void
}

// KiloCode API interface returned by extension activation
interface KiloCodeAPI {
	startNewTask?: (task: string, images?: string[]) => Promise<void>
	sendMessage?: (message: ExtensionMessage) => void
	cancelTask?: () => Promise<void>
	condense?: () => Promise<void>
	condenseTaskContext?: () => Promise<void>
	handleTerminalOperation?: (operation: string) => Promise<void>
	getState?: () => ExtensionState | Promise<ExtensionState>
}

// VSCode API mock interface - matches the return type from createVSCodeAPIMock
interface VSCodeAPIMock {
	context: ExtensionContext
	[key: string]: unknown
}

// Webview provider interface
interface WebviewProvider {
	handleCLIMessage?: (message: WebviewMessage) => Promise<void>
	[key: string]: unknown
}

export interface ExtensionAPI {
	getState: () => ExtensionState | null
	sendMessage: (message: ExtensionMessage) => void
	updateState: (updates: Partial<ExtensionState>) => void
}

export class ExtensionHost extends EventEmitter {
	private options: ExtensionHostOptions
	private isActivated = false
	private currentState: ExtensionState | null = null
	private extensionModule: ExtensionModule | null = null
	private extensionAPI: KiloCodeAPI | null = null
	private vscodeAPI: VSCodeAPIMock | null = null
	private webviewProviders: Map<string, WebviewProvider> = new Map()
	private webviewInitialized = false
	private pendingMessages: WebviewMessage[] = []
	private isInitialSetup = true
	private originalConsole: {
		log: typeof console.log
		error: typeof console.error
		warn: typeof console.warn
		debug: typeof console.debug
		info: typeof console.info
	} | null = null
	private lastWebviewLaunchTime = 0
	private extensionHealth = {
		isHealthy: true,
		errorCount: 0,
		lastError: null as Error | null,
		lastErrorTime: 0,
		maxErrorsBeforeWarning: 10,
	}
	private unhandledRejectionHandler: ((reason: unknown, promise: Promise<unknown>) => void) | null = null
	private uncaughtExceptionHandler: ((error: Error) => void) | null = null

	constructor(options: ExtensionHostOptions) {
		super()
		this.options = options
		// Increase max listeners to avoid warnings in tests
		process.setMaxListeners(20)
		this.setupGlobalErrorHandlers()
	}

	/**
	 * Setup global error handlers to catch unhandled errors from extension
	 */
	private setupGlobalErrorHandlers(): void {
		// Handle unhandled promise rejections from extension
		this.unhandledRejectionHandler = (reason: unknown) => {
			const error = reason instanceof Error ? reason : new Error(String(reason))

			// Check if this is an expected error
			if (this.isExpectedError(error)) {
				logs.debug(`Caught expected unhandled rejection: ${error.message}`, "ExtensionHost")
				return
			}

			logs.error("Unhandled promise rejection from extension", "ExtensionHost", { error, reason })

			// Emit non-fatal error event
			this.emit("extension-error", {
				context: "unhandledRejection",
				error,
				recoverable: true,
				timestamp: Date.now(),
			})

			// Update health metrics
			this.extensionHealth.errorCount++
			this.extensionHealth.lastError = error
			this.extensionHealth.lastErrorTime = Date.now()
		}
		process.on("unhandledRejection", this.unhandledRejectionHandler)

		// Handle uncaught exceptions from extension
		this.uncaughtExceptionHandler = (error: Error) => {
			// Check if this is an expected error
			if (this.isExpectedError(error)) {
				logs.debug(`Caught expected uncaught exception: ${error.message}`, "ExtensionHost")
				return
			}

			logs.error("Uncaught exception from extension", "ExtensionHost", { error })

			// Emit non-fatal error event
			this.emit("extension-error", {
				context: "uncaughtException",
				error,
				recoverable: true,
				timestamp: Date.now(),
			})

			// Update health metrics
			this.extensionHealth.errorCount++
			this.extensionHealth.lastError = error
			this.extensionHealth.lastErrorTime = Date.now()
		}
		process.on("uncaughtException", this.uncaughtExceptionHandler)
	}

	/**
	 * Remove global error handlers
	 */
	private removeGlobalErrorHandlers(): void {
		if (this.unhandledRejectionHandler) {
			process.off("unhandledRejection", this.unhandledRejectionHandler)
			this.unhandledRejectionHandler = null
		}
		if (this.uncaughtExceptionHandler) {
			process.off("uncaughtException", this.uncaughtExceptionHandler)
			this.uncaughtExceptionHandler = null
		}
	}

	/**
	 * Safely execute an operation, catching and logging any errors without crashing the CLI
	 */
	private async safeExecute<T>(
		operation: () => T | Promise<T>,
		context: string,
		fallback?: T,
	): Promise<T | undefined> {
		try {
			const result = await operation()
			return result
		} catch (error) {
			this.extensionHealth.errorCount++
			this.extensionHealth.lastError = error as Error
			this.extensionHealth.lastErrorTime = Date.now()

			// Check if this is an expected error (like task abortion)
			const isExpectedError = this.isExpectedError(error)

			if (!isExpectedError) {
				logs.error(`Extension error in ${context}`, "ExtensionHost", {
					error,
					errorCount: this.extensionHealth.errorCount,
				})

				// Emit non-fatal error event
				this.emit("extension-error", {
					context,
					error,
					recoverable: true,
					timestamp: Date.now(),
				})
			} else {
				logs.debug(`Expected error in ${context}: ${error}`, "ExtensionHost")
			}

			return fallback
		}
	}

	/**
	 * Check if an error is expected (e.g., task abortion)
	 */
	private isExpectedError(error: unknown): boolean {
		if (!error) return false
		const errorMessage = error instanceof Error ? error.message : String(error)

		// Task abortion errors are expected
		if (errorMessage.includes("task") && errorMessage.includes("aborted")) {
			return true
		}

		// Add other expected error patterns here
		return false
	}

	async activate(): Promise<ExtensionAPI> {
		if (this.isActivated) {
			return this.getAPI()
		}

		try {
			logs.info("Activating extension...", "ExtensionHost")

			// Set up console interception FIRST to capture all extension logs
			// This must happen before loading the extension module
			this.setupConsoleInterception()

			// Setup VSCode API mock
			await this.setupVSCodeAPIMock()

			// Load the extension (console already intercepted)
			await this.loadExtension()

			// Activate the extension
			await this.activateExtension()

			this.isActivated = true
			logs.info("Extension activated successfully", "ExtensionHost")

			// Emit activation event
			this.emit("activated", this.getAPI())

			return this.getAPI()
		} catch (error) {
			logs.error("Failed to activate extension", "ExtensionHost", { error })
			this.emit("extension-error", {
				context: "activation",
				error,
				recoverable: false,
				timestamp: Date.now(),
			})
			// Don't throw - return API with limited functionality
			return this.getAPI()
		}
	}

	async deactivate(): Promise<void> {
		if (!this.isActivated) {
			return
		}

		try {
			logs.info("Deactivating extension...", "ExtensionHost")

			// Call extension's deactivate function if it exists
			if (this.extensionModule && typeof this.extensionModule.deactivate === "function") {
				await this.extensionModule.deactivate()
			}

			// Clean up VSCode API mock
			if (this.vscodeAPI && this.vscodeAPI.context) {
				// Dispose all subscriptions
				for (const subscription of this.vscodeAPI.context.subscriptions) {
					if (subscription && typeof subscription.dispose === "function") {
						subscription.dispose()
					}
				}
			}

			// Restore original console methods
			this.restoreConsole()

			// Remove global error handlers
			this.removeGlobalErrorHandlers()

			this.isActivated = false
			this.currentState = null
			this.extensionModule = null
			this.extensionAPI = null
			this.vscodeAPI = null
			this.webviewProviders.clear()
			this.lastWebviewLaunchTime = 0
			this.removeAllListeners()

			logs.info("Extension deactivated", "ExtensionHost")
		} catch (error) {
			logs.error("Error during deactivation", "ExtensionHost", { error })
			throw error
		}
	}

	async sendWebviewMessage(message: WebviewMessage): Promise<void> {
		try {
			logs.debug(`Processing webview message: ${message.type}`, "ExtensionHost")

			if (!this.isActivated) {
				logs.warn("Extension not activated, ignoring message", "ExtensionHost")
				return
			}

			// Queue messages if webview not initialized
			if (!this.webviewInitialized) {
				this.pendingMessages.push(message)
				logs.debug(`Queued message ${message.type} - webview not ready`, "ExtensionHost")
				return
			}

			// Track extension message sent
			getTelemetryService().trackExtensionMessageSent(message.type)

			// Handle webviewDidLaunch for CLI state synchronization
			if (message.type === "webviewDidLaunch") {
				// Prevent rapid-fire webviewDidLaunch messages
				const now = Date.now()
				if (now - this.lastWebviewLaunchTime < 1000) {
					logs.debug("Ignoring webviewDidLaunch - too soon after last one", "ExtensionHost")
					return
				}
				this.lastWebviewLaunchTime = now
				await this.handleWebviewLaunch()
			}

			// Forward message directly to the webview provider instead of emitting event
			// This prevents duplicate handling (event listener + direct call)
			const webviewProvider = this.webviewProviders.get("kilo-code.SidebarProvider")

			if (webviewProvider && typeof webviewProvider.handleCLIMessage === "function") {
				await webviewProvider.handleCLIMessage(message)
			} else {
				logs.warn(
					`No webview provider found or handleCLIMessage not available for: ${message.type}`,
					"ExtensionHost",
				)
			}

			// Handle local state updates for CLI display after forwarding
			await this.handleLocalStateUpdates(message)
		} catch (error) {
			logs.error("Error handling webview message", "ExtensionHost", { error })
			// Don't emit "error" event - emit non-fatal event instead
			this.emit("extension-error", {
				context: `webview-message-${message.type}`,
				error,
				recoverable: true,
				timestamp: Date.now(),
			})
			// Don't re-throw - allow CLI to continue
		}
	}

	private async setupVSCodeAPIMock(): Promise<void> {
		// Create VSCode API mock with extension root path for assets and identity
		this.vscodeAPI = createVSCodeAPIMock(
			this.options.extensionRootPath,
			this.options.workspacePath,
			this.options.identity,
		) as VSCodeAPIMock

		// Set global vscode object for the extension
		if (this.vscodeAPI) {
			;(global as unknown as { vscode: VSCodeAPIMock }).vscode = this.vscodeAPI
		}

		// Set global reference to this ExtensionHost for webview provider registration
		;(global as unknown as { __extensionHost: ExtensionHost }).__extensionHost = this

		// Set environment variables to disable problematic features in CLI mode
		process.env.KILO_CLI_MODE = "true"
		process.env.NODE_ENV = process.env.NODE_ENV || "production"

		logs.debug("VSCode API mock setup complete", "ExtensionHost")
	}

	private setupConsoleInterception(): void {
		// Store original console methods
		this.originalConsole = {
			log: console.log,
			error: console.error,
			warn: console.warn,
			debug: console.debug,
			info: console.info,
		}

		// Set up global.__interceptedConsole FIRST, before any module loading
		// This ensures it's available when the module compilation hook runs
		// and all extension modules can use the intercepted console
		;(global as unknown as { __interceptedConsole: Console }).__interceptedConsole = {
			log: (...args: unknown[]) => {
				const message = argsToMessage(args)
				logs.info(message, "Extension")
			},
			error: (...args: unknown[]) => {
				const message = argsToMessage(args)
				logs.error(message, "Extension")
			},
			warn: (...args: unknown[]) => {
				const message = argsToMessage(args)
				logs.warn(message, "Extension")
			},
			debug: (...args: unknown[]) => {
				const message = argsToMessage(args)
				logs.debug(message, "Extension")
			},
			info: (...args: unknown[]) => {
				const message = argsToMessage(args)
				logs.info(message, "Extension")
			},
		} as Console

		// Override console methods to forward to LogsService ONLY (no console output)
		// IMPORTANT: Use safe serialization to avoid circular reference errors
		console.log = (...args: unknown[]) => {
			const message = argsToMessage(args)
			logs.info(message, "Extension")
		}

		console.error = (...args: unknown[]) => {
			const message = argsToMessage(args)
			logs.error(message, "Extension")
		}

		console.warn = (...args: unknown[]) => {
			const message = argsToMessage(args)
			logs.warn(message, "Extension")
		}

		console.debug = (...args: unknown[]) => {
			const message = argsToMessage(args)
			logs.debug(message, "Extension")
		}

		console.info = (...args: unknown[]) => {
			const message = argsToMessage(args)
			logs.info(message, "Extension")
		}
	}

	private restoreConsole(): void {
		if (this.originalConsole) {
			console.log = this.originalConsole.log
			console.error = this.originalConsole.error
			console.warn = this.originalConsole.warn
			console.debug = this.originalConsole.debug
			console.info = this.originalConsole.info
			this.originalConsole = null
		}

		// Clean up global console interception
		if ((global as unknown as { __interceptedConsole?: unknown }).__interceptedConsole) {
			delete (global as unknown as { __interceptedConsole?: unknown }).__interceptedConsole
		}

		logs.debug("Console methods and streams restored", "ExtensionHost")
	}

	private async loadExtension(): Promise<void> {
		// Use the direct path to extension.js
		const extensionPath = this.options.extensionBundlePath

		try {
			logs.info(`Loading extension from: ${extensionPath}`, "ExtensionHost")

			// Use createRequire to load CommonJS module from ES module context
			const { createRequire } = await import("module")
			const require = createRequire(import.meta.url)

			// Get Module class for interception
			const Module = await import("module")
			interface ModuleClass {
				_resolveFilename: (request: string, parent: unknown, isMain: boolean, options?: unknown) => string
				prototype: {
					_compile: (content: string, filename: string) => unknown
				}
			}
			const ModuleClass = Module.default as unknown as ModuleClass

			// Store original methods
			const originalResolveFilename = ModuleClass._resolveFilename
			const originalCompile = ModuleClass.prototype._compile

			// Set up module resolution interception for vscode
			ModuleClass._resolveFilename = function (
				request: string,
				parent: unknown,
				isMain: boolean,
				options?: unknown,
			) {
				if (request === "vscode") {
					return "vscode-mock"
				}
				// Let all other modules (including events) resolve normally since we have dependencies
				return originalResolveFilename.call(this, request, parent, isMain, options)
			}

			// Set up module compilation hook to inject console interception
			// This ensures ALL modules (including dependencies) use our intercepted console
			ModuleClass.prototype._compile = function (content: string, filename: string) {
				// Inject console override at the top of every module
				// This makes the intercepted console available to all code in the module
				const modifiedContent = `
					// Console interception injected by ExtensionHost
					const console = global.__interceptedConsole || console;
					${content}
				`
				return originalCompile.call(this, modifiedContent, filename)
			}

			// Set up the vscode module in require cache
			require.cache["vscode-mock"] = {
				id: "vscode-mock",
				filename: "vscode-mock",
				loaded: true,
				parent: null,
				children: [],
				exports: this.vscodeAPI,
				paths: [],
			} as unknown as NodeModule

			// Clear extension require cache to ensure fresh load
			if (require.cache[extensionPath]) {
				delete require.cache[extensionPath]
			}

			// Load the extension module (with console interception active)
			this.extensionModule = require(extensionPath)

			// Restore original methods
			ModuleClass._resolveFilename = originalResolveFilename
			ModuleClass.prototype._compile = originalCompile

			if (!this.extensionModule) {
				throw new Error("Extension module is null or undefined")
			}

			if (typeof this.extensionModule.activate !== "function") {
				throw new Error("Extension module does not export an activate function")
			}

			logs.info("Extension module loaded successfully", "ExtensionHost")
		} catch (error) {
			logs.error("Failed to load extension module", "ExtensionHost", { error })
			throw new Error(`Failed to load extension: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	private async activateExtension(): Promise<void> {
		try {
			// Call the extension's activate function with our mocked context
			// Use safeExecute to catch and handle any errors without crashing the CLI
			this.extensionAPI =
				(await this.safeExecute(
					async () => {
						if (!this.extensionModule || !this.vscodeAPI) {
							throw new Error("Extension module or VSCode API not initialized")
						}
						logs.info("Calling extension activate function...", "ExtensionHost")
						return await this.extensionModule.activate(this.vscodeAPI.context)
					},
					"extension.activate",
					null,
				)) ?? null

			if (!this.extensionAPI) {
				logs.warn(
					"Extension activation returned null/undefined, continuing with limited functionality",
					"ExtensionHost",
				)
			}

			// Log available API methods for debugging
			if (this.extensionAPI) {
				logs.info("Extension API methods available:", "ExtensionHost", {
					hasStartNewTask: typeof this.extensionAPI.startNewTask === "function",
					hasSendMessage: typeof this.extensionAPI.sendMessage === "function",
					hasCancelTask: typeof this.extensionAPI.cancelTask === "function",
					hasCondense: typeof this.extensionAPI.condense === "function",
					hasCondenseTaskContext: typeof this.extensionAPI.condenseTaskContext === "function",
					hasHandleTerminalOperation: typeof this.extensionAPI.handleTerminalOperation === "function",
				})
			} else {
				logs.warn("Extension API is null or undefined", "ExtensionHost")
			}

			logs.info("Extension activate function completed", "ExtensionHost")

			// Initialize state from extension
			this.initializeState()

			// Set up message listener to receive updates from the extension
			this.setupExtensionMessageListener()
		} catch (error) {
			logs.error("Extension activation failed", "ExtensionHost", { error })
			throw error
		}
	}

	private setupExtensionMessageListener(): void {
		// Listen for extension state updates and forward them
		if (this.vscodeAPI && this.vscodeAPI.context) {
			// The extension will update state through the webview provider
			// We need to listen for those updates and forward them to the CLI
			logs.debug("Setting up extension message listener", "ExtensionHost")

			// Track message IDs to prevent infinite loops
			const processedMessageIds = new Set<string>()

			// Listen for messages from the extension's webview (postMessage calls)
			this.on(
				"extensionWebviewMessage",
				(
					message: ExtensionMessage & {
						payload?: unknown
						state?: Partial<ExtensionState>
						clineMessage?: unknown
						chatMessage?: unknown
						listApiConfigMeta?: unknown
					},
				) => {
					this.safeExecute(() => {
						// Create a unique ID for this message to prevent loops
						const messageId = `${message.type}_${Date.now()}_${JSON.stringify(message).slice(0, 50)}`

						if (processedMessageIds.has(messageId)) {
							logs.debug(`Skipping duplicate message: ${message.type}`, "ExtensionHost")
							return
						}

						processedMessageIds.add(messageId)

						// Clean up old message IDs to prevent memory leaks
						if (processedMessageIds.size > 100) {
							const oldestIds = Array.from(processedMessageIds).slice(0, 50)
							oldestIds.forEach((id) => processedMessageIds.delete(id))
						}

						// Track extension message received
						getTelemetryService().trackExtensionMessageReceived(message.type)

						// Only forward specific message types that are important for CLI
						switch (message.type) {
							case "state":
								// Extension is sending a full state update
								if (message.state && this.currentState) {
									// Build the new state object, handling optional properties correctly
									const newState: ExtensionState = {
										...this.currentState,
										...message.state,
										chatMessages:
											message.state.clineMessages ||
											message.state.chatMessages ||
											this.currentState.chatMessages,
										apiConfiguration:
											message.state.apiConfiguration || this.currentState.apiConfiguration,
									}

									// Handle optional properties explicitly to satisfy exactOptionalPropertyTypes
									if (message.state.currentApiConfigName !== undefined) {
										newState.currentApiConfigName = message.state.currentApiConfigName
									} else if (this.currentState.currentApiConfigName !== undefined) {
										newState.currentApiConfigName = this.currentState.currentApiConfigName
									}

									if (message.state.listApiConfigMeta !== undefined) {
										newState.listApiConfigMeta = message.state.listApiConfigMeta
									} else if (this.currentState.listApiConfigMeta !== undefined) {
										newState.listApiConfigMeta = this.currentState.listApiConfigMeta
									}

									if (message.state.routerModels !== undefined) {
										newState.routerModels = message.state.routerModels
									} else if (this.currentState.routerModels !== undefined) {
										newState.routerModels = this.currentState.routerModels
									}

									this.currentState = newState

									// Forward the updated state to the CLI
									this.emit("message", {
										type: "state",
										state: this.currentState,
									})
								}
								break

							case "messageUpdated": {
								// Extension is sending an individual message update
								// The extension uses 'clineMessage' property (legacy name)

								const chatMessage = message.clineMessage || message.chatMessage
								if (chatMessage) {
									// Forward the message update to the CLI
									const emitMessage = {
										type: "messageUpdated",
										chatMessage: chatMessage,
									}
									this.emit("message", emitMessage)
								}
								break
							}

							case "taskHistoryResponse":
								// Extension is sending task history data
								if (message.payload) {
									// Forward the task history response to the CLI
									this.emit("message", {
										type: "taskHistoryResponse",
										payload: message.payload,
									})
								}
								break

							// Handle configuration-related messages from extension
							case "listApiConfig":
								// Extension is sending updated API configuration list
								if (
									message.listApiConfigMeta &&
									this.currentState &&
									Array.isArray(message.listApiConfigMeta)
								) {
									this.currentState.listApiConfigMeta = message.listApiConfigMeta
									logs.debug("Updated listApiConfigMeta from extension", "ExtensionHost")
								}
								break

							// Don't forward these message types as they can cause loops
							case "mcpServers":
							case "theme":
							case "rulesData":
								logs.debug(
									`Ignoring extension message type to prevent loops: ${message.type}`,
									"ExtensionHost",
								)
								break

							default:
								// Only forward other important messages
								if (message.type && !message.type.startsWith("_")) {
									logs.debug(`Forwarding extension message: ${message.type}`, "ExtensionHost")
									this.emit("message", message)
								}
								break
						}
					}, `extensionWebviewMessage-${message.type}`)
				},
			)
		}
	}

	private initializeState(): void {
		// Create initial state that matches the extension's expected structure
		this.currentState = {
			version: "1.0.0",
			apiConfiguration: {
				apiProvider: "kilocode",
				kilocodeToken: "",
				kilocodeModel: "",
				kilocodeOrganizationId: "",
			},
			chatMessages: [],
			mode: "code",
			customModes: this.options.customModes || [],
			taskHistoryFullLength: 0,
			taskHistoryVersion: 0,
			renderContext: "cli",
			telemetrySetting: "unset", // Start with unset, will be configured by CLI
			cwd: this.options.workspacePath,
			mcpServers: [],
			listApiConfigMeta: [],
			currentApiConfigName: "default",
			// Enable background editing (preventFocusDisruption) for CLI mode
			// This prevents the extension from trying to show VSCode diff views
			experiments: {
				preventFocusDisruption: true,
				morphFastApply: false,
				multiFileApplyDiff: false,
				powerSteering: false,
				imageGeneration: false,
				runSlashCommand: false,
			},
			// Add appendSystemPrompt from CLI options
			...(this.options.appendSystemPrompt && { appendSystemPrompt: this.options.appendSystemPrompt }),
		}

		// The CLI will inject the actual configuration through updateState
		logs.debug("Initial state created, waiting for CLI config injection", "ExtensionHost")
		this.broadcastStateUpdate()
	}

	private async handleWebviewLaunch(): Promise<void> {
		// Sync with extension state when webview launches
		if (this.extensionAPI && typeof this.extensionAPI.getState === "function") {
			try {
				const extensionState = await this.safeExecute(
					() => {
						if (!this.extensionAPI?.getState) {
							return null
						}
						const result = this.extensionAPI.getState()
						return result instanceof Promise ? result : Promise.resolve(result)
					},
					"getState",
					null,
				)
				if (extensionState && this.currentState) {
					// Merge extension state with current state, preserving CLI context
					const mergedState: ExtensionState = {
						...this.currentState,
						apiConfiguration: extensionState.apiConfiguration || this.currentState.apiConfiguration,
						mode: extensionState.mode || this.currentState.mode,
						chatMessages: extensionState.chatMessages || this.currentState.chatMessages,
					}

					// Handle optional properties explicitly to satisfy exactOptionalPropertyTypes
					if (extensionState.currentApiConfigName !== undefined) {
						mergedState.currentApiConfigName = extensionState.currentApiConfigName
					}
					if (extensionState.listApiConfigMeta !== undefined) {
						mergedState.listApiConfigMeta = extensionState.listApiConfigMeta
					}
					if (extensionState.routerModels !== undefined) {
						mergedState.routerModels = extensionState.routerModels
					}

					this.currentState = mergedState
					logs.debug("Synced state with extension on webview launch", "ExtensionHost")
				}
			} catch (error) {
				logs.warn("Failed to sync with extension state on webview launch", "ExtensionHost", { error })
			}
		}

		// Send initial state when webview launches
		this.broadcastStateUpdate()
	}

	/**
	 * Handle local state updates for CLI display purposes after forwarding to extension
	 */
	private async handleLocalStateUpdates(message: WebviewMessage): Promise<void> {
		try {
			switch (message.type) {
				case "upsertApiConfiguration":
					if (message.text && message.apiConfiguration && this.currentState) {
						// Update local state for CLI display purposes
						this.currentState.apiConfiguration = {
							...this.currentState.apiConfiguration,
							...message.apiConfiguration,
						}
						this.currentState.currentApiConfigName = message.text
						this.broadcastStateUpdate()
					}
					break

				case "loadApiConfiguration":
					// Configuration loading is handled by CLI config system
					logs.debug(`Profile loading requested but managed by CLI config: ${message.text}`, "ExtensionHost")
					break

				case "mode":
					if (message.text && this.currentState) {
						this.currentState.mode = message.text
						this.broadcastStateUpdate()
					}
					break

				case "clearTask":
					if (this.currentState) {
						this.currentState.chatMessages = []
						this.broadcastStateUpdate()
					}
					break

				case "selectImages":
					// For CLI, we don't support image selection - send empty response
					this.emit("message", {
						type: "selectedImages",
						images: [],
						context: message.context || "chat",
						messageTs: message.messageTs,
					})
					break

				default:
					// No local state updates needed for other message types
					break
			}
		} catch (error) {
			logs.error("Error handling local state updates", "ExtensionHost", { error })
		}
	}

	private broadcastStateUpdate(): void {
		if (this.currentState) {
			const stateMessage: ExtensionMessage = {
				type: "state",
				state: this.currentState,
			}
			logs.debug("Broadcasting state update", "ExtensionHost", {
				messageCount: this.currentState.chatMessages.length,
				mode: this.currentState.mode,
			})
			this.emit("message", stateMessage)
		}
	}

	public getAPI(): ExtensionAPI {
		return {
			getState: () => this.currentState,
			sendMessage: (message: ExtensionMessage) => {
				logs.debug(`Sending message: ${message.type}`, "ExtensionHost")
				this.emit("message", message)
			},
			updateState: (updates: Partial<ExtensionState>) => {
				if (this.currentState) {
					this.currentState = { ...this.currentState, ...updates }
					this.broadcastStateUpdate()
				}
			},
		}
	}

	/**
	 * Send configuration sync messages to the extension
	 * This is the shared logic used by both injectConfiguration and external sync calls
	 */
	public async syncConfigurationMessages(configState: Partial<ExtensionState>): Promise<void> {
		// Send API configuration if present
		if (configState.apiConfiguration) {
			await this.sendWebviewMessage({
				type: "upsertApiConfiguration",
				text: configState.currentApiConfigName || "default",
				apiConfiguration: configState.apiConfiguration,
			})
		}

		// Sync mode if present
		if (configState.mode) {
			await this.sendWebviewMessage({
				type: "mode",
				text: configState.mode,
			})
		}

		// Sync telemetry setting if present
		if (configState.telemetrySetting) {
			await this.sendWebviewMessage({
				type: "telemetrySetting",
				text: configState.telemetrySetting,
			})
			logs.debug(`Telemetry setting synchronized: ${configState.telemetrySetting}`, "ExtensionHost")
		}

		// Sync experiments if present (critical for CLI background editing)
		if (configState.experiments || this.currentState?.experiments) {
			const experiments = (configState.experiments || this.currentState?.experiments) ?? {}
			await this.sendWebviewMessage({
				type: "updateSettings",
				updatedSettings: { experiments },
			})
		}

		// Sync auto-approval settings to the extension
		// These settings control whether the extension auto-approves operations
		// or defers to the CLI's approval flow (which prompts the user)
		const autoApprovalSettings: Record<string, unknown> = {}

		// Only include settings that are explicitly set in configState
		if (configState.autoApprovalEnabled !== undefined) {
			autoApprovalSettings.autoApprovalEnabled = configState.autoApprovalEnabled
		}
		if (configState.alwaysAllowReadOnly !== undefined) {
			autoApprovalSettings.alwaysAllowReadOnly = configState.alwaysAllowReadOnly
		}
		if (configState.alwaysAllowReadOnlyOutsideWorkspace !== undefined) {
			autoApprovalSettings.alwaysAllowReadOnlyOutsideWorkspace = configState.alwaysAllowReadOnlyOutsideWorkspace
		}
		if (configState.alwaysAllowWrite !== undefined) {
			autoApprovalSettings.alwaysAllowWrite = configState.alwaysAllowWrite
		}
		if (configState.alwaysAllowWriteOutsideWorkspace !== undefined) {
			autoApprovalSettings.alwaysAllowWriteOutsideWorkspace = configState.alwaysAllowWriteOutsideWorkspace
		}
		if (configState.alwaysAllowWriteProtected !== undefined) {
			autoApprovalSettings.alwaysAllowWriteProtected = configState.alwaysAllowWriteProtected
		}
		if (configState.alwaysAllowBrowser !== undefined) {
			autoApprovalSettings.alwaysAllowBrowser = configState.alwaysAllowBrowser
		}
		if (configState.alwaysApproveResubmit !== undefined) {
			autoApprovalSettings.alwaysApproveResubmit = configState.alwaysApproveResubmit
		}
		if (configState.requestDelaySeconds !== undefined) {
			autoApprovalSettings.requestDelaySeconds = configState.requestDelaySeconds
		}
		if (configState.alwaysAllowMcp !== undefined) {
			autoApprovalSettings.alwaysAllowMcp = configState.alwaysAllowMcp
		}
		if (configState.alwaysAllowModeSwitch !== undefined) {
			autoApprovalSettings.alwaysAllowModeSwitch = configState.alwaysAllowModeSwitch
		}
		if (configState.alwaysAllowSubtasks !== undefined) {
			autoApprovalSettings.alwaysAllowSubtasks = configState.alwaysAllowSubtasks
		}
		if (configState.alwaysAllowExecute !== undefined) {
			autoApprovalSettings.alwaysAllowExecute = configState.alwaysAllowExecute
		}
		if (configState.allowedCommands !== undefined) {
			autoApprovalSettings.allowedCommands = configState.allowedCommands
		}
		if (configState.deniedCommands !== undefined) {
			autoApprovalSettings.deniedCommands = configState.deniedCommands
		}
		if (configState.alwaysAllowFollowupQuestions !== undefined) {
			autoApprovalSettings.alwaysAllowFollowupQuestions = configState.alwaysAllowFollowupQuestions
		}
		if (configState.followupAutoApproveTimeoutMs !== undefined) {
			autoApprovalSettings.followupAutoApproveTimeoutMs = configState.followupAutoApproveTimeoutMs
		}
		if (configState.alwaysAllowUpdateTodoList !== undefined) {
			autoApprovalSettings.alwaysAllowUpdateTodoList = configState.alwaysAllowUpdateTodoList
		}

		// Send auto-approval settings if any are present
		if (Object.keys(autoApprovalSettings).length > 0) {
			await this.sendWebviewMessage({
				type: "updateSettings",
				updatedSettings: autoApprovalSettings,
			})
			logs.debug("Auto-approval settings synchronized to extension", "ExtensionHost", {
				settings: Object.keys(autoApprovalSettings),
			})
		}

		// Sync appendSystemPrompt to extension
		// This setting is passed from CLI options and needs to be stored in the extension's
		// contextProxy so it's available when generating the system prompt
		const appendSystemPrompt = configState.appendSystemPrompt || this.options.appendSystemPrompt
		if (appendSystemPrompt) {
			await this.sendWebviewMessage({
				type: "updateSettings",
				updatedSettings: { appendSystemPrompt },
			})
			logs.debug("appendSystemPrompt synchronized to extension", "ExtensionHost", {
				length: appendSystemPrompt.length,
			})
		}
	}

	/**
	 * Inject CLI configuration into the extension state
	 * This should be called after the CLI config is loaded
	 */
	public async injectConfiguration(configState: Partial<ExtensionState>): Promise<void> {
		if (!this.currentState) {
			logs.warn("Cannot inject configuration: no current state", "ExtensionHost")
			return
		}

		// Preserve experiments from current state when merging
		// This ensures CLI-specific settings like preventFocusDisruption are not overwritten
		const preservedExperiments = this.currentState.experiments

		// Merge the configuration into current state
		this.currentState = {
			...this.currentState,
			...configState,
			// Restore experiments if they were set in initial state
			experiments: preservedExperiments || configState.experiments,
		}

		// Send configuration to the extension through webview message
		// This ensures the extension's internal state is updated
		await this.syncConfigurationMessages(configState)

		// Broadcast the updated state
		this.broadcastStateUpdate()
	}

	// Methods for webview provider registration (called from VSCode API mock)
	registerWebviewProvider(viewId: string, provider: WebviewProvider): void {
		this.webviewProviders.set(viewId, provider)
		logs.info(`Webview provider registered: ${viewId}`, "ExtensionHost")
	}

	unregisterWebviewProvider(viewId: string): void {
		this.webviewProviders.delete(viewId)
		logs.debug(`Unregistered webview provider: ${viewId}`, "ExtensionHost")
	}

	/**
	 * Mark webview as ready and flush pending messages
	 * Called by VSCode mock after resolveWebviewView completes
	 */
	public markWebviewReady(): void {
		this.webviewInitialized = true
		this.isInitialSetup = false
		logs.info("Webview marked as ready, flushing pending messages", "ExtensionHost")
		void this.flushPendingMessages()
	}

	/**
	 * Flush all pending messages that were queued before webview was ready
	 */
	private async flushPendingMessages(): Promise<void> {
		const upsertMessages = this.pendingMessages.filter((m) => m.type === "upsertApiConfiguration")
		const otherMessages = this.pendingMessages.filter((m) => m.type !== "upsertApiConfiguration")
		this.pendingMessages = []

		logs.info(`Flushing ${upsertMessages.length + otherMessages.length} pending messages`, "ExtensionHost")

		// Ensure the API configuration is applied before anything tries to read it
		for (const message of upsertMessages) {
			logs.debug(`Flushing pending message: ${message.type}`, "ExtensionHost")
			// Serialize upserts so provider settings are persisted before readers run
			await this.sendWebviewMessage(message)
		}

		for (const message of otherMessages) {
			logs.debug(`Flushing pending message: ${message.type}`, "ExtensionHost")
			void this.sendWebviewMessage(message)
		}
	}

	/**
	 * Check if webview is ready to receive messages
	 */
	public isWebviewReady(): boolean {
		return this.webviewInitialized
	}

	/**
	 * Check if this is the initial setup phase
	 */
	public isInInitialSetup(): boolean {
		return this.isInitialSetup
	}
}

export function createExtensionHost(options: ExtensionHostOptions): ExtensionHost {
	return new ExtensionHost(options)
}
