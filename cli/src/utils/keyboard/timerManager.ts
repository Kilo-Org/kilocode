/**
 * Timer management utilities for keyboard event handling
 */

/**
 * Timer manager for handling timeout operations
 */
export class TimerManager {
	private timerId: NodeJS.Timeout | null = null

	/**
	 * Clear the current timer if it exists
	 */
	clear(): void {
		if (this.timerId) {
			clearTimeout(this.timerId)
			this.timerId = null
		}
	}

	/**
	 * Set a new timer, clearing any existing timer first
	 * @param callback Function to call when timer expires
	 * @param delay Delay in milliseconds
	 */
	set(callback: () => void, delay: number): void {
		this.clear()
		this.timerId = setTimeout(callback, delay)
	}

	/**
	 * Check if a timer is currently active
	 */
	isActive(): boolean {
		return this.timerId !== null
	}
}

/**
 * Create a new timer manager instance
 */
export function createTimerManager(): TimerManager {
	return new TimerManager()
}
