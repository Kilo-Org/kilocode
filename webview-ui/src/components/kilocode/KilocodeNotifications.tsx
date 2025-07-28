import React, { useEffect, useState, useRef } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { vscode } from "@/utils/vscode"

interface NotificationAction {
	actionText: string
	actionURL: string
}

interface Notification {
	id: string
	title: string
	message: string
	action?: NotificationAction
}

interface NotificationsResponse {
	notifications: Notification[]
}

export const KilocodeNotifications: React.FC = () => {
	const { apiConfiguration } = useExtensionState()
	const [notifications, setNotifications] = useState<Notification[]>([])
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [currentIndex, setCurrentIndex] = useState(0)
	const [dismissedNotifications, setDismissedNotifications] = useState<Set<string>>(new Set())
	const messageListenerRef = useRef<((event: MessageEvent) => void) | null>(null)

	// Only fetch if provider is kilocode
	const isKilocodeProvider = apiConfiguration?.apiProvider === "kilocode"

	// Load dismissed IDs from localStorage on mount
	useEffect(() => {
		const activeDismissed = localStorage.getItem("kilocode-dismissed-notifications")
		const dismissedIds = activeDismissed
			? new Set<string>(JSON.parse(activeDismissed) as string[])
			: new Set<string>()
		setDismissedNotifications(dismissedIds)
	}, [])

	// Set up message listener for notifications response
	useEffect(() => {
		// Remove previous listener if it exists
		if (messageListenerRef.current) {
			window.removeEventListener("message", messageListenerRef.current)
		}

		// Create new listener
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "kilocodeNotificationsResponse") {
				// Filter out dismissed notifications
				const activeNotifications = (message.notifications || []).filter(
					(n: Notification) => !dismissedNotifications.has(n.id),
				)
				setNotifications(activeNotifications)
				setLoading(false)
			}
		}

		messageListenerRef.current = handleMessage
		window.addEventListener("message", handleMessage)

		// Cleanup on unmount
		return () => {
			if (messageListenerRef.current) {
				window.removeEventListener("message", messageListenerRef.current)
			}
		}
	}, [dismissedNotifications])

	// Fetch notifications when provider changes
	useEffect(() => {
		if (!isKilocodeProvider) {
			setNotifications([])
			setLoading(false)
			return
		}

		setLoading(true)
		setError(null)

		// Request notifications from backend
		vscode.postMessage({ type: "fetchKilocodeNotifications" })
	}, [isKilocodeProvider])

	const handleDismiss = (notificationId: string) => {
		const newDismissed = new Set(dismissedNotifications)
		newDismissed.add(notificationId)
		setDismissedNotifications(newDismissed)

		// Save to localStorage
		localStorage.setItem("kilocode-dismissed-notifications", JSON.stringify(Array.from(newDismissed)))

		// Remove from current notifications
		setNotifications((prev) => prev.filter((n) => n.id !== notificationId))

		// Adjust current index if needed
		if (currentIndex >= notifications.length - 1) {
			setCurrentIndex(Math.max(0, notifications.length - 2))
		}
	}

	const handleAction = (action: NotificationAction) => {
		window.open(action.actionURL, "_blank")
	}

	const goToNext = () => {
		setCurrentIndex((prev) => (prev + 1) % notifications.length)
	}

	const goToPrevious = () => {
		setCurrentIndex((prev) => (prev - 1 + notifications.length) % notifications.length)
	}

	// Don't render if not Kilocode provider or no notifications
	if (!isKilocodeProvider || loading || error || notifications.length === 0) {
		return null
	}

	const currentNotification = notifications[currentIndex]

	return (
		<div className="kilocode-notifications mx-auto max-w-[600px] mb-4">
			<div className="bg-vscode-editor-background border border-vscode-panel-border rounded-lg p-4">
				{/* Header with navigation */}
				<div className="flex items-center justify-between mb-3">
					<h3 className="text-sm font-medium text-vscode-foreground">{currentNotification.title}</h3>
					<div className="flex items-center gap-2">
						{notifications.length > 1 && (
							<>
								<button
									onClick={goToPrevious}
									className="text-vscode-descriptionForeground hover:text-vscode-foreground p-1"
									title="Previous notification">
									<span className="codicon codicon-chevron-left"></span>
								</button>
								<span className="text-xs text-vscode-descriptionForeground whitespace-nowrap">
									{currentIndex + 1} / {notifications.length}
								</span>
								<button
									onClick={goToNext}
									className="text-vscode-descriptionForeground hover:text-vscode-foreground p-1"
									title="Next notification">
									<span className="codicon codicon-chevron-right"></span>
								</button>
							</>
						)}
						<button
							onClick={() => handleDismiss(currentNotification.id)}
							className="text-vscode-descriptionForeground hover:text-vscode-foreground p-1"
							title="Dismiss notification">
							<span className="codicon codicon-close"></span>
						</button>
					</div>
				</div>

				{/* Message */}
				<p className="text-sm text-vscode-descriptionForeground mb-3">{currentNotification.message}</p>

				{/* Action button */}
				{currentNotification.action && (
					<VSCodeButton
						appearance="primary"
						onClick={() => handleAction(currentNotification.action!)}
						className="text-sm">
						{currentNotification.action.actionText}
					</VSCodeButton>
				)}
			</div>
		</div>
	)
}
