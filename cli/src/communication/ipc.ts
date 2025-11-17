import { EventEmitter } from "events"
import { logs } from "../services/logs.js"
import type { ExtensionMessage, WebviewMessage } from "../types/messages.js"

export interface IPCMessage {
	id: string
	type: "request" | "response" | "event"
	data: unknown
	ts: number
}

export interface IPCOptions {
	timeout?: number
	enableLogging?: boolean
}

/**
 * Inter-Process Communication layer for CLI <-> Extension Host communication
 * Replicates the webview message passing pattern used in the VSCode extension
 */
export class IPCChannel extends EventEmitter {
	// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
	private pendingRequests = new Map<string, { resolve: Function; reject: Function; timeout: NodeJS.Timeout }>()
	private messageId = 0
	private options: Required<IPCOptions>

	constructor(options: IPCOptions = {}) {
		super()
		this.options = {
			timeout: options.timeout || 30000, // 30 seconds default timeout
			enableLogging: options.enableLogging || false,
		}
	}

	/**
	 * Send a request message and wait for response
	 */
	async request<T = unknown>(data: unknown): Promise<T> {
		const id = this.generateMessageId()
		const message: IPCMessage = {
			id,
			type: "request",
			data,
			ts: Date.now(),
		}

		return new Promise<T>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pendingRequests.delete(id)
				reject(new Error(`IPC request timeout after ${this.options.timeout}ms`))
			}, this.options.timeout)

			this.pendingRequests.set(id, { resolve, reject, timeout })

			if (this.options.enableLogging) {
				logs.debug(`Sending request ${id}`, "IPC", { data })
			}

			this.emit("message", message)
		})
	}

	/**
	 * Send a response to a request
	 */
	respond(requestId: string, data: unknown): void {
		const message: IPCMessage = {
			id: requestId,
			type: "response",
			data,
			ts: Date.now(),
		}

		if (this.options.enableLogging) {
			logs.debug(`Sending response ${requestId}`, "IPC", { data })
		}

		this.emit("message", message)
	}

	/**
	 * Send an event message (no response expected)
	 */
	event(data: unknown): void {
		const message: IPCMessage = {
			id: this.generateMessageId(),
			type: "event",
			data,
			ts: Date.now(),
		}

		if (this.options.enableLogging) {
			logs.debug("Sending event", "IPC", { data })
		}

		// Emit both the message (for routing) and the event (for local handlers)
		this.emit("message", message)
		this.emit("event", message)
	}

	/**
	 * Handle incoming messages
	 */
	handleMessage(message: IPCMessage): void {
		if (this.options.enableLogging) {
			logs.debug(`Received ${message.type} ${message.id}`, "IPC", { data: message.data })
		}

		switch (message.type) {
			case "response":
				this.handleResponse(message)
				break
			case "request":
				this.emit("request", message)
				break
			case "event":
				this.emit("event", message)
				break
		}
	}

	private handleResponse(message: IPCMessage): void {
		const pending = this.pendingRequests.get(message.id)
		if (pending) {
			clearTimeout(pending.timeout)
			this.pendingRequests.delete(message.id)
			pending.resolve(message.data)
		}
	}

	private generateMessageId(): string {
		return `msg_${++this.messageId}_${Date.now()}`
	}

	dispose(): void {
		// Clear all pending requests
		for (const [, pending] of this.pendingRequests) {
			clearTimeout(pending.timeout)
			pending.reject(new Error("IPC channel disposed"))
		}
		this.pendingRequests.clear()
		this.removeAllListeners()
	}
}

/**
 * Message bridge that connects TUI and Extension Host
 * Handles bidirectional communication and message routing
 */
export class MessageBridge extends EventEmitter {
	private tuiChannel: IPCChannel
	private extensionChannel: IPCChannel

	constructor(options: IPCOptions = {}) {
		super()

		this.tuiChannel = new IPCChannel(options)
		this.extensionChannel = new IPCChannel(options)

		// Set up message routing
		this.tuiChannel.on("message", (message: IPCMessage) => {
			this.extensionChannel.handleMessage(message)
		})

		this.extensionChannel.on("message", (message: IPCMessage) => {
			this.tuiChannel.handleMessage(message)
		})

		// Forward events
		this.tuiChannel.on("request", (message: IPCMessage) => {
			this.emit("tuiRequest", message)
		})

		this.extensionChannel.on("request", (message: IPCMessage) => {
			this.emit("extensionRequest", message)
		})

		this.tuiChannel.on("event", (message: IPCMessage) => {
			this.emit("tuiEvent", message)
		})

		this.extensionChannel.on("event", (message: IPCMessage) => {
			this.emit("extensionEvent", message)
		})
	}

	/**
	 * Get the TUI-side IPC channel
	 */
	getTUIChannel(): IPCChannel {
		return this.tuiChannel
	}

	/**
	 * Get the Extension-side IPC channel
	 */
	getExtensionChannel(): IPCChannel {
		return this.extensionChannel
	}

	/**
	 * Send a webview message from TUI to extension
	 */
	async sendWebviewMessage(message: WebviewMessage): Promise<unknown> {
		return this.tuiChannel.request({
			type: "webviewMessage",
			payload: message,
		})
	}

	/**
	 * Send an extension message from extension to TUI
	 */
	async sendExtensionMessage(message: ExtensionMessage): Promise<void> {
		this.extensionChannel.event({
			type: "extensionMessage",
			payload: message,
		})
	}

	dispose(): void {
		this.tuiChannel.dispose()
		this.extensionChannel.dispose()
		this.removeAllListeners()
	}
}

export function createMessageBridge(options: IPCOptions = {}): MessageBridge {
	return new MessageBridge(options)
}
