/**
 * /usage command - Summarize historical cost and token usage
 */

import { generateMessage } from "../ui/utils/messages.js"
import type { Command, CommandContext } from "./core/types.js"
import type { TaskHistoryData, TaskHistoryFilters } from "../state/atoms/taskHistory.js"
import type { HistoryItem, ProviderName } from "../types/messages.js"
import { getModelFieldForProvider } from "../constants/providers/models.js"

const MS_PER_DAY = 24 * 60 * 60 * 1000
const DEFAULT_SINCE_DAYS = 30
const DEFAULT_TOP_COUNT = 5
const DEFAULT_BREAKDOWN_LIMIT = 10

interface UsageRange {
	startTimestamp: number
	label: string
}

interface BucketStats {
	cost: number
	tokensIn: number
	tokensOut: number
	tasks: number
}

interface UsageOptions {
	workspace: "current" | "all"
	range: UsageRange
	topCount: number
}

function formatCost(cost: number): string {
	if (cost === 0) return "$0.00"
	if (cost < 0.01) return "<$0.01"
	return `$${cost.toFixed(2)}`
}

function formatTokens(tokens: number): string {
	if (tokens >= 1000000) {
		return `${(tokens / 1000000).toFixed(1)}M`
	}
	if (tokens >= 1000) {
		return `${(tokens / 1000).toFixed(1)}K`
	}
	return tokens.toString()
}

function truncate(text: string, maxLength: number): string {
	if (text.length <= maxLength) return text
	return text.substring(0, maxLength - 3) + "..."
}

function toNumber(value: unknown): number {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value
	}
	if (typeof value === "string") {
		const parsed = Number(value)
		if (Number.isFinite(parsed)) {
			return parsed
		}
	}
	return 0
}

function toStringValue(value: unknown): string | null {
	if (typeof value === "string") {
		const trimmed = value.trim()
		return trimmed.length > 0 ? trimmed : null
	}
	return null
}

function formatDateUtc(timestamp: number): string {
	return new Date(timestamp).toISOString().slice(0, 10)
}

function startOfDayUtc(timestamp: number): number {
	const date = new Date(timestamp)
	return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

function parseSinceOption(value: string | undefined, now: number): UsageRange | { error: string } {
	if (!value) {
		const start = startOfDayUtc(now - (DEFAULT_SINCE_DAYS - 1) * MS_PER_DAY)
		return { startTimestamp: start, label: `${DEFAULT_SINCE_DAYS}d` }
	}

	const trimmed = value.trim()
	const rangeMatch = trimmed.match(/^(\d+)(d|w)$/)
	if (rangeMatch) {
		const count = Number.parseInt(rangeMatch[1] || "", 10)
		if (!Number.isFinite(count) || count < 1) {
			return { error: "--since expects a positive duration like 7d or 2w." }
		}
		const unit = rangeMatch[2]
		const days = unit === "w" ? count * 7 : count
		const start = startOfDayUtc(now - (days - 1) * MS_PER_DAY)
		return { startTimestamp: start, label: `${count}${unit}` }
	}

	const dateMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/)
	if (dateMatch) {
		const year = Number.parseInt(dateMatch[1] || "", 10)
		const month = Number.parseInt(dateMatch[2] || "", 10)
		const day = Number.parseInt(dateMatch[3] || "", 10)
		const date = Date.UTC(year, month - 1, day)
		if (!Number.isFinite(date)) {
			return { error: "--since must be a valid date (YYYY-MM-DD)." }
		}
		const normalized = formatDateUtc(date)
		if (normalized !== trimmed) {
			return { error: "--since must be a valid date (YYYY-MM-DD)." }
		}
		return { startTimestamp: date, label: trimmed }
	}

	return { error: "--since must be a duration like 7d/2w or a date like 2026-01-31." }
}

function parseWorkspaceOption(
	value: string | undefined,
	fallback: "current" | "all",
): "current" | "all" | { error: string } {
	if (!value) {
		return fallback
	}

	const normalized = value.toLowerCase()
	if (normalized === "current" || normalized === "all") {
		return normalized
	}

	return { error: "--workspace must be either current or all." }
}

function parseTopOption(value: string | number | boolean | undefined): number | { error: string } {
	if (value === undefined) {
		return DEFAULT_TOP_COUNT
	}

	if (typeof value === "boolean") {
		return { error: "--top requires a number (for example: --top 5)." }
	}

	const parsed = typeof value === "number" ? value : Number.parseInt(value, 10)
	if (!Number.isFinite(parsed) || parsed < 1) {
		return { error: "--top must be a positive number." }
	}

	return Math.floor(parsed)
}

function getHistoryItemCost(item: HistoryItem): number {
	return toNumber((item as Record<string, unknown>).totalCost)
}

function getHistoryItemTokensIn(item: HistoryItem): number {
	return toNumber((item as Record<string, unknown>).tokensIn)
}

function getHistoryItemTokensOut(item: HistoryItem): number {
	return toNumber((item as Record<string, unknown>).tokensOut)
}

function getHistoryItemTimestamp(item: HistoryItem): number {
	return toNumber((item as Record<string, unknown>).ts)
}

function getHistoryItemTask(item: HistoryItem): string {
	const value = (item as Record<string, unknown>).task
	const task = toStringValue(value)
	return task || "Untitled task"
}

function getHistoryItemProvider(item: HistoryItem): string {
	const record = item as Record<string, unknown>
	const provider =
		toStringValue(record.provider) ||
		toStringValue(record.apiProvider) ||
		toStringValue(record.providerName) ||
		toStringValue(record.providerId)
	return provider || "unknown"
}

function getHistoryItemModel(item: HistoryItem, provider: string): string {
	const record = item as Record<string, unknown>
	const direct =
		toStringValue(record.model) ||
		toStringValue(record.modelId) ||
		toStringValue(record.apiModelId) ||
		toStringValue(record.modelName)

	if (direct) {
		return direct
	}

	if (provider && provider !== "unknown") {
		const modelField = getModelFieldForProvider(provider as ProviderName)
		if (modelField) {
			if (modelField === "vsCodeLmModelSelector") {
				const selector = record[modelField]
				if (selector && typeof selector === "object") {
					const vendor = toStringValue((selector as Record<string, unknown>).vendor)
					const family = toStringValue((selector as Record<string, unknown>).family)
					if (vendor && family) {
						return `${vendor}/${family}`
					}
				}
			} else {
				const providerValue = toStringValue(record[modelField])
				if (providerValue) {
					return providerValue
				}
			}
		}
	}

	return "unknown"
}

function formatProviderModel(provider: string, model: string): string {
	if (provider === "unknown" && model === "unknown") {
		return "unknown"
	}
	if (provider === "unknown") {
		return model
	}
	if (model === "unknown") {
		return provider
	}
	return `${provider} / ${model}`
}

function accumulateBucket(buckets: Map<string, BucketStats>, key: string, item: HistoryItem): void {
	const existing = buckets.get(key) || { cost: 0, tokensIn: 0, tokensOut: 0, tasks: 0 }
	const updated = {
		cost: existing.cost + getHistoryItemCost(item),
		tokensIn: existing.tokensIn + getHistoryItemTokensIn(item),
		tokensOut: existing.tokensOut + getHistoryItemTokensOut(item),
		tasks: existing.tasks + 1,
	}
	buckets.set(key, updated)
}

function buildDailyBuckets(
	items: HistoryItem[],
	rangeStart: number,
	rangeEnd: number,
): Array<{ date: string; stats: BucketStats }> {
	const buckets = new Map<string, BucketStats>()
	items.forEach((item) => {
		const ts = getHistoryItemTimestamp(item)
		if (!ts) {
			return
		}
		if (ts < rangeStart || ts > rangeEnd) {
			return
		}
		const dateKey = formatDateUtc(startOfDayUtc(ts))
		accumulateBucket(buckets, dateKey, item)
	})

	const startDate = new Date(rangeStart)
	const endDate = new Date(rangeEnd)
	const days: Array<{ date: string; stats: BucketStats }> = []

	const cursor = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()))
	const endCursor = Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate())

	while (cursor.getTime() <= endCursor) {
		const dateKey = formatDateUtc(cursor.getTime())
		const stats = buckets.get(dateKey) || { cost: 0, tokensIn: 0, tokensOut: 0, tasks: 0 }
		days.push({ date: dateKey, stats })
		cursor.setUTCDate(cursor.getUTCDate() + 1)
	}

	return days
}

function median(values: number[]): number {
	if (values.length === 0) {
		return 0
	}
	const sorted = [...values].sort((a, b) => a - b)
	const mid = Math.floor(sorted.length / 2)
	if (sorted.length % 2 === 0) {
		return (sorted[mid - 1]! + sorted[mid]!) / 2
	}
	return sorted[mid]!
}

function buildUsageOptions(context: CommandContext): UsageOptions | { error: string } {
	const rawWorkspace = context.options.workspace ?? context.options.w
	const rawSinceOption = context.options.since ?? context.options.s
	const rawSinceArg = context.args[0]
	const rawTop = context.options.top ?? context.options.t

	if (rawWorkspace !== undefined && typeof rawWorkspace !== "string") {
		return { error: "--workspace must be either current or all." }
	}

	if (rawSinceOption !== undefined && typeof rawSinceOption !== "string") {
		return { error: "--since requires a value like 7d or 2026-01-31." }
	}

	const now = Date.now()
	const rawSince = typeof rawSinceOption === "string" ? rawSinceOption : rawSinceArg
	const range = parseSinceOption(typeof rawSince === "string" ? rawSince : undefined, now)
	if ("error" in range) {
		return { error: range.error }
	}

	const workspaceResult = parseWorkspaceOption(
		typeof rawWorkspace === "string" ? rawWorkspace : undefined,
		context.taskHistoryFilters.workspace,
	)
	if (typeof workspaceResult !== "string") {
		return { error: workspaceResult.error }
	}

	const topCount = parseTopOption(rawTop)
	if (typeof topCount !== "number") {
		return { error: topCount.error }
	}

	return {
		workspace: workspaceResult,
		range,
		topCount,
	}
}

async function fetchUsageHistory(context: CommandContext, options: UsageOptions): Promise<HistoryItem[]> {
	const previousFilters = context.taskHistoryFilters
	const previousPageIndex = context.taskHistoryData?.pageIndex ?? 0

	const restoreFilters: Partial<TaskHistoryFilters> = {
		workspace: previousFilters.workspace,
		sort: previousFilters.sort,
		favoritesOnly: previousFilters.favoritesOnly,
	}
	if (typeof previousFilters.search === "string") {
		restoreFilters.search = previousFilters.search
	}

	try {
		const firstPage = await context.updateTaskHistoryFilters({
			workspace: options.workspace,
			sort: "newest",
			favoritesOnly: false,
			search: "",
		})

		const allItems: HistoryItem[] = []
		const since = options.range.startTimestamp
		const hasRecentItems = (items: HistoryItem[]) => items.some((item) => getHistoryItemTimestamp(item) >= since)
		const collectItems = (data: TaskHistoryData) => {
			data.historyItems.forEach((item) => {
				if (getHistoryItemTimestamp(item) >= since) {
					allItems.push(item)
				}
			})
		}

		collectItems(firstPage)
		if (!hasRecentItems(firstPage.historyItems)) {
			return allItems
		}

		for (let pageIndex = 1; pageIndex < firstPage.pageCount; pageIndex += 1) {
			const page = await context.changeTaskHistoryPage(pageIndex)
			collectItems(page)
			if (!hasRecentItems(page.historyItems)) {
				break
			}
		}

		return allItems
	} finally {
		try {
			await context.updateTaskHistoryFilters(restoreFilters)
			if (previousPageIndex !== 0) {
				await context.changeTaskHistoryPage(previousPageIndex)
			}
		} catch {
			// Ignore restore failures
		}
	}
}

function buildUsageReport(items: HistoryItem[], options: UsageOptions): string {
	const totalTasks = items.length
	if (totalTasks === 0) {
		return `No tasks found for the last ${options.range.label} in the ${options.workspace} workspace.`
	}

	const totalCost = items.reduce((sum, item) => sum + getHistoryItemCost(item), 0)
	const tokensIn = items.reduce((sum, item) => sum + getHistoryItemTokensIn(item), 0)
	const tokensOut = items.reduce((sum, item) => sum + getHistoryItemTokensOut(item), 0)
	const totalTokens = tokensIn + tokensOut
	const avgCost = totalCost / totalTasks
	const medianCost = median(items.map((item) => getHistoryItemCost(item)))

	const topTasks = [...items].sort((a, b) => getHistoryItemCost(b) - getHistoryItemCost(a)).slice(0, options.topCount)

	const providerModelBuckets = new Map<string, BucketStats>()
	items.forEach((item) => {
		const provider = getHistoryItemProvider(item)
		const model = getHistoryItemModel(item, provider)
		const key = formatProviderModel(provider, model)
		accumulateBucket(providerModelBuckets, key, item)
	})

	const providerModelBreakdown = [...providerModelBuckets.entries()]
		.map(([key, stats]) => ({ key, stats }))
		.sort((a, b) => b.stats.cost - a.stats.cost)
		.slice(0, DEFAULT_BREAKDOWN_LIMIT)

	const rangeStart = options.range.startTimestamp
	const rangeEnd = Date.now()
	const dailyBuckets = buildDailyBuckets(items, rangeStart, rangeEnd)

	const lines: string[] = []
	lines.push(`**Usage Summary** (last ${options.range.label}, workspace: ${options.workspace})`)
	lines.push("")
	lines.push(`Total tasks: ${totalTasks}`)
	lines.push(`Total cost: ${formatCost(totalCost)}`)
	lines.push(
		`Total tokens: ${formatTokens(totalTokens)} (${formatTokens(tokensIn)} in / ${formatTokens(tokensOut)} out)`,
	)
	lines.push(`Avg cost per task: ${formatCost(avgCost)}`)
	lines.push(`Median cost per task: ${formatCost(medianCost)}`)
	lines.push("")

	lines.push("**Top tasks by cost:**")
	if (topTasks.length === 0) {
		lines.push("No tasks with cost data.")
	} else {
		topTasks.forEach((item, index) => {
			const taskId = (item as Record<string, unknown>).id
			const label = typeof taskId === "string" ? taskId : "unknown"
			const cost = formatCost(getHistoryItemCost(item))
			const tokens = formatTokens(getHistoryItemTokensIn(item) + getHistoryItemTokensOut(item))
			const timestamp = getHistoryItemTimestamp(item)
			const date = timestamp ? formatDateUtc(timestamp) : "unknown"
			const provider = getHistoryItemProvider(item)
			const model = getHistoryItemModel(item, provider)
			const providerModel = formatProviderModel(provider, model)
			const taskText = truncate(getHistoryItemTask(item), 60)
			lines.push(`${index + 1}. ${cost} | ${tokens} tokens | ${date} | ${providerModel} | ${label}`)
			lines.push(`   ${taskText}`)
		})
	}
	lines.push("")

	lines.push("**Provider / model breakdown:**")
	if (providerModelBreakdown.length === 0) {
		lines.push("No provider or model data available.")
	} else {
		providerModelBreakdown.forEach(({ key, stats }) => {
			const tokens = formatTokens(stats.tokensIn + stats.tokensOut)
			lines.push(`- ${key}: ${formatCost(stats.cost)} | ${tokens} tokens | ${stats.tasks} tasks`)
		})
		if (providerModelBuckets.size > DEFAULT_BREAKDOWN_LIMIT) {
			lines.push(`(Showing top ${DEFAULT_BREAKDOWN_LIMIT} by cost)`)
		}
	}
	lines.push("")

	lines.push("**Daily spend:**")
	if (dailyBuckets.length === 0) {
		lines.push("No daily data available.")
	} else {
		dailyBuckets.forEach((entry) => {
			const tokens = formatTokens(entry.stats.tokensIn + entry.stats.tokensOut)
			lines.push(`${entry.date}: ${formatCost(entry.stats.cost)} | ${tokens} tokens | ${entry.stats.tasks} tasks`)
		})
	}

	return lines.join("\n")
}

export const usageCommand: Command = {
	name: "usage",
	aliases: ["spend", "cost"],
	description: "Summarize historical cost and token usage",
	usage: "/usage [--since 7d|2026-01-31] [--workspace current|all] [--top 5]",
	examples: ["/usage", "/usage --since 7d", "/usage --workspace all", "/usage --top 10"],
	category: "system",
	priority: 8,
	options: [
		{
			name: "since",
			alias: "s",
			description: "Time range (e.g., 7d, 2w, 2026-01-31)",
			required: false,
			type: "string",
		},
		{
			name: "workspace",
			alias: "w",
			description: "Scope: current or all workspaces",
			required: false,
			type: "string",
		},
		{
			name: "top",
			alias: "t",
			description: "Number of top tasks to show",
			required: false,
			type: "number",
		},
	],
	handler: async (context) => {
		const { addMessage } = context
		const options = buildUsageOptions(context)
		if ("error" in options) {
			addMessage({
				...generateMessage(),
				type: "error",
				content: `${options.error}\nUsage: /usage --since 7d --workspace current --top 5`,
			})
			return
		}

		addMessage({
			...generateMessage(),
			type: "system",
			content: `Building usage report (last ${options.range.label}, workspace: ${options.workspace})...`,
		})

		try {
			const items = await fetchUsageHistory(context, options)
			const report = buildUsageReport(items, options)
			addMessage({
				...generateMessage(),
				type: "system",
				content: report,
			})
		} catch (error) {
			addMessage({
				...generateMessage(),
				type: "error",
				content: `Failed to build usage report: ${error instanceof Error ? error.message : String(error)}`,
			})
		}
	},
}
