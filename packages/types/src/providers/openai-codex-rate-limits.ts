/**
 * OpenAI Codex usage/rate limit information (ChatGPT subscription)
 */
export interface OpenAiCodexRateLimitInfo {
	primary?: {
		/** Used percent in 0–100 */
		usedPercent: number
		/** Window length in minutes, when provided */
		windowMinutes?: number
		/** Reset time (unix ms since epoch), when provided */
		resetsAt?: number
	}
	secondary?: {
		/** Used percent in 0–100 */
		usedPercent: number
		/** Window length in minutes, when provided */
		windowMinutes?: number
		/** Reset time (unix ms since epoch), when provided */
		resetsAt?: number
	}
	credits?: {
		hasCredits: boolean
		unlimited: boolean
		balance?: string
	}
	planType?: string
	/** Timestamp when this was fetched (unix ms since epoch) */
	fetchedAt: number
}
