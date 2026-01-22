/**
 * Extension Service for CLI
 *
 * This module provides CLI-typed wrappers around @kilocode/agent-runtime components.
 * Uses composition to bridge runtime's generic types to CLI's specific types.
 *
 * Type handling: agent-runtime uses generic types (index signatures) while CLI
 * uses specific types. We use composition with type assertions at the boundary.
 */

import {
	ExtensionService as RuntimeExtensionService,
	type ExtensionServiceOptions as RuntimeExtensionServiceOptions,
	setLogger,
	ExtensionHost as RuntimeExtensionHost,
	type ExtensionHostOptions as RuntimeExtensionHostOptions,
	MessageBridge as RuntimeMessageBridge,
	IPCChannel as RuntimeIPCChannel,
	createMessageBridge as runtimeCreateMessageBridge,
	createVSCodeAPIMock as runtimeCreateVSCodeAPIMock,
	type WebviewMessage as RuntimeWebviewMessage,
	type ExtensionMessage as RuntimeExtensionMessage,
	type ExtensionState as RuntimeExtensionState,
} from "@kilocode/agent-runtime"
import { logs } from "./logs.js"
import { TelemetryService } from "./telemetry/TelemetryService.js"
import type { ExtensionMessage, WebviewMessage, ExtensionState, ModeConfig } from "../types/messages.js"
import type { IdentityInfo } from "@kilocode/agent-runtime"
import { EventEmitter } from "events"

// Configure agent-runtime to use CLI's logger
setLogger({
	debug: (message: string, context?: string, meta?: Record<string, unknown>) => {
		logs.debug(message, context, meta)
	},
	info: (message: string, context?: string, meta?: Record<string, unknown>) => {
		logs.info(message, context, meta)
	},
	warn: (message: string, context?: string, meta?: Record<string, unknown>) => {
		logs.warn(message, context, meta)
	},
	error: (message: string, context?: string, meta?: Record<string, unknown>) => {
		logs.error(message, context, meta)
	},
})

/**
 * Configuration options for ExtensionService
 */
export interface ExtensionServiceOptions {
	workspace?: string
	mode?: string
	customModes?: ModeConfig[]
	extensionBundlePath?: string
	extensionRootPath?: string
	identity?: IdentityInfo
	appendSystemPrompt?: string
}

/**
 * Events emitted by ExtensionService
 */
export interface ExtensionServiceEvents {
	ready: (api: ExtensionAPI) => void
	stateChange: (state: ExtensionState) => void
	message: (message: ExtensionMessage) => void
	error: (error: Error) => void
	warning: (warning: { context: string; error: Error }) => void
	disposed: () => void
}

/**
 * Extension API interface
 */
export interface ExtensionAPI {
	getState(): ExtensionState | null
	sendWebviewMessage(message: WebviewMessage): Promise<void>
	injectConfiguration(config: Partial<ExtensionState>): Promise<void>
}

/**
 * Extension Host options
 */
export interface ExtensionHostOptions {
	workspacePath: string
	extensionBundlePath: string
	extensionRootPath: string
	identity?: IdentityInfo
	customModes?: ModeConfig[]
	appendSystemPrompt?: string
}

/**
 * CLI-typed ExtensionService using composition pattern.
 * Wraps RuntimeExtensionService and provides CLI-specific types.
 */
export class ExtensionService extends EventEmitter {
	private _runtime: RuntimeExtensionService

	constructor(options: ExtensionServiceOptions = {}) {
		super()
		this._runtime = new RuntimeExtensionService(options as RuntimeExtensionServiceOptions)

		// Forward events from runtime with type casting
		this._runtime.on("ready", (api) => this.emit("ready", this.wrapExtensionAPI(api)))
		this._runtime.on("stateChange", (state) => this.emit("stateChange", state as ExtensionState))
		this._runtime.on("message", (message) => {
			const extMessage = message as ExtensionMessage
			TelemetryService.getInstance().trackExtensionMessageReceived(extMessage.type)
			this.emit("message", extMessage)
		})
		this._runtime.on("error", (error) => this.emit("error", error))
		this._runtime.on("warning", (warning) => this.emit("warning", warning))
		this._runtime.on("disposed", () => this.emit("disposed"))
	}

	private wrapExtensionAPI(api: unknown): ExtensionAPI {
		const runtimeApi = api as {
			getState: () => unknown
			sendMessage: (message: unknown) => void
			updateState: (updates: unknown) => void
		}
		return {
			getState: () => runtimeApi.getState() as ExtensionState | null,
			sendWebviewMessage: async (msg: WebviewMessage) => {
				// Use the service's sendWebviewMessage for proper routing
				await this.sendWebviewMessage(msg)
			},
			injectConfiguration: async (config: Partial<ExtensionState>) => {
				const host = this._runtime.getExtensionHost()
				await host.injectConfiguration(config as unknown as Partial<RuntimeExtensionState>)
			},
		}
	}

	async initialize(): Promise<void> {
		return this._runtime.initialize()
	}

	async dispose(): Promise<void> {
		return this._runtime.dispose()
	}

	isReady(): boolean {
		return this._runtime.isReady()
	}

	getState(): ExtensionState | null {
		return this._runtime.getState() as ExtensionState | null
	}

	async sendWebviewMessage(message: WebviewMessage): Promise<void> {
		TelemetryService.getInstance().trackExtensionMessageSent(message.type)
		return this._runtime.sendWebviewMessage(message as unknown as RuntimeWebviewMessage)
	}

	async requestSingleCompletion(prompt: string, timeoutMs?: number): Promise<string> {
		return this._runtime.requestSingleCompletion(prompt, timeoutMs)
	}

	getExtensionAPI(): ExtensionAPI | null {
		const api = this._runtime.getExtensionAPI()
		if (!api) return null
		return this.wrapExtensionAPI(api)
	}

	getExtensionHost(): ExtensionHost {
		const host = this._runtime.getExtensionHost()
		return new ExtensionHost(host)
	}

	getMessageBridge(): MessageBridge {
		const bridge = this._runtime.getMessageBridge()
		return new MessageBridge(bridge)
	}

	// Type-safe event methods
	override on<K extends keyof ExtensionServiceEvents>(event: K, listener: ExtensionServiceEvents[K]): this {
		return super.on(event as string, listener as (...args: unknown[]) => void)
	}

	override once<K extends keyof ExtensionServiceEvents>(event: K, listener: ExtensionServiceEvents[K]): this {
		return super.once(event as string, listener as (...args: unknown[]) => void)
	}

	override emit<K extends keyof ExtensionServiceEvents>(
		event: K,
		...args: Parameters<ExtensionServiceEvents[K]>
	): boolean {
		return super.emit(event as string, ...args)
	}

	override off<K extends keyof ExtensionServiceEvents>(event: K, listener: ExtensionServiceEvents[K]): this {
		return super.off(event as string, listener as (...args: unknown[]) => void)
	}
}

/**
 * CLI-typed ExtensionHost using composition pattern.
 */
export class ExtensionHost {
	private _runtime: RuntimeExtensionHost

	constructor(runtimeOrOptions: RuntimeExtensionHost | ExtensionHostOptions) {
		if (runtimeOrOptions instanceof RuntimeExtensionHost) {
			this._runtime = runtimeOrOptions
		} else {
			this._runtime = new RuntimeExtensionHost(runtimeOrOptions as RuntimeExtensionHostOptions)
		}
	}

	async activate(): Promise<ExtensionAPI> {
		const api = await this._runtime.activate()
		return this.wrapExtensionAPI(api)
	}

	async deactivate(): Promise<void> {
		return this._runtime.deactivate()
	}

	private wrapExtensionAPI(api: unknown): ExtensionAPI {
		const runtimeApi = api as {
			getState: () => unknown
			sendMessage: (message: unknown) => void
			updateState: (updates: unknown) => void
		}
		return {
			getState: () => runtimeApi.getState() as ExtensionState | null,
			sendWebviewMessage: async (msg: WebviewMessage) => {
				await this.sendWebviewMessage(msg)
			},
			injectConfiguration: async (config: Partial<ExtensionState>) => {
				await this.injectConfiguration(config)
			},
		}
	}

	getAPI(): ExtensionAPI {
		const api = this._runtime.getAPI()
		return this.wrapExtensionAPI(api)
	}

	async sendWebviewMessage(message: WebviewMessage): Promise<void> {
		return this._runtime.sendWebviewMessage(message as unknown as RuntimeWebviewMessage)
	}

	async injectConfiguration(config: Partial<ExtensionState>): Promise<void> {
		return this._runtime.injectConfiguration(config as unknown as Partial<RuntimeExtensionState>)
	}

	async syncConfigurationMessages(configState: Partial<ExtensionState>): Promise<void> {
		return this._runtime.syncConfigurationMessages(configState as unknown as Partial<RuntimeExtensionState>)
	}

	markWebviewReady(): void {
		this._runtime.markWebviewReady()
	}

	isWebviewReady(): boolean {
		return this._runtime.isWebviewReady()
	}

	isInInitialSetup(): boolean {
		return this._runtime.isInInitialSetup()
	}

	// Forward EventEmitter methods
	on(event: string, listener: (...args: unknown[]) => void): this {
		this._runtime.on(event, listener)
		return this
	}

	off(event: string, listener: (...args: unknown[]) => void): this {
		this._runtime.off(event, listener)
		return this
	}

	emit(event: string, ...args: unknown[]): boolean {
		return this._runtime.emit(event, ...args)
	}
}

/**
 * CLI-typed MessageBridge using composition pattern.
 */
export class MessageBridge {
	private _runtime: RuntimeMessageBridge

	constructor(runtime: RuntimeMessageBridge) {
		this._runtime = runtime
	}

	async sendWebviewMessage(message: WebviewMessage): Promise<unknown> {
		return this._runtime.sendWebviewMessage(message as unknown as RuntimeWebviewMessage)
	}

	async sendExtensionMessage(message: ExtensionMessage): Promise<void> {
		return this._runtime.sendExtensionMessage(message as unknown as RuntimeExtensionMessage)
	}

	getTUIChannel(): RuntimeIPCChannel {
		return this._runtime.getTUIChannel()
	}

	getExtensionChannel(): RuntimeIPCChannel {
		return this._runtime.getExtensionChannel()
	}

	dispose(): void {
		this._runtime.dispose()
	}
}

// Re-export IPCChannel as-is
export { RuntimeIPCChannel as IPCChannel }
export type { IPCMessage, IPCOptions } from "@kilocode/agent-runtime"

// Factory functions with CLI types
export function createExtensionService(options: ExtensionServiceOptions = {}): ExtensionService {
	return new ExtensionService(options)
}

export function createExtensionHost(options: ExtensionHostOptions): ExtensionHost {
	return new ExtensionHost(options)
}

export function createMessageBridge(options?: { enableLogging?: boolean; timeout?: number }): MessageBridge {
	const bridge = runtimeCreateMessageBridge(options)
	return new MessageBridge(bridge)
}

export function createVSCodeAPIMock(extensionRootPath: string, workspacePath: string, identity?: IdentityInfo) {
	return runtimeCreateVSCodeAPIMock(extensionRootPath, workspacePath, identity)
}

// Re-export types
export type { IdentityInfo, ExtensionContext } from "@kilocode/agent-runtime"
