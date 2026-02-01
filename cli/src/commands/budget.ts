/**
 * Budget Command
 * Manage budget settings and view spending
 */

import type { Command, CommandContext, ArgumentProviderContext } from "./core/types.js"
import { getBudgetService } from "../services/budget/index.js"
import type { BudgetPeriod, BudgetAction, BudgetStatus } from "../services/budget/types.js"
import { formatSessionCost } from "../state/hooks/useSessionCost.js"

// ============================================================================
// Autocomplete Providers
// ============================================================================

const subcommandProvider = (): { value: string; title: string; description: string }[] => [
	{ value: "status", title: "Status", description: "View current budget status and spending" },
	{ value: "set", title: "Set", description: "Set budget limits for daily/weekly/monthly" },
	{ value: "history", title: "History", description: "View spending history" },
	{ value: "reset", title: "Reset", description: "Reset budget data" },
	{ value: "action", title: "Action", description: "Set action when budget is exceeded (warn/pause/block)" },
]

const periodProvider = (): { value: string; title: string; description: string }[] => [
	{ value: "daily", title: "Daily", description: "Daily budget limit" },
	{ value: "weekly", title: "Weekly", description: "Weekly budget limit" },
	{ value: "monthly", title: "Monthly", description: "Monthly budget limit" },
]

const actionProvider = (): { value: string; title: string; description: string }[] => [
	{ value: "warn", title: "Warn", description: "Show warning when budget is exceeded" },
	{ value: "pause", title: "Pause", description: "Pause operations when budget is exceeded" },
	{ value: "block", title: "Block", description: "Block new operations when budget is exceeded" },
]

// ============================================================================
// Helper Functions
// ============================================================================

function formatBudgetStatus(status: BudgetStatus): string {
	const lines: string[] = ["**Budget Status**", ""]

	if (!status.enabled) {
		lines.push("⚠️ Budget tracking is currently **disabled**")
		lines.push("")
		lines.push("Enable with: `/budget set enabled true`")
		return lines.join("\n")
	}

	// Daily
	lines.push(formatPeriodStatus("Daily", status.daily))
	lines.push("")

	// Weekly
	lines.push(formatPeriodStatus("Weekly", status.weekly))
	lines.push("")

	// Monthly
	lines.push(formatPeriodStatus("Monthly", status.monthly))
	lines.push("")

	// Action at limit
	lines.push(`**Action at limit:** ${status.actionAtLimit.toUpperCase()}`)

	// Warning indicator
	if (status.currentWarningLevel !== "none") {
		const warningEmoji = status.currentWarningLevel === "critical" ? "🚨" : "⚠️"
		lines.push("")
		lines.push(`${warningEmoji} **Warning Level:** ${status.currentWarningLevel.toUpperCase()}`)
	}

	return lines.join("\n")
}

function formatPeriodStatus(name: string, period: BudgetStatus["daily"]): string {
	if (!period.enabled) {
		return `**${name}:** Disabled`
	}

	const percentage = Math.round(period.percentage * 100)
	const progressBar = createProgressBar(percentage)
	const statusEmoji = period.isExceeded ? "🚨" : percentage >= 90 ? "⚠️" : percentage >= 75 ? "📊" : "✅"

	return [
		`${statusEmoji} **${name}:** ${formatSessionCost(period.spend)} / ${formatSessionCost(period.limit)}`,
		`   ${progressBar} ${percentage}%`,
		`   Remaining: ${formatSessionCost(period.remaining)}`,
	].join("\n")
}

function createProgressBar(percentage: number): string {
	const filled = Math.round(percentage / 10)
	const empty = 10 - filled
	const filledChar = "█"
	const emptyChar = "░"
	return filledChar.repeat(filled) + emptyChar.repeat(empty)
}

function formatHistory(history: { date: string; spend: number; requestCount: number }[]): string {
	if (history.length === 0) {
		return "**Spending History**\n\nNo spending history available yet."
	}

	const lines: string[] = ["**Spending History (Last 30 Days)**", ""]

	// Calculate totals
	let totalSpend = 0
	let totalRequests = 0

	for (const entry of history) {
		totalSpend += entry.spend
		totalRequests += entry.requestCount
	}

	lines.push(`Total: ${formatSessionCost(totalSpend)} across ${totalRequests} requests`)
	lines.push("")

	// Show last 14 days
	const recentHistory = history.slice(-14).reverse()
	for (const entry of recentHistory) {
		const date = new Date(entry.date)
		const dateStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
		const spendStr = formatSessionCost(entry.spend)
		lines.push(`  ${dateStr}: ${spendStr} (${entry.requestCount} requests)`)
	}

	return lines.join("\n")
}

// ============================================================================
// Subcommand Handlers
// ============================================================================

function handleStatus(context: CommandContext): void {
	const budgetService = getBudgetService()
	const status = budgetService.getStatus()

	context.addMessage({
		id: Date.now().toString(),
		type: "system",
		content: formatBudgetStatus(status),
		ts: Date.now(),
	})
}

async function handleSet(context: CommandContext): Promise<void> {
	const { args, addMessage } = context

	if (args.length < 2) {
		addMessage({
			id: Date.now().toString(),
			type: "system",
			content: [
				"**Set Budget Usage:**",
				"",
				"/budget set daily <amount> - Set daily budget limit",
				"/budget set weekly <amount> - Set weekly budget limit",
				"/budget set monthly <amount> - Set monthly budget limit",
				"/budget set enabled true|false - Enable/disable budget tracking",
				"",
				"Example: `/budget set daily 10`",
			].join("\n"),
			ts: Date.now(),
		})
		return
	}

	const target = args[0].toLowerCase()
	const value = args[1]

	if (target === "enabled") {
		const enabled = value === "true"
		const budgetService = getBudgetService()
		budgetService.updateConfig({ enabled })

		addMessage({
			id: Date.now().toString(),
			type: "system",
			content: `Budget tracking ${enabled ? "**enabled** ✅" : "**disabled** ⚠️"}`,
			ts: Date.now(),
		})
		return
	}

	const validPeriods: BudgetPeriod[] = ["daily", "weekly", "monthly"]
	if (!validPeriods.includes(target as BudgetPeriod)) {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: `Invalid target "${target}". Use: daily, weekly, monthly, or enabled`,
			ts: Date.now(),
		})
		return
	}

	const amount = parseFloat(value)
	if (isNaN(amount) || amount < 0) {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: `Invalid amount "${value}". Please provide a positive number.`,
			ts: Date.now(),
		})
		return
	}

	const budgetService = getBudgetService()
	const period = target as BudgetPeriod

	budgetService.updateConfig({
		[period]: {
			...budgetService.getConfig()[period],
			limit: amount,
			enabled: true,
		},
	})

	addMessage({
		id: Date.now().toString(),
		type: "system",
		content: `✅ ${period.charAt(0).toUpperCase() + period.slice(1)} budget limit set to **${formatSessionCost(amount)}**`,
		ts: Date.now(),
	})
}

function handleHistory(context: CommandContext): void {
	const budgetService = getBudgetService()
	const history = budgetService.getHistory(30)

	context.addMessage({
		id: Date.now().toString(),
		type: "system",
		content: formatHistory(history),
		ts: Date.now(),
	})
}

async function handleReset(context: CommandContext): Promise<void> {
	const { args, addMessage } = context
	const budgetService = getBudgetService()

	const target = args[0]?.toLowerCase()

	if (!target) {
		// Reset all
		await budgetService.reset()
		addMessage({
			id: Date.now().toString(),
			type: "system",
			content: "🗑️ All budget data has been reset.",
			ts: Date.now(),
		})
		return
	}

	const validPeriods: BudgetPeriod[] = ["daily", "weekly", "monthly"]
	if (!validPeriods.includes(target as BudgetPeriod)) {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: `Invalid period "${target}". Use: daily, weekly, monthly, or omit to reset all.`,
			ts: Date.now(),
		})
		return
	}

	await budgetService.reset(target as BudgetPeriod)
	addMessage({
		id: Date.now().toString(),
		type: "system",
		content: `🗑️ ${target.charAt(0).toUpperCase() + target.slice(1)} budget data has been reset.`,
		ts: Date.now(),
	})
}

async function handleAction(context: CommandContext): Promise<void> {
	const { args, addMessage } = context
	const budgetService = getBudgetService()

	if (args.length === 0) {
		const currentAction = budgetService.getConfig().actionAtLimit
		addMessage({
			id: Date.now().toString(),
			type: "system",
			content: [
				"**Current Action at Limit:** " + currentAction.toUpperCase(),
				"",
				"Available actions:",
				"  **warn** - Show warning when budget is exceeded",
				"  **pause** - Pause operations when budget is exceeded",
				"  **block** - Block new operations when budget is exceeded",
				"",
				"Usage: `/budget action <warn|pause|block>`",
			].join("\n"),
			ts: Date.now(),
		})
		return
	}

	const action = args[0].toLowerCase() as BudgetAction
	const validActions: BudgetAction[] = ["warn", "pause", "block"]

	if (!validActions.includes(action)) {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: `Invalid action "${action}". Use: warn, pause, or block.`,
			ts: Date.now(),
		})
		return
	}

	budgetService.updateConfig({ actionAtLimit: action })

	addMessage({
		id: Date.now().toString(),
		type: "system",
		content: `✅ Action at limit set to **${action.toUpperCase()}**`,
		ts: Date.now(),
	})
}

// ============================================================================
// Main Command
// ============================================================================

export const budgetCommand: Command = {
	name: "budget",
	aliases: ["cost", "spend"],
	description: "Manage budget settings and view spending",
	usage: "/budget [subcommand] [args...]",
	examples: [
		"/budget status",
		"/budget set daily 10",
		"/budget set weekly 50",
		"/budget set monthly 200",
		"/budget set enabled true",
		"/budget history",
		"/budget reset",
		"/budget reset daily",
		"/budget action warn",
	],
	category: "settings",
	priority: 8,
	arguments: [
		{
			name: "subcommand",
			description: "Subcommand to run (status, set, history, reset, action)",
			required: false,
			provider: subcommandProvider,
			placeholder: "Select a subcommand",
		},
	],
	handler: async (context) => {
		const { args, addMessage } = context
		const subcommand = args[0]?.toLowerCase()

		// Default to status if no subcommand provided
		if (!subcommand) {
			handleStatus(context)
			return
		}

		switch (subcommand) {
			case "status":
			case "s":
				handleStatus(context)
				break
			case "set":
				await handleSet(context)
				break
			case "history":
			case "h":
				handleHistory(context)
				break
			case "reset":
				await handleReset(context)
				break
			case "action":
				await handleAction(context)
				break
			default:
				addMessage({
					id: Date.now().toString(),
					type: "error",
					content: [
						`Unknown subcommand "${subcommand}".`,
						"",
						"Available subcommands:",
						"  **status** - View current budget status",
						"  **set** - Set budget limits",
						"  **history** - View spending history",
						"  **reset** - Reset budget data",
						"  **action** - Set action when budget exceeded",
					].join("\n"),
					ts: Date.now(),
				})
		}
	},
}
