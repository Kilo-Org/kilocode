export type UsageType = "tokens" | "requests"
export type UsageWindow = "minute" | "hour" | "day"

export interface UsageEvent {
	/** The timestamp of the event in milliseconds since epoch. */
	timestamp: number
	/** The identifier for the AI provider (e.g., 'ds8f93js'). */
	providerId: string
	/** The type of usage. */
	type: UsageType
	/** The amount consumed (e.g., number of tokens or 1 for a single request). */
	count: number
}

export interface UsageResult {
	tokens: number
	requests: number
}

export interface UsageResultByDuration {
	minute: UsageResult
	hour: UsageResult
	day: UsageResult
}
