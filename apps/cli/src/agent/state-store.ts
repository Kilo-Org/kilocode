/**
 * State Store
 *
 * This module manages the client's internal state, including:
 * - The clineMessages array (source of truth for agent state)
 * - The computed agent state info
 * - Any extension state we want to cache
 *
 * The store is designed to be:
 * - Immutable: State updates create new objects, not mutations
 * - Observable: Changes trigger notifications
 * - Queryable: Current state is always accessible
 */

import { ClineMessage, ExtensionState } from "@roo-code/types"

import { detectAgentState, AgentStateInfo, AgentLoopState } from "./agent-state.js"
import { Observable } from "./events.js"

// =============================================================================
// Store State Interface
// =============================================================================

/**
 * The complete state managed by the store.
 */
export interface StoreState {
	/**
	 * The array of messages from the extension.
	 * This is the primary data used to compute agent state.
	 */
	messages: ClineMessage[]

	/**
	 * The computed agent state info.
	 * Updated automatically when messages change.
	 */
	agentState: AgentStateInfo

	/**
	 * Whether we have received any state from the extension.
	 * Useful to distinguish "no task" from "not yet connected".
	 */
	isInitialized: boolean

	/**
	 * The last time state was updated.
	 */
	lastUpdatedAt: number

	/**
	 * The current mode (e.g., "code", "architect", "ask").
	 * Tracked from state messages received from the extension.
	 */
	currentMode: string | undefined

	/**
	 * Optional: Cache of extension state fields we might need.
	 * This is a subset of the full ExtensionState.
	 */
	extensionState?: Partial<ExtensionState>
}

/**
 * Create the initial store state.
 */
function createInitialState(): StoreState {
	return {
		messages: [],
		agentState: detectAgentState([]),
		isInitialized: false,
		lastUpdatedAt: Date.now(),
		currentMode: undefined,
	}
}

// =============================================================================
// State Store Class
// =============================================================================

/**
 * StateStore manages all client state and provides reactive updates.
 *
 * Key features:
 * - Stores the clineMessages array
 * - Automatically computes agent state when messages change
 * - Provides observable pattern for state changes
 * - Tracks state history for debugging (optional)
 *
 * Usage:
 * ```typescript
 * const store = new StateStore()
 *
 * // Subscribe to state changes
 * store.subscribe((state) => {
 *   console.log('New state:', state.agentState.state)
 * })
 *
 * // Update messages
 * store.setMessages(newMessages)
 *
 * // Query current state
 * const currentState = store.getState()
 * ```
 */
export class StateStore {
	private state: StoreState
	private stateObservable: Observable<StoreState>
	private agentStateObservable: Observable<AgentStateInfo>

	/**
	 * Optional: Track state history for debugging.
	 * Set maxHistorySize to enable.
	 */
	private stateHistory: StoreState[] = []
	private maxHistorySize: number

	constructor(options: { maxHistorySize?: number } = {}) {
		this.state = createInitialState()
		this.stateObservable = new Observable<StoreState>(this.state)
		this.agentStateObservable = new Observable<AgentStateInfo>(this.state.agentState)
		this.maxHistorySize = options.maxHistorySize ?? 0
	}

	// ===========================================================================
	// State Queries
	// ===========================================================================

	/**
	 * Get the current complete state.
	 */
	getState(): StoreState {
		return this.state
	}

	/**
	 * Get just the agent state info.
	 * This is a convenience method for the most common query.
	 */
	getAgentState(): AgentStateInfo {
		return this.state.agentState
	}

	/**
	 * Get the current messages array.
	 */
	getMessages(): ClineMessage[] {
		return this.state.messages
	}

	/**
	 * Get the last message, if any.
	 */
	getLastMessage(): ClineMessage | undefined {
		return this.state.messages[this.state.messages.length - 1]
	}

	/**
	 * Check if the store has been initialized with extension state.
	 */
	isInitialized(): boolean {
		return this.state.isInitialized
	}

	/**
	 * Quick check: Is the agent currently waiting for input?
	 */
	isWaitingForInput(): boolean {
		return this.state.agentState.isWaitingForInput
	}

	/**
	 * Quick check: Is the agent currently running?
	 */
	isRunning(): boolean {
		return this.state.agentState.isRunning
	}

	/**
	 * Quick check: Is content currently streaming?
	 */
	isStreaming(): boolean {
		return this.state.agentState.isStreaming
	}

	/**
	 * Get the current agent loop state enum value.
	 */
	getCurrentState(): AgentLoopState {
		return this.state.agentState.state
	}

	/**
	 * Get the current mode (e.g., "code", "architect", "ask").
	 */
	getCurrentMode(): string | undefined {
		return this.state.currentMode
	}

	// ===========================================================================
	// State Updates
	// ===========================================================================

	/**
	 * Set the complete messages array.
	 * This is typically called when receiving a full state update from the extension.
	 *
	 * @param messages - The new messages array
	 * @returns The previous agent state (for comparison)
	 */
	setMessages(messages: ClineMessage[]): AgentStateInfo {
		const previousAgentState = this.state.agentState
		const newAgentState = detectAgentState(messages)

		this.updateState({
			messages,
			agentState: newAgentState,
			isInitialized: true,
			lastUpdatedAt: Date.now(),
			currentMode: this.state.currentMode, // Preserve mode across message updates
		})

		return previousAgentState
	}

	/**
	 * Add a single message to the end of the messages array.
	 * Useful when receiving incremental updates.
	 *
	 * @param message - The message to add
	 * @returns The previous agent state
	 */
	addMessage(message: ClineMessage): AgentStateInfo {
		const newMessages = [...this.state.messages, message]
		return this.setMessages(newMessages)
	}

	/**
	 * Update a message in place (e.g., when partial becomes complete).
	 * Finds the message by timestamp and replaces it.
	 *
	 * @param message - The updated message
	 * @returns The previous agent state, or undefined if message not found
	 */
	updateMessage(message: ClineMessage): AgentStateInfo | undefined {
		const index = this.state.messages.findIndex((m) => m.ts === message.ts)
		if (index === -1) {
			// Message not found, add it instead
			return this.addMessage(message)
		}

		const newMessages = [...this.state.messages]
		newMessages[index] = message
		return this.setMessages(newMessages)
	}

	/**
	 * Clear all messages and reset to initial state.
	 * Called when a task is cleared/cancelled.
	 */
	clear(): void {
		this.updateState({
			messages: [],
			agentState: detectAgentState([]),
			isInitialized: true, // Still initialized, just empty
			lastUpdatedAt: Date.now(),
			currentMode: this.state.currentMode, // Preserve mode when clearing task
			extensionState: undefined,
		})
	}

	/**
	 * Set the current mode.
	 * Called when mode changes are detected from extension state messages.
	 *
	 * @param mode - The new mode value
	 */
	setCurrentMode(mode: string | undefined): void {
		if (this.state.currentMode !== mode) {
			this.updateState({
				...this.state,
				currentMode: mode,
				lastUpdatedAt: Date.now(),
			})
		}
	}

	/**
	 * Reset to completely uninitialized state.
	 * Called on disconnect or reset.
	 */
	reset(): void {
		this.state = createInitialState()
		this.stateHistory = []
		// Don't notify on reset - we're starting fresh
	}

	/**
	 * Update cached extension state.
	 * This stores any additional extension state fields we might need.
	 *
	 * @param extensionState - The extension state to cache
	 */
	setExtensionState(extensionState: Partial<ExtensionState>): void {
		// Extract and store messages if present
		if (extensionState.clineMessages) {
			this.setMessages(extensionState.clineMessages)
		}

		// Store the rest of the extension state
		this.updateState({
			...this.state,
			extensionState: {
				...this.state.extensionState,
				...extensionState,
			},
		})
	}

	// ===========================================================================
	// Subscriptions
	// ===========================================================================

	/**
	 * Subscribe to all state changes.
	 *
	 * @param observer - Callback function receiving the new state
	 * @returns Unsubscribe function
	 */
	subscribe(observer: (state: StoreState) => void): () => void {
		return this.stateObservable.subscribe(observer)
	}

	/**
	 * Subscribe to agent state changes only.
	 * This is more efficient if you only care about agent state.
	 *
	 * @param observer - Callback function receiving the new agent state
	 * @returns Unsubscribe function
	 */
	subscribeToAgentState(observer: (state: AgentStateInfo) => void): () => void {
		return this.agentStateObservable.subscribe(observer)
	}

	// ===========================================================================
	// History (for debugging)
	// ===========================================================================

	/**
	 * Get the state history (if enabled).
	 */
	getHistory(): StoreState[] {
		return [...this.stateHistory]
	}

	/**
	 * Clear the state history.
	 */
	clearHistory(): void {
		this.stateHistory = []
	}

	// ===========================================================================
	// Private Methods
	// ===========================================================================

	/**
	 * Internal method to update state and notify observers.
	 */
	private updateState(newState: StoreState): void {
		// Track history if enabled
		if (this.maxHistorySize > 0) {
			this.stateHistory.push(this.state)
			if (this.stateHistory.length > this.maxHistorySize) {
				this.stateHistory.shift()
			}
		}

		this.state = newState

		// Notify observers
		this.stateObservable.next(this.state)
		this.agentStateObservable.next(this.state.agentState)
	}
}

// =============================================================================
// Singleton Store (optional convenience)
// =============================================================================

let defaultStore: StateStore | null = null

/**
 * Get the default singleton store instance.
 * Useful for simple applications that don't need multiple stores.
 */
export function getDefaultStore(): StateStore {
	if (!defaultStore) {
		defaultStore = new StateStore()
	}

	return defaultStore
}

/**
 * Reset the default store instance.
 * Useful for testing or when you need a fresh start.
 */
export function resetDefaultStore(): void {
	if (defaultStore) {
		defaultStore.reset()
	}

	defaultStore = null
}
