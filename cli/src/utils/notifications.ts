import { getApiUrl } from "@roo-code/types"
import { logs } from "../services/logs.js"
import type { KilocodeNotification } from "../state/atoms/notifications.js"
import type { ProviderConfig } from "../config/types.js"
import { generateMessage } from "../ui/utils/messages.js"

/**
 * Response from the Kilocode notifications API
 */
interface NotificationsResponse {
	notifications: KilocodeNotification[]
}

/**
 * Fetch notifications from the Kilocode backend
 *
 * @param provider - The provider configuration (must be a kilocode provider)
 * @returns Array of notifications, or empty array if fetch fails or provider is not kilocode
 */
export async function fetchKilocodeNotifications({
	provider,
	kilocodeToken,
}: ProviderConfig): Promise<KilocodeNotification[]> {
	if (provider !== "kilocode") {
		logs.debug("Provider is not kilocode, skipping notification fetch", "fetchKilocodeNotifications", {
			provider,
		})
		return []
	}

	if (!kilocodeToken || typeof kilocodeToken !== "string") {
		logs.debug("No kilocode token found, skipping notification fetch", "fetchKilocodeNotifications")
		return []
	}

	const url = getApiUrl("/api/users/notifications")

	logs.debug("Fetching Kilocode notifications", "NotificationsUtil", { url })

	const response = await fetch(url, {
		headers: {
			Authorization: `Bearer ${kilocodeToken}`,
			"Content-Type": "application/json",
		},
	})

	if (!response.ok) {
		logs.error("Failed to fetch Kilocode notifications", "NotificationsUtil", {
			status: response.status,
		})
		return []
	}

	const { notifications } = (await response.json()) as NotificationsResponse

	return notifications.filter(({ showIn }) => !showIn || showIn.includes("cli"))
}

/**
 * Check if a provider supports notifications
 *
 * @param provider - The provider configuration
 * @returns true if the provider supports notifications
 */
export function supportsNotifications(provider: ProviderConfig): boolean {
	return provider.provider === "kilocode" && !!provider.kilocodeToken
}

/**
 * Generate a CLI message from a Kilocode notification
 *
 * @param notification - The notification to convert to a CLI message
 * @returns A CLI message object
 */
export function generateNotificationMessage(notification: KilocodeNotification) {
	let content = `## ${notification.title}\n\n${notification.message}`

	if (notification.action) {
		content += `\n\n[${notification.action.actionText}](${notification.action.actionURL})`
	}

	return {
		...generateMessage(),
		type: "system" as const,
		content,
	}
}
