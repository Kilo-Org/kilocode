import type { ClineMessage } from "@roo-code/types"

/**
 * Filters out error-containing messages from an array of ClineMessages.
 *
 * This function identifies and removes messages that contain errors, including:
 * - Messages with type "say" and say "error"
 * - Messages with type "say" and say "api_req_started" that contain error information in their JSON
 *
 * @param messages - An array of ClineMessage objects to filter
 * @param excludeErrorMessages - Whether to exclude error messages (default: false)
 * @returns A new array of ClineMessage objects with error messages filtered out
 */
export function filterErrorMessages(messages: ClineMessage[], excludeErrorMessages: boolean = false): ClineMessage[] {
	if (!excludeErrorMessages) {
		return messages
	}

	return messages.filter((message) => {
		// Filter out direct error messages
		if (message.type === "say" && message.say === "error") {
			return false
		}

		// Filter out API request messages that contain error information
		if (message.type === "say" && message.say === "api_req_started" && message.text) {
			try {
				const apiData = JSON.parse(message.text)
				// Check if the API request contains error information
				if (apiData.error || apiData.errorMessage || apiData.status === "error") {
					return false
				}
			} catch (e) {
				// If JSON parsing fails, keep the message as it might not be error-related
			}
		}

		return true
	})
}
