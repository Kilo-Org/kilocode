import React, { useEffect, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { vscode } from "@/utils/vscode"
import { telemetryClient } from "@/utils/TelemetryClient"
import { OPENROUTER_DEFAULT_PROVIDER_NAME, TelemetryEventName } from "@roo-code/types"
import { useProviderModels } from "./hooks/useProviderModels"
import { getModelIdKey } from "./hooks/useSelectedModel"

interface NotificationAction {
	actionText: string
	actionURL: string
}

interface Notification {
	id: string
	title: string
	message: string
	action?: NotificationAction
	suggestModelId?: string
}

const USE_MODEL_BUTTON_LABEL = "Try model"

export const KilocodeNotifications: React.FC = () => {
	const { dismissedNotificationIds, currentApiConfigName, apiConfiguration } = useExtensionState()
	const { provider, providerModels, isLoading, isError } = useProviderModels(apiConfiguration)
	const [notifications, setNotifications] = useState<Notification[]>([])
	const filteredNotifications = notifications.filter(
		(notification) => !(dismissedNotificationIds || []).includes(notification.id),
	)
	const [currentIndex, setCurrentIndex] = useState(0)

	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "kilocodeNotificationsResponse") {
				setNotifications(message.notifications || [])
			}
		}

		window.addEventListener("message", handleMessage)

		setCurrentIndex(Math.max(0, Math.min(currentIndex, filteredNotifications.length - 1)))

		return () => {
			window.removeEventListener("message", handleMessage)
		}
	}, [currentIndex, filteredNotifications.length, dismissedNotificationIds])

	useEffect(() => {
		vscode.postMessage({ type: "fetchKilocodeNotifications" })
	}, [])

	const handleAction = (action: NotificationAction) => {
		vscode.postMessage({
			type: "openInBrowser",
			url: action.actionURL,
		})
		telemetryClient.capture(TelemetryEventName.NOTIFICATION_CLICKED, {
			actionText: action.actionText,
			actionURL: action.actionURL,
		})
	}

	const modelIdKey = getModelIdKey({ provider })

	const switchModel = (suggestModelId: string) => {
		vscode.postMessage({
			type: "upsertApiConfiguration",
			text: currentApiConfigName,
			apiConfiguration: {
				...apiConfiguration,
				[modelIdKey]: suggestModelId,
				openRouterSpecificProvider: OPENROUTER_DEFAULT_PROVIDER_NAME,
			},
		})
		telemetryClient.capture(TelemetryEventName.NOTIFICATION_CLICKED, {
			actionText: USE_MODEL_BUTTON_LABEL,
			suggestModelId,
		})
	}

	const goToNext = () => {
		setCurrentIndex((prev) => (prev + 1) % filteredNotifications.length)
	}

	const goToPrevious = () => {
		setCurrentIndex((prev) => (prev - 1 + filteredNotifications.length) % filteredNotifications.length)
	}

	const dismissNotificationId = (id: string) => {
		vscode.postMessage({
			type: "dismissNotificationId",
			notificationId: id,
		})
	}
	const currentNotification = filteredNotifications[currentIndex]

	if (!currentNotification) {
		return null
	}

	const action = currentNotification.action
	const suggestModelId = currentNotification.suggestModelId
	const isReadyToSwitchModels =
		!isLoading &&
		!isError &&
		suggestModelId &&
		suggestModelId in providerModels &&
		currentApiConfigName &&
		apiConfiguration &&
		suggestModelId !== apiConfiguration[modelIdKey]

	return (
		<div className="kilocode-notifications flex flex-col mb-4">
			<div className="bg-vscode-editor-background border border-vscode-panel-border rounded-lg p-3 gap-3">
				<div className="flex items-center justify-between">
					<h3 className="font-medium text-vscode-foreground m-0">{currentNotification.title}</h3>
					<button
						onClick={() => dismissNotificationId(currentNotification.id)}
						className="text-vscode-descriptionForeground hover:text-vscode-foreground p-1 cursor-pointer"
						title="Dismiss notification">
						<span className="codicon codicon-close"></span>
					</button>
				</div>

				<p className="text-vscode-descriptionForeground">{currentNotification.message}</p>

				{(action || isReadyToSwitchModels) && (
					<div className="flex items-center justify-end gap-2">
						{suggestModelId && isReadyToSwitchModels && (
							<VSCodeButton appearance="primary" onClick={() => switchModel(suggestModelId)}>
								{USE_MODEL_BUTTON_LABEL}
							</VSCodeButton>
						)}
						{action && (
							<VSCodeButton appearance="primary" onClick={() => handleAction(action)}>
								{action.actionText}
							</VSCodeButton>
						)}
					</div>
				)}
			</div>
			{filteredNotifications.length > 1 && (
				<div className="flex items-center justify-end pt-2">
					<button
						onClick={goToPrevious}
						className="text-vscode-descriptionForeground hover:text-vscode-foreground p-1 inline-flex items-center cursor-pointer"
						title="Previous notification">
						<span className="codicon codicon-chevron-left"></span>
					</button>
					<span className="text-xs text-vscode-descriptionForeground whitespace-nowrap">
						{currentIndex + 1} / {filteredNotifications.length}
					</span>
					<button
						onClick={goToNext}
						className="text-vscode-descriptionForeground hover:text-vscode-foreground p-1 inline-flex items-center cursor-pointer"
						title="Next notification">
						<span className="codicon codicon-chevron-right"></span>
					</button>
				</div>
			)}
		</div>
	)
}
