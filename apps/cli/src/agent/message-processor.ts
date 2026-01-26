/**
 * Message Processor
 *
 * This module handles incoming messages from the extension host and dispatches
 * appropriate state updates and events. It acts as the bridge between raw
 * extension messages and the client's internal state management.
 *
 * Message Flow:
 * ```
 * Extension Host ──▶ MessageProcessor ──▶ StateStore ──▶ Events
 * ```
 *
 * The processor handles different message types:
 * - "state": Full state update from extension
 * - "messageUpdated": Single message update
 * - "action": UI action triggers
 * - "invoke": Command invocations
 */

import { ExtensionMessage, ClineMessage } from "@roo-code/types"
import { debugLog } from "@roo-code/core/cli"

import type { StateStore } from "./state-store.js"
import type { TypedEventEmitter, AgentStateChangeEvent, WaitingForInputEvent, TaskCompletedEvent } from "./events.js"
import {
	isSignificantStateChange,
	transitionedToWaiting,
	transitionedToRunning,
	streamingStarted,
	streamingEnded,
	taskCompleted,
} from "./events.js"
import type { AgentStateInfo } from "./agent-state.js"

// =============================================================================
// Message Processor Options
// =============================================================================

export interface MessageProcessorOptions {
	/**
	 * Whether to emit events for every state change, or only significant ones.
	 * Default: true (emit all changes)
	 */
	emitAllStateChanges?: boolean

	/**
	 * Whether to log debug information.
	 * Default: false
	 */
	debug?: boolean
}

// =============================================================================
// Message Processor Class
// =============================================================================

/**
 * MessageProcessor handles incoming extension messages and updates state accordingly.
 *
 * It is responsible for:
 * 1. Parsing and validating incoming messages
 * 2. Updating the state store
 * 3. Emitting appropriate events
 *
 * Usage:
 * ```typescript
 * const store = new StateStore()
 * const emitter = new TypedEventEmitter()
 * const processor = new MessageProcessor(store, emitter)
 *
 * // Process a message from the extension
 * processor.processMessage(extensionMessage)
 * ```
 */
export class MessageProcessor {
	private store: StateStore
	private emitter: TypedEventEmitter
	private options: Required<MessageProcessorOptions>

	constructor(store: StateStore, emitter: TypedEventEmitter, options: MessageProcessorOptions = {}) {
		this.store = store
		this.emitter = emitter
		this.options = {
			emitAllStateChanges: options.emitAllStateChanges ?? true,
			debug: options.debug ?? false,
		}
	}

	// ===========================================================================
	// Main Processing Methods
	// ===========================================================================

	/**
	 * Process an incoming message from the extension host.
	 *
	 * This is the main entry point for all extension messages.
	 * It routes messages to the appropriate handler based on type.
	 *
	 * @param message - The raw message from the extension
	 */
	processMessage(message: ExtensionMessage): void {
		if (this.options.debug) {
			debugLog("[MessageProcessor] Received message", { type: message.type })
		}

		try {
			switch (message.type) {
				case "state":
					this.handleStateMessage(message)
					break

				case "messageUpdated":
					this.handleMessageUpdated(message)
					break

				case "action":
					this.handleAction(message)
					break

				case "invoke":
					this.handleInvoke(message)
					break

				default:
					// Other message types are not relevant to state detection
					if (this.options.debug) {
						debugLog("[MessageProcessor] Ignoring message", { type: message.type })
					}
			}
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error))
			debugLog("[MessageProcessor] Error processing message", { error: err.message })
			this.emitter.emit("error", err)
		}
	}

	/**
	 * Process an array of messages (for batch updates).
	 */
	processMessages(messages: ExtensionMessage[]): void {
		for (const message of messages) {
			this.processMessage(message)
		}
	}

	// ===========================================================================
	// Message Type Handlers
	// ===========================================================================

	/**
	 * Handle a "state" message - full state update from extension.
	 *
	 * This is the most important message type for state detection.
	 * It contains the complete clineMessages array which is the source of truth.
	 */
	private handleStateMessage(message: ExtensionMessage): void {
		if (!message.state) {
			if (this.options.debug) {
				debugLog("[MessageProcessor] State message missing state payload")
			}
			return
		}

		const { clineMessages, mode } = message.state

		// Track mode changes.
		if (mode && typeof mode === "string") {
			const previousMode = this.store.getCurrentMode()

			if (previousMode !== mode) {
				if (this.options.debug) {
					debugLog("[MessageProcessor] Mode changed", { from: previousMode, to: mode })
				}

				this.store.setCurrentMode(mode)
				this.emitter.emit("modeChanged", { previousMode, currentMode: mode })
			}
		}

		if (!clineMessages) {
			if (this.options.debug) {
				debugLog("[MessageProcessor] State message missing clineMessages")
			}
			return
		}

		// Get previous state for comparison.
		const previousState = this.store.getAgentState()

		// Update the store with new messages
		// Note: We only call setMessages, NOT setExtensionState, to avoid
		// double processing (setExtensionState would call setMessages again)
		this.store.setMessages(clineMessages)

		// Get new state after update
		const currentState = this.store.getAgentState()

		// Debug logging for state message
		if (this.options.debug) {
			const lastMsg = clineMessages[clineMessages.length - 1]
			const lastMsgInfo = lastMsg
				? {
						msgType: lastMsg.type === "ask" ? `ask:${lastMsg.ask}` : `say:${lastMsg.say}`,
						partial: lastMsg.partial,
						textPreview: lastMsg.text?.substring(0, 50),
					}
				: null
			debugLog("[MessageProcessor] State update", {
				messageCount: clineMessages.length,
				lastMessage: lastMsgInfo,
				stateTransition: `${previousState.state} → ${currentState.state}`,
				currentAsk: currentState.currentAsk,
				isWaitingForInput: currentState.isWaitingForInput,
				isStreaming: currentState.isStreaming,
				isRunning: currentState.isRunning,
			})
		}

		// Emit events based on state changes
		this.emitStateChangeEvents(previousState, currentState)

		// Emit new message events for any messages we haven't seen
		this.emitNewMessageEvents(previousState, currentState, clineMessages)
	}

	/**
	 * Handle a "messageUpdated" message - single message update.
	 *
	 * This is sent when a message is modified (e.g., partial -> complete).
	 */
	private handleMessageUpdated(message: ExtensionMessage): void {
		if (!message.clineMessage) {
			if (this.options.debug) {
				debugLog("[MessageProcessor] messageUpdated missing clineMessage")
			}
			return
		}

		const clineMessage = message.clineMessage
		const previousState = this.store.getAgentState()

		// Update the message in the store
		this.store.updateMessage(clineMessage)

		const currentState = this.store.getAgentState()

		// Emit message updated event
		this.emitter.emit("messageUpdated", clineMessage)

		// Emit state change events
		this.emitStateChangeEvents(previousState, currentState)
	}

	/**
	 * Handle an "action" message - UI action trigger.
	 *
	 * These are typically used to trigger UI behaviors and don't
	 * directly affect agent state, but we can track them if needed.
	 */
	private handleAction(message: ExtensionMessage): void {
		if (this.options.debug) {
			debugLog("[MessageProcessor] Action", { action: message.action })
		}
		// Actions don't affect agent state, but subclasses could override this
	}

	/**
	 * Handle an "invoke" message - command invocation.
	 *
	 * These are commands that should trigger specific behaviors.
	 */
	private handleInvoke(message: ExtensionMessage): void {
		if (this.options.debug) {
			debugLog("[MessageProcessor] Invoke", { invoke: message.invoke })
		}
		// Invokes don't directly affect state detection
		// But they might trigger state changes through subsequent messages
	}

	// ===========================================================================
	// Event Emission Helpers
	// ===========================================================================

	/**
	 * Emit events based on state changes.
	 */
	private emitStateChangeEvents(previousState: AgentStateInfo, currentState: AgentStateInfo): void {
		const isSignificant = isSignificantStateChange(previousState, currentState)

		// Emit stateChange event
		if (this.options.emitAllStateChanges || isSignificant) {
			const changeEvent: AgentStateChangeEvent = {
				previousState,
				currentState,
				isSignificantChange: isSignificant,
			}
			this.emitter.emit("stateChange", changeEvent)
		}

		// Emit specific transition events

		// Waiting for input
		if (transitionedToWaiting(previousState, currentState)) {
			if (currentState.currentAsk && currentState.lastMessage) {
				if (this.options.debug) {
					debugLog("[MessageProcessor] EMIT waitingForInput", {
						ask: currentState.currentAsk,
						action: currentState.requiredAction,
					})
				}
				const waitingEvent: WaitingForInputEvent = {
					ask: currentState.currentAsk,
					stateInfo: currentState,
					message: currentState.lastMessage,
				}
				this.emitter.emit("waitingForInput", waitingEvent)
			}
		}

		// Resumed running
		if (transitionedToRunning(previousState, currentState)) {
			if (this.options.debug) {
				debugLog("[MessageProcessor] EMIT resumedRunning")
			}
			this.emitter.emit("resumedRunning", undefined as void)
		}

		// Streaming started
		if (streamingStarted(previousState, currentState)) {
			if (this.options.debug) {
				debugLog("[MessageProcessor] EMIT streamingStarted")
			}
			this.emitter.emit("streamingStarted", undefined as void)
		}

		// Streaming ended
		if (streamingEnded(previousState, currentState)) {
			if (this.options.debug) {
				debugLog("[MessageProcessor] EMIT streamingEnded")
			}
			this.emitter.emit("streamingEnded", undefined as void)
		}

		// Task completed
		if (taskCompleted(previousState, currentState)) {
			if (this.options.debug) {
				debugLog("[MessageProcessor] EMIT taskCompleted", {
					success: currentState.currentAsk === "completion_result",
				})
			}
			const completedEvent: TaskCompletedEvent = {
				success: currentState.currentAsk === "completion_result",
				stateInfo: currentState,
				message: currentState.lastMessage,
			}
			this.emitter.emit("taskCompleted", completedEvent)
		}
	}

	/**
	 * Emit events for new messages.
	 *
	 * We compare the previous and current message counts to find new messages.
	 * This is a simple heuristic - for more accuracy, we'd track by timestamp.
	 */
	private emitNewMessageEvents(
		_previousState: AgentStateInfo,
		_currentState: AgentStateInfo,
		messages: ClineMessage[],
	): void {
		// For now, just emit the last message as new
		// A more sophisticated implementation would track seen message timestamps
		const lastMessage = messages[messages.length - 1]
		if (lastMessage) {
			this.emitter.emit("message", lastMessage)
		}
	}

	// ===========================================================================
	// Utility Methods
	// ===========================================================================

	/**
	 * Manually trigger a task cleared event.
	 * Call this when you send a clearTask message to the extension.
	 */
	notifyTaskCleared(): void {
		this.store.clear()
		this.emitter.emit("taskCleared", undefined as void)
	}

	/**
	 * Enable or disable debug logging.
	 */
	setDebug(enabled: boolean): void {
		this.options.debug = enabled
	}
}

// =============================================================================
// Message Validation Helpers
// =============================================================================

/**
 * Check if a message is a valid ClineMessage.
 * Useful for validating messages before processing.
 */
export function isValidClineMessage(message: unknown): message is ClineMessage {
	if (!message || typeof message !== "object") {
		return false
	}

	const msg = message as Record<string, unknown>

	// Required fields
	if (typeof msg.ts !== "number") {
		return false
	}

	if (msg.type !== "ask" && msg.type !== "say") {
		return false
	}

	return true
}

/**
 * Check if a message is a valid ExtensionMessage.
 */
export function isValidExtensionMessage(message: unknown): message is ExtensionMessage {
	if (!message || typeof message !== "object") {
		return false
	}

	const msg = message as Record<string, unknown>

	// Must have a type
	if (typeof msg.type !== "string") {
		return false
	}

	return true
}

// =============================================================================
// Message Parsing Utilities
// =============================================================================

/**
 * Parse a JSON string into an ExtensionMessage.
 * Returns undefined if parsing fails.
 */
export function parseExtensionMessage(json: string): ExtensionMessage | undefined {
	try {
		const parsed = JSON.parse(json)
		if (isValidExtensionMessage(parsed)) {
			return parsed
		}
		return undefined
	} catch {
		return undefined
	}
}

/**
 * Parse the text field of an api_req_started message.
 * Returns undefined if parsing fails or text is not present.
 */
export function parseApiReqStartedText(message: ClineMessage): { cost?: number } | undefined {
	if (message.say !== "api_req_started" || !message.text) {
		return undefined
	}

	try {
		return JSON.parse(message.text)
	} catch {
		return undefined
	}
}
