/**
 * ExtensionHost - Loads and runs the Roo Code extension in CLI mode
 *
 * This class is a thin coordination layer responsible for:
 * 1. Creating the vscode-shim mock
 * 2. Loading the extension bundle via require()
 * 3. Activating the extension
 * 4. Wiring up managers for output, prompting, and ask handling
 */

import { createRequire } from "module"
import path from "path"
import { fileURLToPath } from "url"
import fs from "fs"
import { EventEmitter } from "events"

import pWaitFor from "p-wait-for"

import type {
	ClineMessage,
	ExtensionMessage,
	ReasoningEffortExtended,
	RooCodeSettings,
	WebviewMessage,
} from "@roo-code/types"
import { createVSCodeAPI, IExtensionHost, ExtensionHostEventMap, setRuntimeConfigValues } from "@roo-code/vscode-shim"
import { DebugLogger } from "@roo-code/core/cli"

import type { SupportedProvider } from "@/types/index.js"
import type { User } from "@/lib/sdk/index.js"
import { getProviderSettings } from "@/lib/utils/provider.js"
import { createEphemeralStorageDir } from "@/lib/storage/index.js"

import type { WaitingForInputEvent, TaskCompletedEvent } from "./events.js"
import type { AgentStateInfo } from "./agent-state.js"
import { ExtensionClient } from "./extension-client.js"
import { OutputManager } from "./output-manager.js"
import { PromptManager } from "./prompt-manager.js"
import { AskDispatcher } from "./ask-dispatcher.js"

// Pre-configured logger for CLI message activity debugging.
const cliLogger = new DebugLogger("CLI")

// Get the CLI package root directory (for finding node_modules/@vscode/ripgrep)
// When running from a release tarball, ROO_CLI_ROOT is set by the wrapper script.
// In development, we fall back to calculating from __dirname.
// After bundling with tsup, the code is in dist/index.js (flat), so we go up one level.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CLI_PACKAGE_ROOT = process.env.ROO_CLI_ROOT || path.resolve(__dirname, "..")

export interface ExtensionHostOptions {
	mode: string
	reasoningEffort?: ReasoningEffortExtended | "unspecified" | "disabled"
	user: User | null
	provider: SupportedProvider
	apiKey?: string
	model: string
	workspacePath: string
	extensionPath: string
	nonInteractive?: boolean
	debug?: boolean
	/**
	 * When true, completely disables all direct stdout/stderr output.
	 * Use this when running in TUI mode where Ink controls the terminal.
	 */
	disableOutput?: boolean
	/**
	 * When true, uses a temporary storage directory that is cleaned up on exit.
	 */
	ephemeral?: boolean
	/**
	 * When true, don't suppress node warnings and console output since we're
	 * running in an integration test and we want to see the output.
	 */
	integrationTest?: boolean
}

interface ExtensionModule {
	activate: (context: unknown) => Promise<unknown>
	deactivate?: () => Promise<void>
}

interface WebviewViewProvider {
	resolveWebviewView?(webviewView: unknown, context: unknown, token: unknown): void | Promise<void>
}

export interface ExtensionHostInterface extends IExtensionHost<ExtensionHostEventMap> {
	client: ExtensionClient
	activate(): Promise<void>
	runTask(prompt: string): Promise<void>
	sendToExtension(message: WebviewMessage): void
	dispose(): Promise<void>
}

export class ExtensionHost extends EventEmitter implements ExtensionHostInterface {
	// Extension lifecycle.
	private vscode: ReturnType<typeof createVSCodeAPI> | null = null
	private extensionModule: ExtensionModule | null = null
	private extensionAPI: unknown = null
	private options: ExtensionHostOptions
	private isReady = false
	private messageListener: ((message: ExtensionMessage) => void) | null = null
	private initialSettings: RooCodeSettings

	// Console suppression.
	private originalConsole: {
		log: typeof console.log
		warn: typeof console.warn
		error: typeof console.error
		debug: typeof console.debug
		info: typeof console.info
	} | null = null

	private originalProcessEmitWarning: typeof process.emitWarning | null = null

	// Ephemeral storage.
	private ephemeralStorageDir: string | null = null

	// ==========================================================================
	// Managers - These do all the heavy lifting
	// ==========================================================================

	/**
	 * ExtensionClient: Single source of truth for agent loop state.
	 * Handles message processing and state detection.
	 */
	public readonly client: ExtensionClient

	/**
	 * OutputManager: Handles all CLI output and streaming.
	 * Uses Observable pattern internally for stream tracking.
	 */
	private outputManager: OutputManager

	/**
	 * PromptManager: Handles all user input collection.
	 * Provides readline, yes/no, and timed prompts.
	 */
	private promptManager: PromptManager

	/**
	 * AskDispatcher: Routes asks to appropriate handlers.
	 * Uses type guards (isIdleAsk, isInteractiveAsk, etc.) from client module.
	 */
	private askDispatcher: AskDispatcher

	// ==========================================================================
	// Constructor
	// ==========================================================================

	constructor(options: ExtensionHostOptions) {
		super()

		this.options = options
		this.options.integrationTest = true

		// Initialize client - single source of truth for agent state (including mode).
		this.client = new ExtensionClient({
			sendMessage: (msg) => this.sendToExtension(msg),
			debug: options.debug, // Enable debug logging in the client.
		})

		// Initialize output manager.
		this.outputManager = new OutputManager({
			disabled: options.disableOutput,
		})

		// Initialize prompt manager with console mode callbacks.
		this.promptManager = new PromptManager({
			onBeforePrompt: () => this.restoreConsole(),
			onAfterPrompt: () => this.setupQuietMode(),
		})

		// Initialize ask dispatcher.
		this.askDispatcher = new AskDispatcher({
			outputManager: this.outputManager,
			promptManager: this.promptManager,
			sendMessage: (msg) => this.sendToExtension(msg),
			nonInteractive: options.nonInteractive,
			disabled: options.disableOutput, // TUI mode handles asks directly.
		})

		// Wire up client events.
		this.setupClientEventHandlers()

		// Populate initial settings.
		const baseSettings: RooCodeSettings = {
			mode: this.options.mode,
			commandExecutionTimeout: 30,
			browserToolEnabled: false,
			enableCheckpoints: false,
			...getProviderSettings(this.options.provider, this.options.apiKey, this.options.model),
		}

		this.initialSettings = this.options.nonInteractive
			? {
					autoApprovalEnabled: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
					alwaysAllowWrite: true,
					alwaysAllowWriteOutsideWorkspace: true,
					alwaysAllowWriteProtected: true,
					alwaysAllowBrowser: true,
					alwaysAllowMcp: true,
					alwaysAllowModeSwitch: true,
					alwaysAllowSubtasks: true,
					alwaysAllowExecute: true,
					allowedCommands: ["*"],
					...baseSettings,
				}
			: {
					autoApprovalEnabled: false,
					...baseSettings,
				}

		if (this.options.reasoningEffort && this.options.reasoningEffort !== "unspecified") {
			if (this.options.reasoningEffort === "disabled") {
				this.initialSettings.enableReasoningEffort = false
			} else {
				this.initialSettings.enableReasoningEffort = true
				this.initialSettings.reasoningEffort = this.options.reasoningEffort
			}
		}

		this.setupQuietMode()
	}

	// ==========================================================================
	// Client Event Handlers
	// ==========================================================================

	/**
	 * Wire up client events to managers.
	 * The client emits events, managers handle them.
	 */
	private setupClientEventHandlers(): void {
		// Handle new messages - delegate to OutputManager.
		this.client.on("message", (msg: ClineMessage) => {
			this.logMessageDebug(msg, "new")
			this.outputManager.outputMessage(msg)
		})

		// Handle message updates - delegate to OutputManager.
		this.client.on("messageUpdated", (msg: ClineMessage) => {
			this.logMessageDebug(msg, "updated")
			this.outputManager.outputMessage(msg)
		})

		// Handle waiting for input - delegate to AskDispatcher.
		this.client.on("waitingForInput", (event: WaitingForInputEvent) => {
			this.askDispatcher.handleAsk(event.message)
		})

		// Handle task completion.
		this.client.on("taskCompleted", (event: TaskCompletedEvent) => {
			// Output completion message via OutputManager.
			// Note: completion_result is an "ask" type, not a "say" type.
			if (event.message && event.message.type === "ask" && event.message.ask === "completion_result") {
				this.outputManager.outputCompletionResult(event.message.ts, event.message.text || "")
			}
		})
	}

	// ==========================================================================
	// Logging + Console Suppression
	// ==========================================================================

	private setupQuietMode(): void {
		if (this.options.integrationTest) {
			return
		}

		// Suppress node warnings.
		this.originalProcessEmitWarning = process.emitWarning
		process.emitWarning = () => {}
		process.on("warning", () => {})

		// Suppress console output.
		this.originalConsole = {
			log: console.log,
			warn: console.warn,
			error: console.error,
			debug: console.debug,
			info: console.info,
		}

		console.log = () => {}
		console.warn = () => {}
		console.debug = () => {}
		console.info = () => {}
	}

	private restoreConsole(): void {
		if (this.options.integrationTest) {
			return
		}

		if (this.originalConsole) {
			console.log = this.originalConsole.log
			console.warn = this.originalConsole.warn
			console.error = this.originalConsole.error
			console.debug = this.originalConsole.debug
			console.info = this.originalConsole.info
			this.originalConsole = null
		}

		if (this.originalProcessEmitWarning) {
			process.emitWarning = this.originalProcessEmitWarning
			this.originalProcessEmitWarning = null
		}
	}

	private logMessageDebug(msg: ClineMessage, type: "new" | "updated"): void {
		if (msg.partial) {
			if (!this.outputManager.hasLoggedFirstPartial(msg.ts)) {
				this.outputManager.setLoggedFirstPartial(msg.ts)
				cliLogger.debug("message:start", { ts: msg.ts, type: msg.say || msg.ask })
			}
		} else {
			cliLogger.debug(`message:${type === "new" ? "new" : "complete"}`, { ts: msg.ts, type: msg.say || msg.ask })
			this.outputManager.clearLoggedFirstPartial(msg.ts)
		}
	}

	// ==========================================================================
	// Extension Lifecycle
	// ==========================================================================

	public async activate(): Promise<void> {
		const bundlePath = path.join(this.options.extensionPath, "extension.js")

		if (!fs.existsSync(bundlePath)) {
			this.restoreConsole()
			throw new Error(`Extension bundle not found at: ${bundlePath}`)
		}

		let storageDir: string | undefined

		if (this.options.ephemeral) {
			this.ephemeralStorageDir = await createEphemeralStorageDir()
			storageDir = this.ephemeralStorageDir
		}

		// Create VSCode API mock.
		this.vscode = createVSCodeAPI(this.options.extensionPath, this.options.workspacePath, undefined, {
			appRoot: CLI_PACKAGE_ROOT,
			storageDir,
		})
		;(global as Record<string, unknown>).vscode = this.vscode
		;(global as Record<string, unknown>).__extensionHost = this

		// Set up module resolution.
		const require = createRequire(import.meta.url)
		const Module = require("module")
		const originalResolve = Module._resolveFilename

		Module._resolveFilename = function (request: string, parent: unknown, isMain: boolean, options: unknown) {
			if (request === "vscode") return "vscode-mock"
			return originalResolve.call(this, request, parent, isMain, options)
		}

		require.cache["vscode-mock"] = {
			id: "vscode-mock",
			filename: "vscode-mock",
			loaded: true,
			exports: this.vscode,
			children: [],
			paths: [],
			path: "",
			isPreloading: false,
			parent: null,
			require: require,
		} as unknown as NodeJS.Module

		try {
			this.extensionModule = require(bundlePath) as ExtensionModule
		} catch (error) {
			Module._resolveFilename = originalResolve

			throw new Error(
				`Failed to load extension bundle: ${error instanceof Error ? error.message : String(error)}`,
			)
		}

		Module._resolveFilename = originalResolve

		try {
			this.extensionAPI = await this.extensionModule.activate(this.vscode.context)
		} catch (error) {
			throw new Error(`Failed to activate extension: ${error instanceof Error ? error.message : String(error)}`)
		}

		// Set up message listener - forward all messages to client.
		this.messageListener = (message: ExtensionMessage) => this.client.handleMessage(message)
		this.on("extensionWebviewMessage", this.messageListener)

		await pWaitFor(() => this.isReady, { interval: 100, timeout: 10_000 })
	}

	public registerWebviewProvider(_viewId: string, _provider: WebviewViewProvider): void {}

	public unregisterWebviewProvider(_viewId: string): void {}

	public markWebviewReady(): void {
		this.isReady = true

		// Send initial webview messages to trigger proper extension initialization.
		// This is critical for the extension to start sending state updates properly.
		this.sendToExtension({ type: "webviewDidLaunch" })

		setRuntimeConfigValues("roo-cline", this.initialSettings as Record<string, unknown>)
		this.sendToExtension({ type: "updateSettings", updatedSettings: this.initialSettings })
	}

	public isInInitialSetup(): boolean {
		return !this.isReady
	}

	// ==========================================================================
	// Message Handling
	// ==========================================================================

	public sendToExtension(message: WebviewMessage): void {
		if (!this.isReady) {
			throw new Error("You cannot send messages to the extension before it is ready")
		}

		this.emit("webviewMessage", message)
	}

	// ==========================================================================
	// Task Management
	// ==========================================================================

	public async runTask(prompt: string): Promise<void> {
		this.sendToExtension({ type: "newTask", text: prompt })

		return new Promise((resolve, reject) => {
			let timeoutId: NodeJS.Timeout | null = null
			const timeoutMs: number = 110_000

			const completeHandler = () => {
				cleanup()
				resolve()
			}

			const errorHandler = (error: Error) => {
				cleanup()
				reject(error)
			}

			const cleanup = () => {
				if (timeoutId) {
					clearTimeout(timeoutId)
					timeoutId = null
				}

				this.client.off("taskCompleted", completeHandler)
				this.client.off("error", errorHandler)
			}

			// Set timeout to prevent indefinite hanging.
			timeoutId = setTimeout(() => {
				cleanup()
				reject(
					new Error(`Task completion timeout after ${timeoutMs}ms - no completion or error event received`),
				)
			}, timeoutMs)

			this.client.once("taskCompleted", completeHandler)
			this.client.once("error", errorHandler)
		})
	}

	// ==========================================================================
	// Public Agent State API
	// ==========================================================================

	/**
	 * Get the current agent loop state.
	 */
	public getAgentState(): AgentStateInfo {
		return this.client.getAgentState()
	}

	/**
	 * Check if the agent is currently waiting for user input.
	 */
	public isWaitingForInput(): boolean {
		return this.client.getAgentState().isWaitingForInput
	}

	// ==========================================================================
	// Cleanup
	// ==========================================================================

	async dispose(): Promise<void> {
		// Clear managers.
		this.outputManager.clear()
		this.askDispatcher.clear()

		// Remove message listener.
		if (this.messageListener) {
			this.off("extensionWebviewMessage", this.messageListener)
			this.messageListener = null
		}

		// Reset client.
		this.client.reset()

		// Deactivate extension.
		if (this.extensionModule?.deactivate) {
			try {
				await this.extensionModule.deactivate()
			} catch {
				// NO-OP
			}
		}

		// Clear references.
		this.vscode = null
		this.extensionModule = null
		this.extensionAPI = null

		// Clear globals.
		delete (global as Record<string, unknown>).vscode
		delete (global as Record<string, unknown>).__extensionHost

		// Restore console.
		this.restoreConsole()

		// Clean up ephemeral storage.
		if (this.ephemeralStorageDir) {
			try {
				await fs.promises.rm(this.ephemeralStorageDir, { recursive: true, force: true })
				this.ephemeralStorageDir = null
			} catch {
				// NO-OP
			}
		}
	}
}
