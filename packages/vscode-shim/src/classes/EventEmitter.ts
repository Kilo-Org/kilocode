import type { Disposable, Event } from "../types.js"

/**
 * VSCode-compatible EventEmitter implementation
 *
 * Provides a type-safe event emitter that matches VSCode's EventEmitter API.
 * Listeners can subscribe to events and will be notified when events are fired.
 *
 * @example
 * ```typescript
 * const emitter = new EventEmitter<string>()
 *
 * // Subscribe to events
 * const disposable = emitter.event((value) => {
 *   console.log('Event fired:', value)
 * })
 *
 * // Fire an event
 * emitter.fire('Hello, world!')
 *
 * // Clean up
 * disposable.dispose()
 * emitter.dispose()
 * ```
 */
export class EventEmitter<T> {
	readonly #listeners = new Set<(e: T) => void>()

	/**
	 * The event that listeners can subscribe to
	 *
	 * @param listener - The callback function to invoke when the event fires
	 * @param thisArgs - Optional 'this' context for the listener
	 * @param disposables - Optional array to add the disposable to
	 * @returns A disposable to unsubscribe from the event
	 */
	event: Event<T> = (listener: (e: T) => void, thisArgs?: unknown, disposables?: Disposable[]): Disposable => {
		const fn = thisArgs ? listener.bind(thisArgs) : listener
		this.#listeners.add(fn)

		const disposable: Disposable = {
			dispose: () => {
				this.#listeners.delete(fn)
			},
		}

		if (disposables) {
			disposables.push(disposable)
		}

		return disposable
	}

	/**
	 * Fire the event, notifying all subscribers
	 *
	 * Failure of one or more listeners will not fail this function call.
	 * Failed listeners will be caught and ignored to prevent one listener
	 * from breaking others.
	 *
	 * @param data - The event data to pass to listeners
	 */
	fire(data: T): void {
		for (const listener of this.#listeners) {
			try {
				listener(data)
			} catch (error) {
				// Silently ignore listener errors to prevent one failing listener
				// from affecting others. Consumers can add error handling in their listeners.
				console.error("EventEmitter listener error:", error)
			}
		}
	}

	/**
	 * Dispose this event emitter and remove all listeners
	 */
	dispose(): void {
		this.#listeners.clear()
	}

	/**
	 * Get the current number of listeners (useful for debugging)
	 */
	get listenerCount(): number {
		return this.#listeners.size
	}
}
