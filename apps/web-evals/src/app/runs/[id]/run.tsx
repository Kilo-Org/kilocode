"use client"

import { useMemo } from "react"
import { LoaderCircle } from "lucide-react"

import type { Run, TaskMetrics as _TaskMetrics } from "@roo-code/evals"

import { formatCurrency, formatDuration, formatTokens, formatToolUsageSuccessRate } from "@/lib/formatters"
import { useRunStatus } from "@/hooks/use-run-status"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui"

import { TaskStatus } from "./task-status"
import { RunStatus } from "./run-status"

type TaskMetrics = Pick<_TaskMetrics, "tokensIn" | "tokensOut" | "tokensContext" | "duration" | "cost">

type ToolUsageEntry = { attempts: number; failures: number }
type ToolUsage = Record<string, ToolUsageEntry>

// Generate abbreviation from tool name (e.g., "read_file" -> "RF", "list_code_definition_names" -> "LCDN")
function getToolAbbreviation(toolName: string): string {
	return toolName
		.split("_")
		.map((word) => word[0]?.toUpperCase() ?? "")
		.join("")
}

export function Run({ run }: { run: Run }) {
	const runStatus = useRunStatus(run)
	const { tasks, tokenUsage, usageUpdatedAt } = runStatus

	const taskMetrics: Record<number, TaskMetrics> = useMemo(() => {
		const metrics: Record<number, TaskMetrics> = {}

		tasks?.forEach((task) => {
			const usage = tokenUsage.get(task.id)

			if (task.finishedAt && task.taskMetrics) {
				metrics[task.id] = task.taskMetrics
			} else if (usage) {
				metrics[task.id] = {
					tokensIn: usage.totalTokensIn,
					tokensOut: usage.totalTokensOut,
					tokensContext: usage.contextTokens,
					duration: usage.duration ?? 0,
					cost: usage.totalCost,
				}
			}
		})

		return metrics
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [tasks, tokenUsage, usageUpdatedAt])

	// Compute aggregate stats
	const stats = useMemo(() => {
		if (!tasks) return null

		const passed = tasks.filter((t) => t.passed === true).length
		const failed = tasks.filter((t) => t.passed === false).length
		// Count running tasks exactly like TaskStatus shows spinner:
		// - passed is not true and not false (null/undefined)
		// - AND has activity (startedAt or tokenUsage)
		const running = tasks.filter(
			(t) => t.passed !== true && t.passed !== false && (t.startedAt || tokenUsage.get(t.id)),
		).length
		const pending = tasks.filter(
			(t) => t.passed !== true && t.passed !== false && !t.startedAt && !tokenUsage.get(t.id),
		).length
		const total = tasks.length
		const completed = passed + failed

		let totalTokensIn = 0
		let totalTokensOut = 0
		let totalCost = 0
		let totalDuration = 0

		// Aggregate tool usage from completed tasks
		const toolUsage: ToolUsage = {}

		for (const task of tasks) {
			const metrics = taskMetrics[task.id]
			if (metrics) {
				totalTokensIn += metrics.tokensIn
				totalTokensOut += metrics.tokensOut
				totalCost += metrics.cost
				totalDuration += metrics.duration
			}

			// Aggregate tool usage from finished tasks with taskMetrics
			if (task.finishedAt && task.taskMetrics?.toolUsage) {
				for (const [key, usage] of Object.entries(task.taskMetrics.toolUsage)) {
					const tool = key as keyof ToolUsage
					if (!toolUsage[tool]) {
						toolUsage[tool] = { attempts: 0, failures: 0 }
					}
					toolUsage[tool].attempts += usage.attempts
					toolUsage[tool].failures += usage.failures
				}
			}
		}

		return {
			passed,
			failed,
			running,
			pending,
			total,
			completed,
			passRate: completed > 0 ? ((passed / completed) * 100).toFixed(1) : null,
			totalTokensIn,
			totalTokensOut,
			totalCost,
			totalDuration,
			toolUsage,
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [tasks, taskMetrics, tokenUsage, usageUpdatedAt])

	return (
		<>
			<div>
				<div className="mb-4">
					<div>
						<div className="font-mono">{run.model}</div>
						{run.description && <div className="text-sm text-muted-foreground">{run.description}</div>}
					</div>
					{!run.taskMetricsId && <RunStatus runStatus={runStatus} />}
				</div>

				{stats && (
					<div className="mb-4 p-4 border rounded-lg bg-muted/50">
						{/* Main Stats Row */}
						<div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
							{/* Passed/Failed */}
							<div className="text-center">
								<div className="text-2xl font-bold whitespace-nowrap">
									<span className="text-green-600">{stats.passed}</span>
									<span className="text-muted-foreground mx-1">/</span>
									<span className="text-red-600">{stats.failed}</span>
									{stats.running > 0 && (
										<span className="text-yellow-600 text-sm ml-2">({stats.running})</span>
									)}
								</div>
								<div className="text-xs text-muted-foreground">Passed / Failed</div>
							</div>

							{/* Pass Rate */}
							<div className="text-center">
								<div className="text-2xl font-bold">{stats.passRate ? `${stats.passRate}%` : "-"}</div>
								<div className="text-xs text-muted-foreground">Pass Rate</div>
							</div>

							{/* Tokens */}
							<div className="text-center">
								<div className="text-xl font-bold font-mono whitespace-nowrap">
									{formatTokens(stats.totalTokensIn)}
									<span className="text-muted-foreground mx-1">/</span>
									{formatTokens(stats.totalTokensOut)}
								</div>
								<div className="text-xs text-muted-foreground">Tokens In / Out</div>
							</div>

							{/* Cost */}
							<div className="text-center">
								<div className="text-2xl font-bold font-mono">{formatCurrency(stats.totalCost)}</div>
								<div className="text-xs text-muted-foreground">Cost</div>
							</div>

							{/* Duration */}
							<div className="text-center">
								<div className="text-2xl font-bold font-mono whitespace-nowrap">
									{stats.totalDuration > 0 ? formatDuration(stats.totalDuration) : "-"}
								</div>
								<div className="text-xs text-muted-foreground">Duration</div>
							</div>

							{/* Tool Usage - Inline */}
							{Object.keys(stats.toolUsage).length > 0 && (
								<div className="flex items-center gap-2 flex-wrap">
									{Object.entries(stats.toolUsage)
										.sort(([, a], [, b]) => b.attempts - a.attempts)
										.map(([toolName, usage]) => {
											const abbr = getToolAbbreviation(toolName)
											const successRate =
												usage.attempts > 0
													? ((usage.attempts - usage.failures) / usage.attempts) * 100
													: 100
											const rateColor =
												successRate === 100
													? "text-green-500"
													: successRate >= 80
														? "text-yellow-500"
														: "text-red-500"
											return (
												<Tooltip key={toolName}>
													<TooltipTrigger asChild>
														<div className="flex items-center gap-1 px-2 py-1 rounded bg-background/50 border border-border/50 hover:border-border transition-colors cursor-default text-xs">
															<span className="font-medium text-muted-foreground">
																{abbr}
															</span>
															<span className="font-bold tabular-nums">
																{usage.attempts}
															</span>
															<span className={`${rateColor}`}>
																{formatToolUsageSuccessRate(usage)}
															</span>
														</div>
													</TooltipTrigger>
													<TooltipContent side="bottom">{toolName}</TooltipContent>
												</Tooltip>
											)
										})}
								</div>
							)}
						</div>
					</div>
				)}
				{!tasks ? (
					<LoaderCircle className="size-4 animate-spin" />
				) : (
					<Table className="border">
						<TableHeader>
							<TableRow>
								<TableHead>Exercise</TableHead>
								<TableHead className="text-center">Tokens In / Out</TableHead>
								<TableHead>Context</TableHead>
								<TableHead>Duration</TableHead>
								<TableHead>Cost</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{tasks.map((task) => (
								<TableRow key={task.id}>
									<TableCell>
										<div className="flex items-center gap-2">
											<TaskStatus
												task={task}
												running={!!task.startedAt || !!tokenUsage.get(task.id)}
											/>
											<div>
												{task.language}/{task.exercise}
											</div>
										</div>
									</TableCell>
									{taskMetrics[task.id] ? (
										<>
											<TableCell className="font-mono text-xs">
												<div className="flex items-center justify-evenly">
													<div>{formatTokens(taskMetrics[task.id]!.tokensIn)}</div>/
													<div>{formatTokens(taskMetrics[task.id]!.tokensOut)}</div>
												</div>
											</TableCell>
											<TableCell className="font-mono text-xs">
												{formatTokens(taskMetrics[task.id]!.tokensContext)}
											</TableCell>
											<TableCell className="font-mono text-xs">
												{taskMetrics[task.id]!.duration
													? formatDuration(taskMetrics[task.id]!.duration)
													: "-"}
											</TableCell>
											<TableCell className="font-mono text-xs">
												{formatCurrency(taskMetrics[task.id]!.cost)}
											</TableCell>
										</>
									) : (
										<TableCell colSpan={4} />
									)}
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</div>
		</>
	)
}
