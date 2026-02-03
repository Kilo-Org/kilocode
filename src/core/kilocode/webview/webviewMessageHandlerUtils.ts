import * as vscode from "vscode"
import pWaitFor from "p-wait-for"
import { ClineProvider } from "../../webview/ClineProvider"
import { t } from "../../../i18n"
import { WebviewMessage } from "../../../shared/WebviewMessage"
import { Task } from "../../task/Task"
import axios from "axios"
import { getKiloUrlFromToken } from "@roo-code/types"
import { buildApiHandler } from "../../../api"
import { ContextProxy } from "../../config/ContextProxy"

const shownNativeNotificationIds = new Set<string>()

/**
 * Replaces vscode:// protocol in URLs with the appropriate protocol for the current IDE.
 * For example, in Cursor it becomes cursor://, in VSCodium it becomes vscodium://, etc.
 * @param url The URL to transform
 * @returns The URL with the appropriate protocol for the current IDE
 */
export function replaceVscodeProtocol(url: string): string {
	if (!url.startsWith("vscode://")) {
		return url
	}
	const currentScheme = vscode.env.uriScheme
	return url.replace(/^vscode:\/\//, `${currentScheme}://`)
}

interface KilocodeNotification {
	id: string
	title: string
	message: string
	showIn?: string[]
	action?: {
		actionText: string
		actionURL: string
	}
}

interface FetchNotificationsResult {
	notifications: KilocodeNotification[]
	nativeNotifications: KilocodeNotification[]
}

/**
 * Core function to fetch Kilocode notifications from the API
 * Can be used both from webview handler and standalone startup
 */
export async function fetchKilocodeNotificationsCore(
	kilocodeToken: string,
	dismissedNotificationIds: string[] = [],
	kilocodeTesterWarningsDisabledUntil?: number,
	log?: (message: string) => void,
): Promise<FetchNotificationsResult> {
	const headers: Record<string, string> = {
		Authorization: `Bearer ${kilocodeToken}`,
		"Content-Type": "application/json",
	}

	// Add X-KILOCODE-TESTER: SUPPRESS header if the setting is enabled
	if (kilocodeTesterWarningsDisabledUntil && kilocodeTesterWarningsDisabledUntil > Date.now()) {
		headers["X-KILOCODE-TESTER"] = "SUPPRESS"
	}

	const url = getKiloUrlFromToken("https://api.kilo.ai/api/users/notifications", kilocodeToken)
	const response = await axios.get(url, {
		headers,
		timeout: 5000,
	})

	const notifications: KilocodeNotification[] = response.data?.notifications || []

	// Filter notifications for native display (not dismissed and not already shown)
	const nativeNotifications = notifications.filter(
		(notification) =>
			!dismissedNotificationIds.includes(notification.id) &&
			!shownNativeNotificationIds.has(notification.id) &&
			(notification.showIn ?? []).includes("extension-native"),
	)

	// Filter notifications for webview display
	const webviewNotifications = notifications.filter(({ showIn }) => !showIn || showIn.includes("extension"))

	return {
		notifications: webviewNotifications,
		nativeNotifications,
	}
}

/**
 * Display native VSCode notifications for Kilocode notifications
 */
export async function displayNativeNotifications(
	notifications: KilocodeNotification[],
	log?: (message: string) => void,
): Promise<void> {
	for (const notification of notifications) {
		try {
			const message = `${notification.title}: ${notification.message}`
			const actionButton = notification.action?.actionText
			const selection = await vscode.window.showInformationMessage(
				message,
				...(actionButton ? [actionButton] : []),
			)
			if (selection === actionButton) {
				if (notification.action?.actionURL) {
					// Replace vscode:// protocol with the appropriate protocol for the current IDE
					const actionUrl = replaceVscodeProtocol(notification.action.actionURL)
					await vscode.env.openExternal(vscode.Uri.parse(actionUrl))
				}
			}

			shownNativeNotificationIds.add(notification.id)
		} catch (error: any) {
			log?.(`Error displaying notification ${notification.id}: ${error.message}`)
		}
	}
}

/**
 * Fetch and display Kilocode notifications on extension startup
 * This function works without requiring the webview to be open
 */
export async function fetchKilocodeNotificationsOnStartup(
	contextProxy: ContextProxy,
	log?: (message: string) => void,
): Promise<void> {
	try {
		const apiConfiguration = contextProxy.getProviderSettings()
		const dismissedNotificationIds = contextProxy.getValue("dismissedNotificationIds") || []
		const kilocodeToken = apiConfiguration?.kilocodeToken

		if (!kilocodeToken || apiConfiguration?.apiProvider !== "kilocode") {
			log?.("[Notifications] Skipping notification fetch: not using kilocode provider")
			return
		}

		log?.("[Notifications] Fetching notifications on startup...")

		const { nativeNotifications } = await fetchKilocodeNotificationsCore(
			kilocodeToken,
			dismissedNotificationIds,
			apiConfiguration.kilocodeTesterWarningsDisabledUntil,
			log,
		)

		if (nativeNotifications.length > 0) {
			log?.(`[Notifications] Displaying ${nativeNotifications.length} native notification(s)`)
			await displayNativeNotifications(nativeNotifications, log)
		} else {
			log?.("[Notifications] No new notifications to display")
		}
	} catch (error: any) {
		log?.(`[Notifications] Error fetching notifications on startup: ${error.message}`)
	}
}

// Helper function to delete messages for resending
const deleteMessagesForResend = async (cline: Task, originalMessageIndex: number, originalMessageTs: number) => {
	// Delete UI messages after the edited message
	const newClineMessages = cline.clineMessages.slice(0, originalMessageIndex)
	await cline.overwriteClineMessages(newClineMessages)

	// Delete API messages after the edited message
	const apiHistory = [...cline.apiConversationHistory]
	const timeCutoff = originalMessageTs - 1000
	const apiHistoryIndex = apiHistory.findIndex((entry) => entry.ts && entry.ts >= timeCutoff)

	if (apiHistoryIndex !== -1) {
		const newApiHistory = apiHistory.slice(0, apiHistoryIndex)
		await cline.overwriteApiConversationHistory(newApiHistory)
	}
}

// Helper function to encapsulate the common sequence of actions for resending a message
const resendMessageSequence = async (
	provider: ClineProvider,
	taskId: string,
	originalMessageIndex: number,
	originalMessageTimestamp: number,
	editedText: string,
	images?: string[],
): Promise<boolean> => {
	// 1. Get the current cline instance before deletion
	const currentCline = provider.getCurrentTask()
	if (!currentCline || currentCline.taskId !== taskId) {
		provider.log(`[Edit Message] Error: Could not get current cline instance before deletion for task ${taskId}.`)
		vscode.window.showErrorMessage(t("kilocode:userFeedback.message_update_failed"))
		return false
	}

	// 2. Delete messages using the helper
	await deleteMessagesForResend(currentCline, originalMessageIndex, originalMessageTimestamp)
	await provider.postStateToWebview()

	// 3. Re-initialize Cline with the history item (which now reflects the deleted messages)
	const { historyItem } = await provider.getTaskWithId(taskId)
	if (!historyItem) {
		provider.log(`[Edit Message] Error: Failed to retrieve history item for task ${taskId}.`)
		vscode.window.showErrorMessage(t("kilocode:userFeedback.message_update_failed"))
		return false
	}

	const newCline = await provider.createTaskWithHistoryItem(historyItem)
	if (!newCline) {
		provider.log(
			`[Edit Message] Error: Failed to re-initialize Cline with updated history item for task ${taskId}.`,
		)
		vscode.window.showErrorMessage(t("kilocode:userFeedback.message_update_failed"))
		return false
	}

	// 4. Send the edited message using the newly initialized Cline instance
	await new Promise((resolve) => setTimeout(resolve, 100)) // Add delay to mitigate race condition
	await newCline.handleWebviewAskResponse("messageResponse", editedText, images)

	return true
}

export const fetchKilocodeNotificationsHandler = async (provider: ClineProvider) => {
	try {
		const { apiConfiguration, dismissedNotificationIds } = await provider.getState()
		const kilocodeToken = apiConfiguration?.kilocodeToken

		if (!kilocodeToken || apiConfiguration?.apiProvider !== "kilocode") {
			provider.postMessageToWebview({
				type: "kilocodeNotificationsResponse",
				notifications: [],
			})
			return
		}

		const { notifications, nativeNotifications } = await fetchKilocodeNotificationsCore(
			kilocodeToken,
			dismissedNotificationIds || [],
			apiConfiguration.kilocodeTesterWarningsDisabledUntil,
			provider.log.bind(provider),
		)

		provider.postMessageToWebview({
			type: "kilocodeNotificationsResponse",
			notifications,
		})

		await displayNativeNotifications(nativeNotifications, provider.log.bind(provider))
	} catch (error: any) {
		provider.log(`Error fetching Kilocode notifications: ${error.message}`)
		provider.postMessageToWebview({
			type: "kilocodeNotificationsResponse",
			notifications: [],
		})
	}
}

export const editMessageHandler = async (provider: ClineProvider, message: WebviewMessage) => {
	if (!message.values?.ts || !message.values?.text) {
		return
	}
	const timestamp = message.values.ts
	const newText = message.values.text
	const revert = message.values.revert || false
	const images = message.values.images

	const currentCline = provider.getCurrentTask()
	if (!currentCline) {
		provider.log("[Edit Message] Error: No active Cline instance found.")
		return
	}

	try {
		// Find message by timestamp
		const messageIndex = currentCline.clineMessages.findIndex((msg) => msg.ts && msg.ts === timestamp)

		if (messageIndex === -1) {
			provider.log(`[Edit Message] Error: Message with timestamp ${timestamp} not found.`)
			return
		}

		if (revert) {
			// Find the most recent checkpoint before this message
			const checkpointMessage = currentCline.clineMessages
				.filter((msg) => msg.say === "checkpoint_saved")
				.filter((msg) => msg.ts && msg.ts <= timestamp)
				.sort((a, b) => (b.ts || 0) - (a.ts || 0))[0]

			if (checkpointMessage && checkpointMessage.text) {
				// Restore git shadow
				await provider.cancelTask()

				try {
					await pWaitFor(() => currentCline.isInitialized === true, { timeout: 3_000 })
				} catch (error) {
					vscode.window.showErrorMessage(t("common:errors.checkpoint_timeout"))
				}

				try {
					await currentCline.checkpointRestore({
						commitHash: checkpointMessage.text,
						ts: checkpointMessage.ts,
						mode: "preview",
					})
				} catch (error) {
					vscode.window.showErrorMessage(t("common:errors.checkpoint_failed"))
				}

				// Add delay to mitigate race condition
				await new Promise((resolve) => setTimeout(resolve, 500))
			} else {
				// No checkpoint found before this message
				provider.log(`[Edit Message] No checkpoint found before message timestamp ${timestamp}.`)
				vscode.window.showErrorMessage(t("kilocode:userFeedback.no_checkpoint_found"))
			}
		}
		// Update the message text in the UI
		const updatedMessages = [...currentCline.clineMessages]
		updatedMessages[messageIndex] = {
			...updatedMessages[messageIndex],
			text: newText,
		}
		await currentCline.overwriteClineMessages(updatedMessages)

		// Regular edit without revert - use the resend sequence
		provider.log(`[Edit Message] Performing regular edit without revert for message at timestamp ${timestamp}.`)
		const success = await resendMessageSequence(
			provider,
			currentCline.taskId,
			messageIndex,
			timestamp,
			newText,
			images,
		)

		if (success) {
			vscode.window.showInformationMessage(t("kilocode:userFeedback.message_updated"))
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		provider.log(`[Edit Message] Error handling editMessage: ${errorMessage}`)
		vscode.window.showErrorMessage(t("kilocode:userFeedback.message_update_failed"))
	}
	return
}

/**
 * Handles device authentication webview messages
 * Supports: startDeviceAuth, cancelDeviceAuth, deviceAuthCompleteWithProfile
 */
export const deviceAuthMessageHandler = async (provider: ClineProvider, message: WebviewMessage): Promise<boolean> => {
	switch (message.type) {
		case "startDeviceAuth": {
			await provider.startDeviceAuth()
			return true
		}
		case "cancelDeviceAuth": {
			provider.cancelDeviceAuth()
			return true
		}
		case "deviceAuthCompleteWithProfile": {
			// Save token to specific profile or current profile if no profile name provided
			if (message.values?.token) {
				const profileName = message.text || undefined // Empty string becomes undefined
				const token = message.values.token as string
				try {
					if (profileName) {
						// Save to specified profile and activate it
						const { ...profileConfig } = await provider.providerSettingsManager.getProfile({
							name: profileName,
						})
						await provider.upsertProviderProfile(
							profileName,
							{
								...profileConfig,
								apiProvider: "kilocode",
								kilocodeToken: token,
							},
							true, // Activate immediately to match old handleKiloCodeCallback behavior
						)
					} else {
						// Save to current profile (from welcome screen) and activate
						const { apiConfiguration, currentApiConfigName = "default" } = await provider.getState()
						await provider.upsertProviderProfile(currentApiConfigName, {
							...apiConfiguration,
							apiProvider: "kilocode",
							kilocodeToken: token,
						}) // activate: true by default
					}

					// Update current task's API handler if exists (matching old implementation)
					if (provider.getCurrentTask()) {
						provider.getCurrentTask()!.api = buildApiHandler({
							apiProvider: "kilocode",
							kilocodeToken: token,
						})
					}
				} catch (error) {
					provider.log(
						`Error saving device auth token: ${error instanceof Error ? error.message : String(error)}`,
					)
				}
			}
			return true
		}
		default:
			return false
	}
}
