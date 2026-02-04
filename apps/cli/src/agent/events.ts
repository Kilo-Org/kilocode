/**
 * Event System for Agent State Changes
 *
 * This module provides a strongly-typed event emitter specifically designed
 * for tracking agent state changes. It uses Node.js EventEmitter under the hood
 * but provides type safety for all events.
 */

import { EventEmitter } from "events"

import { ClineMessage, ClineAsk } from "@roo-code/types"

import type { AgentStateInfo } from "./agent-state.js"

// =============================================================================
// Event Types
// =============================================================================

/**
 * All events that can be emitted by the client.
 *
 * Design note: We use a string literal union type for event names to ensure
 * type safety when subscribing to events. The payload type is determined by
 * the event name.
 */
export interface ClientEventMap {
	/**
	 * Emitted whenever the agent state changes.
	 * This is the primary event for tracking state.
	 */
	stateChange: AgentStateChangeEvent

	/**
	 * Emitted when a new message is added to the message list.
	 */
	message: ClineMessage

	/**
	 * Emitted when an existing message is updated (e.g., partial -> complete).
	 */
	messageUpdated: ClineMessage

	/**
	 * Emitted when the agent starts waiting for user input.
	 * Convenience event - you can also use stateChange.
	 */
	waitingForInput: WaitingForInputEvent

	/**
	 * Emitted when the agent stops waiting and resumes running.
	 */
	resumedRunning: void

	/**
	 * Emitted when the agent starts streaming content.
	 */
	streamingStarted: void

	/**
	 * Emitted when streaming ends.
	 */
	streamingEnded: void

	/**
	 * Emitted when a task completes (either successfully or with error).
	 */
	taskCompleted: TaskCompletedEvent

	/**
	 * Emitted when a task is cleared/cancelled.
	 */
	taskCleared: void

	/**
	 * Emitted when the current mode changes.
	 */
	modeChanged: ModeChangedEvent

	/**
	 * Emitted on any error during message processing.
	 */
	error: Error
}

/**
 * Event payload for state changes.
 */
export interface AgentStateChangeEvent {
	/** The previous state info */
	previousState: AgentStateInfo
	/** The new/current state info */
	currentState: AgentStateInfo
	/** Whether this is a significant state transition (state enum changed) */
	isSignificantChange: boolean
}

/**
 * Event payload when agent starts waiting for input.
 */
export interface WaitingForInputEvent {
	/** The specific ask type */
	ask: ClineAsk
	/** Full state info for context */
	stateInfo: AgentStateInfo
	/** The message that triggered this wait */
	message: ClineMessage
}

/**
 * Event payload when a task completes.
 */
export interface TaskCompletedEvent {
	/** Whether the task completed successfully */
	success: boolean
	/** The final state info */
	stateInfo: AgentStateInfo
	/** The completion message if available */
	message?: ClineMessage
}

/**
 * Event payload when mode changes.
 */
export interface ModeChangedEvent {
	/** The previous mode (undefined if first mode set) */
	previousMode: string | undefined
	/** The new/current mode */
	currentMode: string
}

// =============================================================================
// Typed Event Emitter
// =============================================================================

/**
 * Type-safe event emitter for client events.
 *
 * Usage:
 * ```typescript
 * const emitter = new TypedEventEmitter()
 *
 * // Type-safe subscription
 * emitter.on('stateChange', (event) => {
 *   console.log(event.currentState) // TypeScript knows this is AgentStateChangeEvent
 * })
 *
 * // Type-safe emission
 * emitter.emit('stateChange', { previousState, currentState, isSignificantChange })
 * ```
 */
export class TypedEventEmitter {
	private emitter = new EventEmitter()

	/**
	 * Subscribe to an event.
	 *
	 * @param event - The event name
	 * @param listener - The callback function
	 * @returns Function to unsubscribe
	 */
	on<K extends keyof ClientEventMap>(event: K, listener: (payload: ClientEventMap[K]) => void): () => void {
		this.emitter.on(event, listener)
		return () => this.emitter.off(event, listener)
	}

	/**
	 * Subscribe to an event, but only once.
	 *
	 * @param event - The event name
	 * @param listener - The callback function
	 */
	once<K extends keyof ClientEventMap>(event: K, listener: (payload: ClientEventMap[K]) => void): void {
		this.emitter.once(event, listener)
	}

	/**
	 * Unsubscribe from an event.
	 *
	 * @param event - The event name
	 * @param listener - The callback function to remove
	 */
	off<K extends keyof ClientEventMap>(event: K, listener: (payload: ClientEventMap[K]) => void): void {
		this.emitter.off(event, listener)
	}

	/**
	 * Emit an event.
	 *
	 * @param event - The event name
	 * @param payload - The event payload
	 */
	emit<K extends keyof ClientEventMap>(event: K, payload: ClientEventMap[K]): void {
		this.emitter.emit(event, payload)
	}

	/**
	 * Remove all listeners for an event, or all events.
	 *
	 * @param event - Optional event name. If not provided, removes all listeners.
	 */
	removeAllListeners<K extends keyof ClientEventMap>(event?: K): void {
		if (event) {
			this.emitter.removeAllListeners(event)
		} else {
			this.emitter.removeAllListeners()
		}
	}

	/**
	 * Get the number of listeners for an event.
	 */
	listenerCount<K extends keyof ClientEventMap>(event: K): number {
		return this.emitter.listenerCount(event)
	}
}

// =============================================================================
// State Change Detector
// =============================================================================

/**
 * Helper to determine if a state change is "significant".
 *
 * A significant change is when the AgentLoopState enum value changes,
 * as opposed to just internal state updates within the same state.
 */
export function isSignificantStateChange(previous: AgentStateInfo, current: AgentStateInfo): boolean {
	return previous.state !== current.state
}

/**
 * Helper to determine if we transitioned to waiting for input.
 */
export function transitionedToWaiting(previous: AgentStateInfo, current: AgentStateInfo): boolean {
	return !previous.isWaitingForInput && current.isWaitingForInput
}

/**
 * Helper to determine if we transitioned from waiting to running.
 */
export function transitionedToRunning(previous: AgentStateInfo, current: AgentStateInfo): boolean {
	return previous.isWaitingForInput && !current.isWaitingForInput && current.isRunning
}

/**
 * Helper to determine if streaming started.
 */
export function streamingStarted(previous: AgentStateInfo, current: AgentStateInfo): boolean {
	return !previous.isStreaming && current.isStreaming
}

/**
 * Helper to determine if streaming ended.
 */
export function streamingEnded(previous: AgentStateInfo, current: AgentStateInfo): boolean {
	return previous.isStreaming && !current.isStreaming
}

/**
 * Helper to determine if task completed.
 */
export function taskCompleted(previous: AgentStateInfo, current: AgentStateInfo): boolean {
	const completionAsks = ["completion_result", "api_req_failed", "mistake_limit_reached"]
	const wasNotComplete = !previous.currentAsk || !completionAsks.includes(previous.currentAsk)
	const isNowComplete = current.currentAsk !== undefined && completionAsks.includes(current.currentAsk)
	return wasNotComplete && isNowComplete
}

// =============================================================================
// Observable Pattern (Alternative API)
// =============================================================================

/**
 * Subscription function type for observable pattern.
 */
export type Observer<T> = (value: T) => void

/**
 * Unsubscribe function type.
 */
export type Unsubscribe = () => void

/**
 * Simple observable for state.
 *
 * This provides an alternative to the event emitter pattern
 * for those who prefer a more functional approach.
 *
 * Usage:
 * ```typescript
 * const stateObservable = new Observable<AgentStateInfo>()
 *
 * const unsubscribe = stateObservable.subscribe((state) => {
 *   console.log('New state:', state)
 * })
 *
 * // Later...
 * unsubscribe()
 * ```
 */
export class Observable<T> {
	private observers: Set<Observer<T>> = new Set()
	private currentValue: T | undefined

	/**
	 * Create an observable with an optional initial value.
	 */
	constructor(initialValue?: T) {
		this.currentValue = initialValue
	}

	/**
	 * Subscribe to value changes.
	 *
	 * @param observer - Function called when value changes
	 * @returns Unsubscribe function
	 */
	subscribe(observer: Observer<T>): Unsubscribe {
		this.observers.add(observer)

		// Immediately emit current value if we have one
		if (this.currentValue !== undefined) {
			observer(this.currentValue)
		}

		return () => {
			this.observers.delete(observer)
		}
	}

	/**
	 * Update the value and notify all subscribers.
	 */
	next(value: T): void {
		this.currentValue = value
		for (const observer of this.observers) {
			try {
				observer(value)
			} catch (error) {
				console.error("Error in observer:", error)
			}
		}
	}

	/**
	 * Get the current value without subscribing.
	 */
	getValue(): T | undefined {
		return this.currentValue
	}

	/**
	 * Check if there are any subscribers.
	 */
	hasSubscribers(): boolean {
		return this.observers.size > 0
	}

	/**
	 * Get the number of subscribers.
	 */
	getSubscriberCount(): number {
		return this.observers.size
	}

	/**
	 * Remove all subscribers.
	 */
	clear(): void {
		this.observers.clear()
	}
}
