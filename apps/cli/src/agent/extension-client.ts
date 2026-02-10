/**
 * Roo Code Client
 *
 * This is the main entry point for the client library. It provides a high-level
 * API for:
 * - Processing messages from the extension host
 * - Querying the current agent state
 * - Subscribing to state change events
 * - Sending responses back to the extension
 *
 * The client is designed to be transport-agnostic. You provide a way to send
 * messages to the extension, and you feed incoming messages to the client.
 *
 * Architecture:
 * ```
 *                     ┌───────────────────────────────────────────────┐
 *                     │               ExtensionClient                 │
 *                     │                                               │
 *   Extension ──────▶ │  MessageProcessor ──▶ StateStore              │
 *   Messages          │         │                  │                  │
 *                     │         ▼                  ▼                  │
 *                     │    TypedEventEmitter ◀── State/Events         │
 *                     │         │                                     │
 *                     │         ▼                                     │
 *                     │    Your Event Handlers                        │
 *                     └───────────────────────────────────────────────┘
 * ```
 */

import type { ExtensionMessage, WebviewMessage, ClineAskResponse, ClineMessage, ClineAsk } from "@roo-code/types"

import { StateStore } from "./state-store.js"
import { MessageProcessor, parseExtensionMessage } from "./message-processor.js"
import {
	TypedEventEmitter,
	type ClientEventMap,
	type AgentStateChangeEvent,
	type WaitingForInputEvent,
	type ModeChangedEvent,
} from "./events.js"
import { AgentLoopState, type AgentStateInfo } from "./agent-state.js"

// =============================================================================
// Extension Client Configuration
// =============================================================================

/**
 * Configuration options for the ExtensionClient.
 */
export interface ExtensionClientConfig {
	/**
	 * Function to send messages to the extension host.
	 * This is how the client communicates back to the extension.
	 *
	 * Example implementations:
	 * - VSCode webview: (msg) => vscode.postMessage(msg)
	 * - WebSocket: (msg) => socket.send(JSON.stringify(msg))
	 * - IPC: (msg) => process.send(msg)
	 */
	sendMessage: (message: WebviewMessage) => void

	/**
	 * Whether to emit events for all state changes or only significant ones.
	 * Default: true
	 */
	emitAllStateChanges?: boolean

	/**
	 * Enable debug logging.
	 * Default: false
	 */
	debug?: boolean

	/**
	 * Maximum state history size (for debugging).
	 * Set to 0 to disable history tracking.
	 * Default: 0
	 */
	maxHistorySize?: number
}

// =============================================================================
// Main Client Class
// =============================================================================

/**
 * ExtensionClient is the main interface for interacting with the Roo Code extension.
 *
 * Basic usage:
 * ```typescript
 * // Create client with message sender
 * const client = new ExtensionClient({
 *   sendMessage: (msg) => vscode.postMessage(msg)
 * })
 *
 * // Subscribe to state changes
 * client.on('stateChange', (event) => {
 *   console.log('State:', event.currentState.state)
 * })
 *
 * // Subscribe to specific events
 * client.on('waitingForInput', (event) => {
 *   console.log('Waiting for:', event.ask)
 * })
 *
 * // Feed messages from extension
 * window.addEventListener('message', (e) => {
 *   client.handleMessage(e.data)
 * })
 *
 * // Query state at any time
 * const state = client.getAgentState()
 * if (state.isWaitingForInput) {
 *   // Show approval UI
 * }
 *
 * // Send responses
 * client.approve() // or client.reject() or client.respond('answer')
 * ```
 */
export class ExtensionClient {
	private store: StateStore
	private processor: MessageProcessor
	private emitter: TypedEventEmitter
	private sendMessage: (message: WebviewMessage) => void
	private debug: boolean

	constructor(config: ExtensionClientConfig) {
		this.sendMessage = config.sendMessage
		this.debug = config.debug ?? false
		this.store = new StateStore({ maxHistorySize: config.maxHistorySize ?? 0 })
		this.emitter = new TypedEventEmitter()

		this.processor = new MessageProcessor(this.store, this.emitter, {
			emitAllStateChanges: config.emitAllStateChanges ?? true,
			debug: config.debug ?? false,
		})
	}

	// ===========================================================================
	// Message Handling
	// ===========================================================================

	/**
	 * Handle an incoming message from the extension host.
	 *
	 * Call this method whenever you receive a message from the extension.
	 * The client will parse, validate, and process the message, updating
	 * internal state and emitting appropriate events.
	 *
	 * @param message - The raw message (can be ExtensionMessage or JSON string)
	 */
	handleMessage(message: ExtensionMessage | string): void {
		let parsed: ExtensionMessage | undefined

		if (typeof message === "string") {
			parsed = parseExtensionMessage(message)

			if (!parsed) {
				if (this.debug) {
					console.log("[ExtensionClient] Failed to parse message:", message)
				}

				return
			}
		} else {
			parsed = message
		}

		this.processor.processMessage(parsed)
	}

	/**
	 * Handle multiple messages at once.
	 */
	handleMessages(messages: (ExtensionMessage | string)[]): void {
		for (const message of messages) {
			this.handleMessage(message)
		}
	}

	// ===========================================================================
	// State Queries - Always know the current state
	// ===========================================================================

	/**
	 * Get the complete agent state information.
	 *
	 * This returns everything you need to know about the current state:
	 * - The high-level state (running, streaming, waiting, idle, etc.)
	 * - Whether input is needed
	 * - The specific ask type if waiting
	 * - What action is required
	 * - Human-readable description
	 */
	getAgentState(): AgentStateInfo {
		return this.store.getAgentState()
	}

	/**
	 * Get just the current state enum value.
	 */
	getCurrentState(): AgentLoopState {
		return this.store.getCurrentState()
	}

	/**
	 * Check if the agent is waiting for user input.
	 */
	isWaitingForInput(): boolean {
		return this.store.isWaitingForInput()
	}

	/**
	 * Check if the agent is actively running.
	 */
	isRunning(): boolean {
		return this.store.isRunning()
	}

	/**
	 * Check if content is currently streaming.
	 */
	isStreaming(): boolean {
		return this.store.isStreaming()
	}

	/**
	 * Check if there is an active task.
	 */
	hasActiveTask(): boolean {
		return this.store.getCurrentState() !== AgentLoopState.NO_TASK
	}

	/**
	 * Get all messages in the current task.
	 */
	getMessages(): ClineMessage[] {
		return this.store.getMessages()
	}

	/**
	 * Get the last message.
	 */
	getLastMessage(): ClineMessage | undefined {
		return this.store.getLastMessage()
	}

	/**
	 * Get the current ask type if the agent is waiting for input.
	 */
	getCurrentAsk(): ClineAsk | undefined {
		return this.store.getAgentState().currentAsk
	}

	/**
	 * Check if the client has received any state from the extension.
	 */
	isInitialized(): boolean {
		return this.store.isInitialized()
	}

	/**
	 * Get the current mode (e.g., "code", "architect", "ask").
	 * Returns undefined if no mode has been received yet.
	 */
	getCurrentMode(): string | undefined {
		return this.store.getCurrentMode()
	}

	// ===========================================================================
	// Event Subscriptions - Realtime notifications
	// ===========================================================================

	/**
	 * Subscribe to an event.
	 *
	 * Returns an unsubscribe function for easy cleanup.
	 *
	 * @param event - The event to subscribe to
	 * @param listener - The callback function
	 * @returns Unsubscribe function
	 *
	 * @example
	 * ```typescript
	 * const unsubscribe = client.on('stateChange', (event) => {
	 *   console.log(event.currentState)
	 * })
	 *
	 * // Later, to unsubscribe:
	 * unsubscribe()
	 * ```
	 */
	on<K extends keyof ClientEventMap>(event: K, listener: (payload: ClientEventMap[K]) => void): () => void {
		return this.emitter.on(event, listener)
	}

	/**
	 * Subscribe to an event, triggered only once.
	 */
	once<K extends keyof ClientEventMap>(event: K, listener: (payload: ClientEventMap[K]) => void): void {
		this.emitter.once(event, listener)
	}

	/**
	 * Unsubscribe from an event.
	 */
	off<K extends keyof ClientEventMap>(event: K, listener: (payload: ClientEventMap[K]) => void): void {
		this.emitter.off(event, listener)
	}

	/**
	 * Remove all listeners for an event, or all events.
	 */
	removeAllListeners<K extends keyof ClientEventMap>(event?: K): void {
		this.emitter.removeAllListeners(event)
	}

	/**
	 * Convenience method: Subscribe only to state changes.
	 */
	onStateChange(listener: (event: AgentStateChangeEvent) => void): () => void {
		return this.on("stateChange", listener)
	}

	/**
	 * Convenience method: Subscribe only to waiting events.
	 */
	onWaitingForInput(listener: (event: WaitingForInputEvent) => void): () => void {
		return this.on("waitingForInput", listener)
	}

	/**
	 * Convenience method: Subscribe only to mode changes.
	 */
	onModeChanged(listener: (event: ModeChangedEvent) => void): () => void {
		return this.on("modeChanged", listener)
	}

	// ===========================================================================
	// Response Methods - Send actions to the extension
	// ===========================================================================

	/**
	 * Approve the current action (tool, command, browser, MCP).
	 *
	 * Use when the agent is waiting for approval (interactive asks).
	 */
	approve(): void {
		this.sendResponse("yesButtonClicked")
	}

	/**
	 * Reject the current action.
	 *
	 * Use when you want to deny a tool, command, or other action.
	 */
	reject(): void {
		this.sendResponse("noButtonClicked")
	}

	/**
	 * Send a text response.
	 *
	 * Use for:
	 * - Answering follow-up questions
	 * - Providing additional context
	 * - Giving feedback on completion
	 *
	 * @param text - The response text
	 * @param images - Optional base64-encoded images
	 */
	respond(text: string, images?: string[]): void {
		this.sendResponse("messageResponse", text, images)
	}

	/**
	 * Generic method to send any ask response.
	 *
	 * @param response - The response type
	 * @param text - Optional text content
	 * @param images - Optional images
	 */
	sendResponse(response: ClineAskResponse, text?: string, images?: string[]): void {
		const message: WebviewMessage = {
			type: "askResponse",
			askResponse: response,
			text,
			images,
		}
		this.sendMessage(message)
	}

	// ===========================================================================
	// Task Control Methods
	// ===========================================================================

	/**
	 * Start a new task with the given prompt.
	 *
	 * @param text - The task description/prompt
	 * @param images - Optional base64-encoded images
	 */
	newTask(text: string, images?: string[]): void {
		const message: WebviewMessage = {
			type: "newTask",
			text,
			images,
		}
		this.sendMessage(message)
	}

	/**
	 * Clear the current task.
	 *
	 * This ends the current task and resets to a fresh state.
	 */
	clearTask(): void {
		const message: WebviewMessage = {
			type: "clearTask",
		}
		this.sendMessage(message)
		this.processor.notifyTaskCleared()
	}

	/**
	 * Cancel a running task.
	 *
	 * Use this to interrupt a task that is currently processing.
	 */
	cancelTask(): void {
		const message: WebviewMessage = {
			type: "cancelTask",
		}
		this.sendMessage(message)
	}

	/**
	 * Resume a paused task.
	 *
	 * Use when the agent state is RESUMABLE (resume_task ask).
	 */
	resumeTask(): void {
		this.approve() // Resume uses the same response as approve
	}

	/**
	 * Retry a failed API request.
	 *
	 * Use when the agent state shows api_req_failed.
	 */
	retryApiRequest(): void {
		this.approve() // Retry uses the same response as approve
	}

	// ===========================================================================
	// Terminal Operation Methods
	// ===========================================================================

	/**
	 * Continue terminal output (don't wait for more output).
	 *
	 * Use when the agent is showing command_output and you want to proceed.
	 */
	continueTerminal(): void {
		const message: WebviewMessage = {
			type: "terminalOperation",
			terminalOperation: "continue",
		}
		this.sendMessage(message)
	}

	/**
	 * Abort terminal command.
	 *
	 * Use when you want to kill a running terminal command.
	 */
	abortTerminal(): void {
		const message: WebviewMessage = {
			type: "terminalOperation",
			terminalOperation: "abort",
		}
		this.sendMessage(message)
	}

	// ===========================================================================
	// Utility Methods
	// ===========================================================================

	/**
	 * Reset the client state.
	 *
	 * This clears all internal state and history.
	 * Useful when disconnecting or starting fresh.
	 */
	reset(): void {
		this.store.reset()
		this.emitter.removeAllListeners()
	}

	/**
	 * Get the state history (if history tracking is enabled).
	 */
	getStateHistory() {
		return this.store.getHistory()
	}

	/**
	 * Enable or disable debug mode.
	 */
	setDebug(enabled: boolean): void {
		this.debug = enabled
		this.processor.setDebug(enabled)
	}

	// ===========================================================================
	// Advanced: Direct Store Access
	// ===========================================================================

	/**
	 * Get direct access to the state store.
	 *
	 * This is for advanced use cases where you need more control.
	 * Most users should use the methods above instead.
	 */
	getStore(): StateStore {
		return this.store
	}

	/**
	 * Get direct access to the event emitter.
	 */
	getEmitter(): TypedEventEmitter {
		return this.emitter
	}
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a new ExtensionClient instance.
 *
 * This is a convenience function that creates a client with default settings.
 *
 * @param sendMessage - Function to send messages to the extension
 * @returns A new ExtensionClient instance
 */
export function createClient(sendMessage: (message: WebviewMessage) => void): ExtensionClient {
	return new ExtensionClient({ sendMessage })
}

/**
 * Create a mock client for testing.
 *
 * The mock client captures all sent messages for verification.
 *
 * @returns An object with the client and captured messages
 */
export function createMockClient(): {
	client: ExtensionClient
	sentMessages: WebviewMessage[]
	clearMessages: () => void
} {
	const sentMessages: WebviewMessage[] = []

	const client = new ExtensionClient({
		sendMessage: (message) => sentMessages.push(message),
		debug: false,
	})

	return {
		client,
		sentMessages,
		clearMessages: () => {
			sentMessages.length = 0
		},
	}
}
