/**
 * Hook to calculate total session cost from api_req_started messages
 * Aggregates all API request costs into a single session total
 */

import { useMemo } from "react"
import { useAtomValue } from "jotai"
import { chatMessagesAtom } from "../atoms/extension.js"

export interface SessionCostInfo {
	/** Total cost of all API requests in the session */
	totalCost: number
	/** Number of completed API requests */
	requestCount: number
	/** Whether any cost data is available */
	hasCostData: boolean
}

/**
 * Calculate total session cost from all api_req_started messages
 * Only counts completed requests (those with a cost field)
 */
export function useSessionCost(): SessionCostInfo {
	const messages = useAtomValue(chatMessagesAtom)

	return useMemo(() => {
		let totalCost = 0
		let requestCount = 0

		for (const message of messages) {
			if (message.say === "api_req_started" && message.text) {
				const data = JSON.parse(message.text)
				if (typeof data.cost === "number") {
					totalCost += data.cost
					requestCount++
				}
			}
		}

		return {
			totalCost,
			requestCount,
			hasCostData: requestCount > 0,
		}
	}, [messages])
}

/**
 * Format cost for display
 * @param cost - Cost in dollars
 * @returns Formatted cost string (e.g., "$1.23")
 */
export function formatSessionCost(cost: number): string {
	return `$${cost.toFixed(2)}`
}
