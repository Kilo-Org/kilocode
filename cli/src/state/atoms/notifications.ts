import { atom } from "jotai"

/**
 * Notification type matching the backend API response
 */
export interface KilocodeNotification {
	id: string
	title: string
	message: string
	action?: {
		actionText: string
		actionURL: string
	}
	showIn?: string[]
}

/**
 * Core notifications atom - holds the list of notifications
 */
export const notificationsAtom = atom<KilocodeNotification[]>([])

/**
 * Loading state atom for notification fetching
 */
export const notificationsLoadingAtom = atom<boolean>(false)

/**
 * Error state atom for notification fetching
 */
export const notificationsErrorAtom = atom<Error | null>(null)
