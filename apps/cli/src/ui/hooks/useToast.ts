import { create } from "zustand"
import { useEffect, useCallback, useRef } from "react"

/**
 * Toast message types for different visual styles
 */
export type ToastType = "info" | "success" | "warning" | "error"

/**
 * A single toast message in the queue
 */
export interface Toast {
	id: string
	message: string
	type: ToastType
	/** Duration in milliseconds before auto-dismiss (default: 3000) */
	duration: number
	/** Timestamp when the toast was created */
	createdAt: number
}

/**
 * Toast queue store state
 */
interface ToastState {
	/** Queue of active toasts (FIFO - first one is displayed) */
	toasts: Toast[]
	/** Add a toast to the queue */
	addToast: (message: string, type?: ToastType, duration?: number) => string
	/** Remove a specific toast by ID */
	removeToast: (id: string) => void
	/** Clear all toasts */
	clearToasts: () => void
}

/**
 * Default toast duration in milliseconds
 */
const DEFAULT_DURATION = 3000

/**
 * Generate a unique ID for toasts
 */
let toastIdCounter = 0
function generateToastId(): string {
	return `toast-${Date.now()}-${++toastIdCounter}`
}

/**
 * Zustand store for toast queue management
 */
export const useToastStore = create<ToastState>((set) => ({
	toasts: [],

	addToast: (message: string, type: ToastType = "info", duration: number = DEFAULT_DURATION) => {
		const id = generateToastId()
		const toast: Toast = {
			id,
			message,
			type,
			duration,
			createdAt: Date.now(),
		}

		// Replace any existing toasts - new toast shows immediately
		// This provides better UX as users see the most recent message right away
		set(() => ({
			toasts: [toast],
		}))

		return id
	},

	removeToast: (id: string) => {
		set((state) => ({
			toasts: state.toasts.filter((t) => t.id !== id),
		}))
	},

	clearToasts: () => {
		set({ toasts: [] })
	},
}))

/**
 * Hook for displaying and managing toasts with auto-expiry.
 * Returns the current toast (if any) and utility functions.
 *
 * The hook handles auto-dismissal of toasts after their duration expires.
 */
export function useToast() {
	const { toasts, addToast, removeToast, clearToasts } = useToastStore()

	// Track active timers for cleanup
	const timersRef = useRef<Map<string, NodeJS.Timeout>>(new Map())

	// Get the current toast to display (first in queue)
	const currentToast = toasts.length > 0 ? toasts[0] : null

	// Set up auto-dismissal timer for current toast
	useEffect(() => {
		if (!currentToast) {
			return
		}

		// Check if timer already exists for this toast
		if (timersRef.current.has(currentToast.id)) {
			return
		}

		// Calculate remaining time (accounts for time already elapsed)
		const elapsed = Date.now() - currentToast.createdAt
		const remainingTime = Math.max(0, currentToast.duration - elapsed)

		const timer = setTimeout(() => {
			removeToast(currentToast.id)
			timersRef.current.delete(currentToast.id)
		}, remainingTime)

		timersRef.current.set(currentToast.id, timer)

		return () => {
			// Clean up timer if toast is removed before expiry
			const existingTimer = timersRef.current.get(currentToast.id)
			if (existingTimer) {
				clearTimeout(existingTimer)
				timersRef.current.delete(currentToast.id)
			}
		}
	}, [currentToast?.id, currentToast?.createdAt, currentToast?.duration, removeToast])

	// Cleanup all timers on unmount
	useEffect(() => {
		return () => {
			timersRef.current.forEach((timer) => clearTimeout(timer))
			timersRef.current.clear()
		}
	}, [])

	// Convenience methods for different toast types
	const showToast = useCallback(
		(message: string, type?: ToastType, duration?: number) => {
			return addToast(message, type, duration)
		},
		[addToast],
	)

	const showInfo = useCallback(
		(message: string, duration?: number) => {
			return addToast(message, "info", duration)
		},
		[addToast],
	)

	const showSuccess = useCallback(
		(message: string, duration?: number) => {
			return addToast(message, "success", duration)
		},
		[addToast],
	)

	const showWarning = useCallback(
		(message: string, duration?: number) => {
			return addToast(message, "warning", duration)
		},
		[addToast],
	)

	const showError = useCallback(
		(message: string, duration?: number) => {
			return addToast(message, "error", duration)
		},
		[addToast],
	)

	return {
		/** Current toast being displayed (first in queue) */
		currentToast,
		/** All toasts in the queue */
		toasts,
		/** Generic toast display method */
		showToast,
		/** Show an info toast */
		showInfo,
		/** Show a success toast */
		showSuccess,
		/** Show a warning toast */
		showWarning,
		/** Show an error toast */
		showError,
		/** Remove a specific toast by ID */
		removeToast,
		/** Clear all toasts */
		clearToasts,
	}
}
