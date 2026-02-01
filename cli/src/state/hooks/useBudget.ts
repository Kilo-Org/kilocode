/**
 * Budget Cost Tracking Hook
 * Integrates budget tracking with existing cost tracking from api_req_started messages
 */

import { useEffect, useRef } from "react"
import { useAtomValue } from "jotai"
import { chatMessagesAtom } from "../atoms/extension.js"
import { getBudgetService } from "../../services/budget/index.js"
import { getTelemetryService } from "../../services/telemetry/index.js"
import { logs } from "../../services/logs.js"

interface ApiRequestData {
	cost?: number
	provider?: string
	model?: string
	tokensIn?: number
	tokensOut?: number
	cacheReadTokens?: number
	cacheWriteTokens?: number
}

/**
 * Hook to track costs and update budget
 * Should be used in the main App component
 */
export function useBudgetCostTracking(): void {
	const messages = useAtomValue(chatMessagesAtom)
	const processedMessageIds = useRef<Set<string>>(new Set())

	useEffect(() => {
		const budgetService = getBudgetService()

		// Skip if budget tracking is disabled
		if (!budgetService.getConfig().enabled) {
			return
		}

		// Process new messages
		for (const message of messages) {
			// Only process api_req_started messages with cost data
			if (message.say === "api_req_started" && message.text) {
				const messageId = message.ts?.toString() || JSON.stringify(message.text)

				// Skip already processed messages
				if (processedMessageIds.current.has(messageId)) {
					continue
				}

				try {
					const data: ApiRequestData = JSON.parse(message.text)

					// Only process if we have cost data
					if (typeof data.cost === "number" && data.cost > 0) {
						// Track cost in budget service
						const warning = budgetService.trackCost({
							cost: data.cost,
							provider: data.provider || "unknown",
							model: data.model || "unknown",
							timestamp: Date.now(),
							inputTokens: data.tokensIn,
							outputTokens: data.tokensOut,
						})

						// Track in telemetry
						getTelemetryService().trackCostUpdate(
							data.cost,
							data.provider || "unknown",
							data.model || "unknown",
						)

						// Track warning if triggered
						if (warning) {
							getTelemetryService().trackBudgetWarning(
								warning.level,
								warning.period,
								warning.spend,
								warning.limit,
							)

							// Log warning for debugging
							logs.info("Budget warning triggered", "useBudgetCostTracking", {
								level: warning.level,
								period: warning.period,
								spend: warning.spend,
								limit: warning.limit,
							})
						}

						// Track if budget exceeded
						const status = budgetService.getStatus()
						if (status.daily.isExceeded || status.weekly.isExceeded || status.monthly.isExceeded) {
							const exceededPeriod = status.daily.isExceeded
								? "daily"
								: status.weekly.isExceeded
									? "weekly"
									: "monthly"
							const periodStatus = status[exceededPeriod]

							getTelemetryService().trackBudgetExceeded(
								exceededPeriod,
								periodStatus.spend,
								periodStatus.limit,
								status.actionAtLimit,
							)
						}

						// Mark message as processed
						processedMessageIds.current.add(messageId)
					}
				} catch {
					// Ignore parse errors
				}
			}
		}
	}, [messages])
}

/**
 * Budget check result
 */
export interface BudgetCheckResult {
	isExceeded: boolean
	action: "warn" | "pause" | "block"
	canProceed: boolean
}

/**
 * Hook to check if budget is exceeded and get action to take
 */
export function useBudgetCheck(): BudgetCheckResult {
	const budgetService = getBudgetService()
	const status = budgetService.getStatus()

	const isExceeded = status.daily.isExceeded || status.weekly.isExceeded || status.monthly.isExceeded
	const action = status.actionAtLimit

	// Determine if user can proceed based on action type
	const canProceed = !isExceeded || action === "warn"

	return { isExceeded, action, canProceed }
}
