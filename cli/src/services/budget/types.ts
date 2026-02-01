/**
 * Budget Service Types
 * Type definitions for budget tracking and cost warnings
 */

/**
 * Budget period type - daily, weekly, or monthly
 */
export type BudgetPeriod = "daily" | "weekly" | "monthly"

/**
 * Action to take when budget limit is reached
 */
export type BudgetAction = "warn" | "pause" | "block"

/**
 * Budget limit configuration for a specific period
 */
export interface BudgetLimit {
	/** Whether budget tracking is enabled for this period */
	enabled: boolean
	/** Maximum allowed spend in USD */
	limit: number
}

/**
 * Budget configuration
 */
export interface BudgetConfig {
	/** Whether budget tracking is enabled globally */
	enabled: boolean
	/** Daily spend limit */
	daily: BudgetLimit
	/** Weekly spend limit */
	weekly: BudgetLimit
	/** Monthly spend limit */
	monthly: BudgetLimit
	/** Warning thresholds as percentages (0-1) */
	warningThresholds: number[]
	/** Action to take when budget is exceeded */
	actionAtLimit: BudgetAction
}

/**
 * Spend record for a specific period
 */
export interface SpendRecord {
	/** Period start timestamp */
	startTime: number
	/** Period end timestamp */
	endTime: number
	/** Total spend in USD */
	spend: number
	/** Number of API requests */
	requestCount: number
}

/**
 * Budget data persisted to disk
 */
export interface BudgetData {
	/** Version for migration purposes */
	version: string
	/** Last updated timestamp */
	lastUpdated: number
	/** Current day spend record */
	currentDay: SpendRecord
	/** Current week spend record */
	currentWeek: SpendRecord
	/** Current month spend record */
	currentMonth: SpendRecord
	/** Historical spend data (last 30 days) */
	history: HistoricalSpendEntry[]
}

/**
 * Historical spend entry
 */
export interface HistoricalSpendEntry {
	/** Date string in YYYY-MM-DD format */
	date: string
	/** Total spend for the day */
	spend: number
	/** Number of API requests */
	requestCount: number
}

/**
 * Budget status for all periods
 */
export interface BudgetStatus {
	/** Whether budget tracking is enabled */
	enabled: boolean
	/** Daily budget status */
	daily: PeriodBudgetStatus
	/** Weekly budget status */
	weekly: PeriodBudgetStatus
	/** Monthly budget status */
	monthly: PeriodBudgetStatus
	/** Current warning level (highest across all periods) */
	currentWarningLevel: WarningLevel
	/** Action to take when budget is exceeded */
	actionAtLimit: BudgetAction
}

/**
 * Budget status for a specific period
 */
export interface PeriodBudgetStatus {
	/** Whether this period's budget is enabled */
	enabled: boolean
	/** Budget limit in USD */
	limit: number
	/** Current spend in USD */
	spend: number
	/** Percentage of budget used (0-1) */
	percentage: number
	/** Remaining budget in USD */
	remaining: number
	/** Whether the budget is exceeded */
	isExceeded: boolean
	/** Warning level for this period */
	warningLevel: WarningLevel
}

/**
 * Warning level based on budget usage
 */
export type WarningLevel = "none" | "low" | "medium" | "high" | "critical"

/**
 * Budget warning event
 */
export interface BudgetWarning {
	/** Warning level */
	level: WarningLevel
	/** Period that triggered the warning */
	period: BudgetPeriod
	/** Current spend */
	spend: number
	/** Budget limit */
	limit: number
	/** Percentage used */
	percentage: number
	/** Message to display to the user */
	message: string
}

/**
 * Cost tracking event from API request
 */
export interface CostEvent {
	/** Cost in USD */
	cost: number
	/** Provider name */
	provider: string
	/** Model name */
	model: string
	/** Timestamp */
	timestamp: number
	/** Input tokens */
	inputTokens?: number
	/** Output tokens */
	outputTokens?: number
}

/**
 * Default budget configuration
 */
export const DEFAULT_BUDGET_CONFIG: BudgetConfig = {
	enabled: true,
	daily: {
		enabled: true,
		limit: 10.0,
	},
	weekly: {
		enabled: true,
		limit: 50.0,
	},
	monthly: {
		enabled: true,
		limit: 200.0,
	},
	warningThresholds: [0.5, 0.75, 0.9],
	actionAtLimit: "warn",
}

/**
 * Default empty budget data
 */
export function createEmptyBudgetData(): BudgetData {
	const now = Date.now()
	return {
		version: "1.0.0",
		lastUpdated: now,
		currentDay: createSpendRecord("daily", now),
		currentWeek: createSpendRecord("weekly", now),
		currentMonth: createSpendRecord("monthly", now),
		history: [],
	}
}

/**
 * Create a spend record for a specific period
 */
function createSpendRecord(period: BudgetPeriod, timestamp: number): SpendRecord {
	const startTime = getPeriodStart(period, timestamp)
	const endTime = getPeriodEnd(period, timestamp)
	return {
		startTime,
		endTime,
		spend: 0,
		requestCount: 0,
	}
}

/**
 * Get the start of a period
 */
function getPeriodStart(period: BudgetPeriod, timestamp: number): number {
	const date = new Date(timestamp)

	switch (period) {
		case "daily":
			date.setHours(0, 0, 0, 0)
			return date.getTime()
		case "weekly": {
			const dayOfWeek = date.getDay()
			date.setDate(date.getDate() - dayOfWeek)
			date.setHours(0, 0, 0, 0)
			return date.getTime()
		}
		case "monthly":
			date.setDate(1)
			date.setHours(0, 0, 0, 0)
			return date.getTime()
	}
}

/**
 * Get the end of a period
 */
function getPeriodEnd(period: BudgetPeriod, timestamp: number): number {
	const start = getPeriodStart(period, timestamp)
	const date = new Date(start)

	switch (period) {
		case "daily":
			date.setDate(date.getDate() + 1)
			return date.getTime()
		case "weekly":
			date.setDate(date.getDate() + 7)
			return date.getTime()
		case "monthly":
			date.setMonth(date.getMonth() + 1)
			return date.getTime()
	}
}
