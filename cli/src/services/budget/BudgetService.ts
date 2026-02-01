/**
 * Budget Service
 * Manages budget tracking, cost accumulation, and warnings
 */

import * as fs from "fs/promises"
import * as path from "path"
import { homedir } from "os"
import { logs } from "../logs.js"
import type {
	BudgetConfig,
	BudgetData,
	BudgetPeriod,
	BudgetStatus,
	BudgetWarning,
	CostEvent,
	HistoricalSpendEntry,
	PeriodBudgetStatus,
	SpendRecord,
	WarningLevel,
} from "./types.js"
import { createEmptyBudgetData, DEFAULT_BUDGET_CONFIG } from "./types.js"

const BUDGET_DIR = path.join(homedir(), ".kilocode", "cli")
const BUDGET_FILE = path.join(BUDGET_DIR, "budget.json")

// Allow overriding paths for testing
let budgetDir = BUDGET_DIR
let budgetFile = BUDGET_FILE

export function setBudgetPaths(dir: string, file: string): void {
	budgetDir = dir
	budgetFile = file
}

export function resetBudgetPaths(): void {
	budgetDir = BUDGET_DIR
	budgetFile = BUDGET_FILE
}

/**
 * Budget Service
 * Singleton service for tracking costs and managing budget limits
 */
export class BudgetService {
	private static instance: BudgetService | null = null
	private config: BudgetConfig = DEFAULT_BUDGET_CONFIG
	private data: BudgetData = createEmptyBudgetData()
	private isInitialized = false
	private warningListeners: Set<(warning: BudgetWarning) => void> = new Set()
	private lastWarningLevel: Map<BudgetPeriod, WarningLevel> = new Map()

	private constructor() {
		// Private constructor for singleton
	}

	/**
	 * Get singleton instance
	 */
	public static getInstance(): BudgetService {
		if (!BudgetService.instance) {
			BudgetService.instance = new BudgetService()
		}
		return BudgetService.instance
	}

	/**
	 * Initialize the budget service
	 */
	public async initialize(config?: Partial<BudgetConfig>): Promise<void> {
		if (this.isInitialized) {
			return
		}

		try {
			// Merge provided config with defaults
			if (config) {
				this.config = {
					...DEFAULT_BUDGET_CONFIG,
					...config,
					daily: { ...DEFAULT_BUDGET_CONFIG.daily, ...config.daily },
					weekly: { ...DEFAULT_BUDGET_CONFIG.weekly, ...config.weekly },
					monthly: { ...DEFAULT_BUDGET_CONFIG.monthly, ...config.monthly },
				}
			}

			// Load persisted data
			await this.loadData()

			// Roll over periods if needed
			this.rolloverPeriodsIfNeeded()

			this.isInitialized = true
			logs.info("Budget service initialized", "BudgetService", {
				enabled: this.config.enabled,
				dailyLimit: this.config.daily.limit,
				weeklyLimit: this.config.weekly.limit,
				monthlyLimit: this.config.monthly.limit,
			})
		} catch (error) {
			logs.error("Failed to initialize budget service", "BudgetService", { error })
			// Continue with empty data - don't throw to prevent blocking CLI
			this.isInitialized = true
		}
	}

	/**
	 * Shutdown the budget service
	 */
	public async shutdown(): Promise<void> {
		if (!this.isInitialized) {
			return
		}

		try {
			await this.saveData()
			logs.info("Budget service shut down", "BudgetService")
		} catch (error) {
			logs.error("Error shutting down budget service", "BudgetService", { error })
		}
	}

	/**
	 * Update budget configuration
	 */
	public updateConfig(config: Partial<BudgetConfig>): void {
		this.config = {
			...this.config,
			...config,
			daily: { ...this.config.daily, ...config.daily },
			weekly: { ...this.config.weekly, ...config.weekly },
			monthly: { ...this.config.monthly, ...config.monthly },
		}
		logs.info("Budget configuration updated", "BudgetService", { enabled: this.config.enabled })
	}

	/**
	 * Get current budget configuration
	 */
	public getConfig(): BudgetConfig {
		return { ...this.config }
	}

	/**
	 * Track a cost event
	 */
	public trackCost(event: CostEvent): BudgetWarning | null {
		if (!this.config.enabled) {
			return null
		}

		// Update current period spend
		this.data.currentDay.spend += event.cost
		this.data.currentDay.requestCount++
		this.data.currentWeek.spend += event.cost
		this.data.currentWeek.requestCount++
		this.data.currentMonth.spend += event.cost
		this.data.currentMonth.requestCount++
		this.data.lastUpdated = Date.now()

		// Update today's history entry
		this.updateHistoryEntry(event)

		// Check for warnings
		const warning = this.checkWarnings()

		// Auto-save periodically (every 10 requests)
		if (this.data.currentDay.requestCount % 10 === 0) {
			void this.saveData()
		}

		return warning
	}

	/**
	 * Get current budget status
	 */
	public getStatus(): BudgetStatus {
		const now = Date.now()

		// Rollover periods if needed
		this.rolloverPeriodsIfNeeded()

		const daily = this.calculatePeriodStatus("daily", now)
		const weekly = this.calculatePeriodStatus("weekly", now)
		const monthly = this.calculatePeriodStatus("monthly", now)

		// Determine highest warning level
		const warningLevels: WarningLevel[] = [daily.warningLevel, weekly.warningLevel, monthly.warningLevel]
		const currentWarningLevel = this.getHighestWarningLevel(warningLevels)

		return {
			enabled: this.config.enabled,
			daily,
			weekly,
			monthly,
			currentWarningLevel,
			actionAtLimit: this.config.actionAtLimit,
		}
	}

	/**
	 * Get budget history
	 */
	public getHistory(days: number = 30): HistoricalSpendEntry[] {
		return this.data.history.slice(-days)
	}

	/**
	 * Reset budget data (for testing or user request)
	 */
	public async reset(period?: BudgetPeriod): Promise<void> {
		const now = Date.now()

		if (period) {
			// Reset specific period
			switch (period) {
				case "daily":
					this.data.currentDay = this.createSpendRecord("daily", now)
					break
				case "weekly":
					this.data.currentWeek = this.createSpendRecord("weekly", now)
					break
				case "monthly":
					this.data.currentMonth = this.createSpendRecord("monthly", now)
					break
			}
			logs.info(`Budget reset for ${period}`, "BudgetService")
		} else {
			// Reset all data
			this.data = createEmptyBudgetData()
			logs.info("All budget data reset", "BudgetService")
		}

		this.lastWarningLevel.clear()
		await this.saveData()
	}

	/**
	 * Add a warning listener
	 */
	public addWarningListener(listener: (warning: BudgetWarning) => void): () => void {
		this.warningListeners.add(listener)
		return () => {
			this.warningListeners.delete(listener)
		}
	}

	/**
	 * Check if budget is exceeded for any period
	 */
	public isBudgetExceeded(): boolean {
		const status = this.getStatus()
		return status.daily.isExceeded || status.weekly.isExceeded || status.monthly.isExceeded
	}

	/**
	 * Get the action to take when budget is exceeded
	 */
	public getActionAtLimit(): "warn" | "pause" | "block" {
		return this.config.actionAtLimit
	}

	// ============================================================================
	// Private Methods
	// ============================================================================

	private async loadData(): Promise<void> {
		try {
			await fs.access(budgetFile)
			const content = await fs.readFile(budgetFile, "utf-8")
			const loadedData = JSON.parse(content) as BudgetData

			// Validate and merge with defaults
			this.data = {
				...createEmptyBudgetData(),
				...loadedData,
			}

			logs.debug("Budget data loaded", "BudgetService", {
				dailySpend: this.data.currentDay.spend,
				weeklySpend: this.data.currentWeek.spend,
				monthlySpend: this.data.currentMonth.spend,
			})
		} catch {
			// File doesn't exist or is invalid - start fresh
			this.data = createEmptyBudgetData()
			logs.info("No existing budget data found, starting fresh", "BudgetService")
		}
	}

	private async saveData(): Promise<void> {
		try {
			await fs.mkdir(budgetDir, { recursive: true })
			await fs.writeFile(budgetFile, JSON.stringify(this.data, null, 2))
			logs.debug("Budget data saved", "BudgetService")
		} catch (error) {
			logs.error("Failed to save budget data", "BudgetService", { error })
		}
	}

	private rolloverPeriodsIfNeeded(): void {
		const now = Date.now()

		// Check day rollover
		if (now >= this.data.currentDay.endTime) {
			// Archive current day to history before rolling over
			this.archiveCurrentDay()
			this.data.currentDay = this.createSpendRecord("daily", now)
			this.lastWarningLevel.delete("daily")
			logs.debug("Daily budget period rolled over", "BudgetService")
		}

		// Check week rollover
		if (now >= this.data.currentWeek.endTime) {
			this.data.currentWeek = this.createSpendRecord("weekly", now)
			this.lastWarningLevel.delete("weekly")
			logs.debug("Weekly budget period rolled over", "BudgetService")
		}

		// Check month rollover
		if (now >= this.data.currentMonth.endTime) {
			this.data.currentMonth = this.createSpendRecord("monthly", now)
			this.lastWarningLevel.delete("monthly")
			logs.debug("Monthly budget period rolled over", "BudgetService")
		}
	}

	private archiveCurrentDay(): void {
		const date = new Date(this.data.currentDay.startTime)
		const dateStr = date.toISOString().split("T")[0]

		// Update or add entry for today
		const existingIndex = this.data.history.findIndex((h) => h.date === dateStr)
		if (existingIndex >= 0) {
			this.data.history[existingIndex] = {
				date: dateStr,
				spend: this.data.currentDay.spend,
				requestCount: this.data.currentDay.requestCount,
			}
		} else {
			this.data.history.push({
				date: dateStr,
				spend: this.data.currentDay.spend,
				requestCount: this.data.currentDay.requestCount,
			})
		}

		// Keep only last 90 days of history
		if (this.data.history.length > 90) {
			this.data.history = this.data.history.slice(-90)
		}
	}

	private updateHistoryEntry(event: CostEvent): void {
		const date = new Date(event.timestamp)
		const dateStr = date.toISOString().split("T")[0]

		const existingIndex = this.data.history.findIndex((h) => h.date === dateStr)
		if (existingIndex >= 0) {
			this.data.history[existingIndex].spend += event.cost
			this.data.history[existingIndex].requestCount++
		} else {
			this.data.history.push({
				date: dateStr,
				spend: event.cost,
				requestCount: 1,
			})
		}
	}

	private createSpendRecord(period: BudgetPeriod, timestamp: number): SpendRecord {
		return {
			startTime: this.getPeriodStart(period, timestamp),
			endTime: this.getPeriodEnd(period, timestamp),
			spend: 0,
			requestCount: 0,
		}
	}

	private getPeriodStart(period: BudgetPeriod, timestamp: number): number {
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

	private getPeriodEnd(period: BudgetPeriod, timestamp: number): number {
		const start = this.getPeriodStart(period, timestamp)
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

	private calculatePeriodStatus(period: BudgetPeriod, now: number): PeriodBudgetStatus {
		const limit = this.config[period]
		const record =
			period === "daily"
				? this.data.currentDay
				: period === "weekly"
					? this.data.currentWeek
					: this.data.currentMonth

		const spend = record.spend
		const percentage = limit.limit > 0 ? spend / limit.limit : 0
		const remaining = Math.max(0, limit.limit - spend)
		const isExceeded = spend >= limit.limit
		const warningLevel = this.calculateWarningLevel(percentage, isExceeded)

		return {
			enabled: limit.enabled,
			limit: limit.limit,
			spend,
			percentage,
			remaining,
			isExceeded,
			warningLevel,
		}
	}

	private calculateWarningLevel(percentage: number, isExceeded: boolean): WarningLevel {
		if (isExceeded) return "critical"

		const thresholds = [...this.config.warningThresholds].sort((a, b) => a - b)

		if (percentage >= (thresholds[2] ?? 0.9)) return "high"
		if (percentage >= (thresholds[1] ?? 0.75)) return "medium"
		if (percentage >= (thresholds[0] ?? 0.5)) return "low"

		return "none"
	}

	private getHighestWarningLevel(levels: WarningLevel[]): WarningLevel {
		const priority: Record<WarningLevel, number> = {
			none: 0,
			low: 1,
			medium: 2,
			high: 3,
			critical: 4,
		}

		return levels.reduce((highest, current) => (priority[current] > priority[highest] ? current : highest))
	}

	private checkWarnings(): BudgetWarning | null {
		if (!this.config.enabled) return null

		const status = this.getStatus()
		const periods: BudgetPeriod[] = ["daily", "weekly", "monthly"]

		for (const period of periods) {
			const periodStatus = status[period]

			if (!periodStatus.enabled) continue

			const lastWarning = this.lastWarningLevel.get(period) ?? "none"

			// Only trigger warning if level increased
			if (this.shouldTriggerWarning(lastWarning, periodStatus.warningLevel)) {
				this.lastWarningLevel.set(period, periodStatus.warningLevel)

				const warning: BudgetWarning = {
					level: periodStatus.warningLevel,
					period,
					spend: periodStatus.spend,
					limit: periodStatus.limit,
					percentage: periodStatus.percentage,
					message: this.createWarningMessage(period, periodStatus),
				}

				// Notify listeners
				this.warningListeners.forEach((listener) => {
					try {
						listener(warning)
					} catch {
						// Ignore listener errors
					}
				})

				return warning
			}
		}

		return null
	}

	private shouldTriggerWarning(lastLevel: WarningLevel, currentLevel: WarningLevel): boolean {
		const priority: Record<WarningLevel, number> = {
			none: 0,
			low: 1,
			medium: 2,
			high: 3,
			critical: 4,
		}

		return priority[currentLevel] > priority[lastLevel]
	}

	private createWarningMessage(period: BudgetPeriod, status: PeriodBudgetStatus): string {
		const percentage = Math.round(status.percentage * 100)
		const periodName = period.charAt(0).toUpperCase() + period.slice(1)

		switch (status.warningLevel) {
			case "critical":
				return `⚠️ ${periodName} budget exceeded! Spent $${status.spend.toFixed(2)} of $${status.limit.toFixed(2)} limit (${percentage}%)`
			case "high":
				return `⚠️ ${periodName} budget at ${percentage}% ($${status.spend.toFixed(2)} / $${status.limit.toFixed(2)})`
			case "medium":
				return `📊 ${periodName} budget at ${percentage}% ($${status.spend.toFixed(2)} / $${status.limit.toFixed(2)})`
			case "low":
				return `📊 ${periodName} budget at ${percentage}% ($${status.spend.toFixed(2)} / $${status.limit.toFixed(2)})`
			default:
				return ""
		}
	}
}

/**
 * Get the singleton budget service instance
 */
export function getBudgetService(): BudgetService {
	return BudgetService.getInstance()
}
