/**
 * Event System for Component Communication
 *
 * Centralized event system for communication between diff system components
 */

import { DiffEvent, FileChangeEvent } from "../types/diff-types"
import { SessionEvent } from "../types/session-types"

type EventListener<T = any> = (event: T) => void

/**
 * Central event emitter for diff system components
 */
export class EventEmitter {
	private static listeners: Map<string, Set<EventListener<any>>> = new Map()

	/**
	 * Register event listener
	 */
	static on<T = any>(eventType: string, listener: EventListener<T>): () => void {
		if (!EventEmitter.listeners.has(eventType)) {
			EventEmitter.listeners.set(eventType, new Set())
		}

		EventEmitter.listeners.get(eventType)!.add(listener)

		// Return unsubscribe function
		return () => {
			const listeners = EventEmitter.listeners.get(eventType)
			if (listeners) {
				listeners.delete(listener)
				if (listeners.size === 0) {
					EventEmitter.listeners.delete(eventType)
				}
			}
		}
	}

	/**
	 * Register one-time event listener
	 */
	static once<T = any>(eventType: string, listener: EventListener<T>): () => void {
		const unsubscribe = EventEmitter.on(eventType, (event) => {
			listener(event)
			unsubscribe()
		})

		return unsubscribe
	}

	/**
	 * Emit event to all listeners
	 */
	static emit<T = any>(eventType: string, event: T): void {
		const listeners = EventEmitter.listeners.get(eventType)
		if (listeners) {
			listeners.forEach((listener) => {
				try {
					listener(event)
				} catch (error) {
					console.error(`Error in event listener for ${eventType}:`, error)
				}
			})
		}
	}

	/**
	 * Remove all listeners for event type
	 */
	static off(eventType: string): void {
		EventEmitter.listeners.delete(eventType)
	}

	/**
	 * Remove all event listeners
	 */
	static clear(): void {
		EventEmitter.listeners.clear()
	}

	/**
	 * Get listener count for event type
	 */
	static listenerCount(eventType: string): number {
		return EventEmitter.listeners.get(eventType)?.size || 0
	}

	/**
	 * Get all registered event types
	 */
	static eventTypes(): string[] {
		return Array.from(EventEmitter.listeners.keys())
	}
}

/**
 * Diff system specific event types
 */
export class DiffSystemEvents {
	// Diff events
	static readonly DIFF_CREATED = "diff_created"
	static readonly DIFF_ACCEPTED = "diff_accepted"
	static readonly DIFF_REJECTED = "diff_rejected"
	static readonly DIFF_UPDATED = "diff_updated"

	// File events
	static readonly FILE_OPENED = "file_opened"
	static readonly FILE_CLOSED = "file_closed"
	static readonly FILE_MODIFIED = "file_modified"
	static readonly FILE_SAVED = "file_saved"

	// Session events
	static readonly SESSION_CREATED = "session_created"
	static readonly SESSION_UPDATED = "session_updated"
	static readonly SESSION_CLEARED = "session_cleared"

	// UI events
	static readonly UI_REFRESH_NEEDED = "ui_refresh_needed"
	static readonly OVERLAY_STATE_CHANGED = "overlay_state_changed"
}

/**
 * Event manager for diff system with type safety
 */
export class DiffEventManager {
	/**
	 * Listen to diff events
	 */
	static onDiffCreated(listener: EventListener<DiffEvent>): () => void {
		return EventEmitter.on(DiffSystemEvents.DIFF_CREATED, listener)
	}

	static onDiffAccepted(listener: EventListener<DiffEvent>): () => void {
		return EventEmitter.on(DiffSystemEvents.DIFF_ACCEPTED, listener)
	}

	static onDiffRejected(listener: EventListener<DiffEvent>): () => void {
		return EventEmitter.on(DiffSystemEvents.DIFF_REJECTED, listener)
	}

	/**
	 * Listen to file events
	 */
	static onFileOpened(listener: EventListener<FileChangeEvent>): () => void {
		return EventEmitter.on(DiffSystemEvents.FILE_OPENED, listener)
	}

	static onFileClosed(listener: EventListener<FileChangeEvent>): () => void {
		return EventEmitter.on(DiffSystemEvents.FILE_CLOSED, listener)
	}

	static onFileModified(listener: EventListener<FileChangeEvent>): () => void {
		return EventEmitter.on(DiffSystemEvents.FILE_MODIFIED, listener)
	}

	static onFileSaved(listener: EventListener<FileChangeEvent>): () => void {
		return EventEmitter.on(DiffSystemEvents.FILE_SAVED, listener)
	}

	/**
	 * Listen to session events
	 */
	static onSessionCreated(listener: EventListener<SessionEvent>): () => void {
		return EventEmitter.on(DiffSystemEvents.SESSION_CREATED, listener)
	}

	static onSessionUpdated(listener: EventListener<SessionEvent>): () => void {
		return EventEmitter.on(DiffSystemEvents.SESSION_UPDATED, listener)
	}

	static onSessionCleared(listener: EventListener<SessionEvent>): () => void {
		return EventEmitter.on(DiffSystemEvents.SESSION_CLEARED, listener)
	}

	/**
	 * Listen to UI events
	 */
	static onUiRefreshNeeded(listener: EventListener<{ reason: string }>): () => void {
		return EventEmitter.on(DiffSystemEvents.UI_REFRESH_NEEDED, listener)
	}

	static onOverlayStateChanged(listener: EventListener<{ fileBufferId: string; state: string }>): () => void {
		return EventEmitter.on(DiffSystemEvents.OVERLAY_STATE_CHANGED, listener)
	}

	/**
	 * Emit diff events
	 */
	static emitDiffCreated(event: Omit<DiffEvent, "type">): void {
		EventEmitter.emit(DiffSystemEvents.DIFF_CREATED, { ...event, type: DiffSystemEvents.DIFF_CREATED })
	}

	static emitDiffAccepted(event: Omit<DiffEvent, "type">): void {
		EventEmitter.emit(DiffSystemEvents.DIFF_ACCEPTED, { ...event, type: DiffSystemEvents.DIFF_ACCEPTED })
	}

	static emitDiffRejected(event: Omit<DiffEvent, "type">): void {
		EventEmitter.emit(DiffSystemEvents.DIFF_REJECTED, { ...event, type: DiffSystemEvents.DIFF_REJECTED })
	}

	/**
	 * Emit file events
	 */
	static emitFileOpened(event: Omit<FileChangeEvent, "type">): void {
		EventEmitter.emit(DiffSystemEvents.FILE_OPENED, { ...event, type: DiffSystemEvents.FILE_OPENED })
	}

	static emitFileClosed(event: Omit<FileChangeEvent, "type">): void {
		EventEmitter.emit(DiffSystemEvents.FILE_CLOSED, { ...event, type: DiffSystemEvents.FILE_CLOSED })
	}

	static emitFileModified(event: Omit<FileChangeEvent, "type">): void {
		EventEmitter.emit(DiffSystemEvents.FILE_MODIFIED, { ...event, type: DiffSystemEvents.FILE_MODIFIED })
	}

	static emitFileSaved(event: Omit<FileChangeEvent, "type">): void {
		EventEmitter.emit(DiffSystemEvents.FILE_SAVED, { ...event, type: DiffSystemEvents.FILE_SAVED })
	}

	/**
	 * Emit session events
	 */
	static emitSessionCreated(event: Omit<SessionEvent, "type">): void {
		EventEmitter.emit(DiffSystemEvents.SESSION_CREATED, { ...event, type: DiffSystemEvents.SESSION_CREATED })
	}

	static emitSessionUpdated(event: Omit<SessionEvent, "type">): void {
		EventEmitter.emit(DiffSystemEvents.SESSION_UPDATED, { ...event, type: DiffSystemEvents.SESSION_UPDATED })
	}

	static emitSessionCleared(event: Omit<SessionEvent, "type">): void {
		EventEmitter.emit(DiffSystemEvents.SESSION_CLEARED, { ...event, type: DiffSystemEvents.SESSION_CLEARED })
	}

	/**
	 * Emit UI events
	 */
	static emitUiRefreshNeeded(reason: string): void {
		EventEmitter.emit(DiffSystemEvents.UI_REFRESH_NEEDED, { reason, type: DiffSystemEvents.UI_REFRESH_NEEDED })
	}

	static emitOverlayStateChanged(fileBufferId: string, state: string): void {
		EventEmitter.emit(DiffSystemEvents.OVERLAY_STATE_CHANGED, {
			fileBufferId,
			state,
			type: DiffSystemEvents.OVERLAY_STATE_CHANGED,
		})
	}

	/**
	 * Clear all event listeners
	 */
	static clearAll(): void {
		EventEmitter.clear()
	}

	/**
	 * Get event statistics
	 */
	static getStats(): { totalEventTypes: number; totalListeners: number; eventTypeStats: Record<string, number> } {
		const eventTypes = EventEmitter.eventTypes()
		const totalListeners = eventTypes.reduce((sum, type) => sum + EventEmitter.listenerCount(type), 0)

		const eventTypeStats: Record<string, number> = {}
		eventTypes.forEach((type) => {
			eventTypeStats[type] = EventEmitter.listenerCount(type)
		})

		return {
			totalEventTypes: eventTypes.length,
			totalListeners,
			eventTypeStats,
		}
	}
}
