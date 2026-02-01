/**
 * Budget Atoms
 * Jotai atoms for budget state management
 */

import { atom } from "jotai"
import { getBudgetService } from "../../services/budget/index.js"
import type {
	BudgetConfig,
	BudgetStatus,
	BudgetWarning,
	HistoricalSpendEntry,
	BudgetPeriod,
} from "../../services/budget/types.js"
import { DEFAULT_BUDGET_CONFIG } from "../../services/budget/types.js"
import { logs } from "../../services/logs.js"
import { configAtom, saveConfigAtom } from "./config.js"

// ============================================================================
// Core Budget Atoms
// ============================================================================

/**
 * Budget configuration atom - synced with config
 */
export const budgetConfigAtom = atom<BudgetConfig>((get) => {
	const config = get(configAtom)
	return config.budget ?? DEFAULT_BUDGET_CONFIG
})

/**
 * Budget status atom - derived from BudgetService
 */
export const budgetStatusAtom = atom<BudgetStatus>((get) => {
	const budgetService = getBudgetService()
	return budgetService.getStatus()
})

/**
 * Budget enabled atom
 */
export const budgetEnabledAtom = atom<boolean>((get) => {
	const budgetConfig = get(budgetConfigAtom)
	return budgetConfig.enabled
})

/**
 * Budget loading atom
 */
export const budgetLoadingAtom = atom<boolean>(false)

/**
 * Budget error atom
 */
export const budgetErrorAtom = atom<Error | null>(null)

/**
 * Latest budget warning atom
 */
export const budgetWarningAtom = atom<BudgetWarning | null>(null)

// ============================================================================
// Derived Budget Atoms
// ============================================================================

/**
 * Daily budget status atom
 */
export const dailyBudgetAtom = atom((get) => {
	const status = get(budgetStatusAtom)
	return status.daily
})

/**
 * Weekly budget status atom
 */
export const weeklyBudgetAtom = atom((get) => {
	const status = get(budgetStatusAtom)
	return status.weekly
})

/**
 * Monthly budget status atom
 */
export const monthlyBudgetAtom = atom((get) => {
	const status = get(budgetStatusAtom)
	return status.monthly
})

/**
 * Current warning level atom
 */
export const budgetWarningLevelAtom = atom((get) => {
	const status = get(budgetStatusAtom)
	return status.currentWarningLevel
})

/**
 * Is budget exceeded atom
 */
export const isBudgetExceededAtom = atom((get) => {
	const status = get(budgetStatusAtom)
	return status.daily.isExceeded || status.weekly.isExceeded || status.monthly.isExceeded
})

/**
 * Budget action at limit atom
 */
export const budgetActionAtLimitAtom = atom((get) => {
	const status = get(budgetStatusAtom)
	return status.actionAtLimit
})

/**
 * Total session spend atom (combines all periods)
 */
export const totalSessionSpendAtom = atom((get) => {
	const status = get(budgetStatusAtom)
	// Return the highest spend across periods (they should be similar but monthly includes all)
	return status.monthly.spend
})

// ============================================================================
// Budget History Atoms
// ============================================================================

/**
 * Budget history atom
 */
export const budgetHistoryAtom = atom<HistoricalSpendEntry[]>((get) => {
	const budgetService = getBudgetService()
	return budgetService.getHistory(30)
})

// ============================================================================
// Budget Action Atoms
// ============================================================================

/**
 * Action atom to initialize budget service
 */
export const initializeBudgetAtom = atom(null, async (get, set) => {
	try {
		set(budgetLoadingAtom, true)
		set(budgetErrorAtom, null)

		const config = get(budgetConfigAtom)
		const budgetService = getBudgetService()

		await budgetService.initialize(config)

		// Set up warning listener
		budgetService.addWarningListener((warning) => {
			set(budgetWarningAtom, warning)
		})

		logs.info("Budget initialized", "BudgetAtoms", { enabled: config.enabled })
	} catch (error) {
		const err = error instanceof Error ? error : new Error(String(error))
		set(budgetErrorAtom, err)
		logs.error("Failed to initialize budget", "BudgetAtoms", { error })
	} finally {
		set(budgetLoadingAtom, false)
	}
})

/**
 * Action atom to update budget configuration
 */
export const updateBudgetConfigAtom = atom(null, async (get, set, updates: Partial<BudgetConfig>) => {
	try {
		const budgetService = getBudgetService()
		budgetService.updateConfig(updates)

		// Update config atom to persist
		const currentConfig = get(configAtom)
		const currentBudget = currentConfig.budget ?? DEFAULT_BUDGET_CONFIG
		const updatedBudget = {
			...currentBudget,
			...updates,
			daily: { ...currentBudget.daily, ...updates.daily },
			weekly: { ...currentBudget.weekly, ...updates.weekly },
			monthly: { ...currentBudget.monthly, ...updates.monthly },
		}

		const updatedConfig = {
			...currentConfig,
			budget: updatedBudget,
		}

		await set(saveConfigAtom, updatedConfig)

		logs.info("Budget configuration updated", "BudgetAtoms")
	} catch (error) {
		const err = error instanceof Error ? error : new Error(String(error))
		set(budgetErrorAtom, err)
		logs.error("Failed to update budget config", "BudgetAtoms", { error })
		throw err
	}
})

/**
 * Action atom to enable/disable budget tracking
 */
export const toggleBudgetAtom = atom(null, async (get, set) => {
	const config = get(budgetConfigAtom)
	await set(updateBudgetConfigAtom, { enabled: !config.enabled })
})

/**
 * Action atom to set budget limit for a period
 */
export const setBudgetLimitAtom = atom(
	null,
	async (get, set, period: BudgetPeriod, limit: number, enabled: boolean = true) => {
		const config = get(budgetConfigAtom)
		await set(updateBudgetConfigAtom, {
			[period]: {
				...config[period],
				enabled,
				limit,
			},
		})
	},
)

/**
 * Action atom to set action at limit
 */
export const setBudgetActionAtom = atom(null, async (get, set, action: BudgetConfig["actionAtLimit"]) => {
	await set(updateBudgetConfigAtom, { actionAtLimit: action })
})

/**
 * Action atom to set warning thresholds
 */
export const setBudgetThresholdsAtom = atom(null, async (get, set, thresholds: number[]) => {
	// Validate thresholds
	const validThresholds = thresholds.filter((t) => t >= 0 && t <= 1).sort((a, b) => a - b)
	await set(updateBudgetConfigAtom, { warningThresholds: validThresholds })
})

/**
 * Action atom to reset budget data
 */
export const resetBudgetAtom = atom(null, async (get, set, period?: BudgetPeriod) => {
	try {
		const budgetService = getBudgetService()
		await budgetService.reset(period)
		logs.info(`Budget reset${period ? ` for ${period}` : ""}`, "BudgetAtoms")
	} catch (error) {
		const err = error instanceof Error ? error : new Error(String(error))
		set(budgetErrorAtom, err)
		logs.error("Failed to reset budget", "BudgetAtoms", { error })
		throw err
	}
})

/**
 * Action atom to clear budget warning
 */
export const clearBudgetWarningAtom = atom(null, (get, set) => {
	set(budgetWarningAtom, null)
})

/**
 * Action atom to refresh budget status
 */
export const refreshBudgetAtom = atom(null, (get, set) => {
	// This triggers a re-computation of derived atoms
	set(budgetStatusAtom, getBudgetService().getStatus())
})
