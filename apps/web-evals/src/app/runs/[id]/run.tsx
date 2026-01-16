"use client"

import { useMemo, useState, useCallback, useEffect, Fragment } from "react"
import { toast } from "sonner"
import { LoaderCircle, FileText, Copy, Check, StopCircle, List, Layers } from "lucide-react"

import type { Run, TaskMetrics as _TaskMetrics, Task } from "@roo-code/evals"
import type { ToolName } from "@roo-code/types"

import { formatCurrency, formatDuration, formatTokens, formatToolUsageSuccessRate } from "@/lib/formatters"
import { useRunStatus } from "@/hooks/use-run-status"
import { killRun } from "@/actions/runs"
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
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	ScrollArea,
	Button,
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui"

import { TaskStatus } from "./task-status"
import { RunStatus } from "./run-status"

type TaskMetrics = Pick<_TaskMetrics, "tokensIn" | "tokensOut" | "tokensContext" | "duration" | "cost">

// Extended Task type with taskMetrics from useRunStatus
type TaskWithMetrics = Task & { taskMetrics: _TaskMetrics | null }

type ToolUsageEntry = { attempts: number; failures: number }
type ToolUsage = Record<string, ToolUsageEntry>

// Generate abbreviation from tool name (e.g., "read_file" -> "RF", "list_code_definition_names" -> "LCDN")
function getToolAbbreviation(toolName: string): string {
	return toolName
		.split("_")
		.map((word) => word[0]?.toUpperCase() ?? "")
		.join("")
}

// Pattern definitions for syntax highlighting
type HighlightPattern = {
	pattern: RegExp
	className: string
	// If true, wraps the entire match; if a number, wraps that capture group
	wrapGroup?: number
}

const HIGHLIGHT_PATTERNS: HighlightPattern[] = [
	// Log levels - styled as badges
	{ pattern: /\|\s*(INFO)\s*\|/g, className: "text-green-400", wrapGroup: 1 },
	{ pattern: /\|\s*(WARN|WARNING)\s*\|/g, className: "text-yellow-400", wrapGroup: 1 },
	{ pattern: /\|\s*(ERROR)\s*\|/g, className: "text-red-400 font-semibold", wrapGroup: 1 },
	{ pattern: /\|\s*(DEBUG)\s*\|/g, className: "text-gray-400", wrapGroup: 1 },
	// Task identifiers - important events
	{
		pattern: /(taskCreated|taskFocused|taskStarted|taskCompleted|taskAborted|taskResumable)/g,
		className: "text-purple-400 font-medium",
	},
	// Tool failures - highlight in red
	{ pattern: /(taskToolFailed)/g, className: "text-red-400 font-bold" },
	{ pattern: /(Tool execution failed|tool.*failed|failed.*tool)/gi, className: "text-red-400" },
	{ pattern: /(EvalPass)/g, className: "text-green-400 font-bold" },
	{ pattern: /(EvalFail)/g, className: "text-red-400 font-bold" },
	// Message arrows
	{ pattern: /→/g, className: "text-cyan-400" },
	// Tool names in quotes
	{ pattern: /"(tool)":\s*"([^"]+)"/g, className: "text-orange-400" },
	// JSON keys
	{ pattern: /"([^"]+)":/g, className: "text-sky-300" },
	// Boolean values
	{ pattern: /:\s*(true|false)/g, className: "text-amber-400", wrapGroup: 1 },
	// Numbers
	{ pattern: /:\s*(-?\d+\.?\d*)/g, className: "text-emerald-400", wrapGroup: 1 },
]

// Extract timestamp from a log line and return elapsed time from baseline
function formatElapsedTime(timestamp: string, baselineMs: number): string {
	const currentMs = new Date(timestamp).getTime()
	const elapsedMs = currentMs - baselineMs
	const totalSeconds = Math.floor(elapsedMs / 1000)
	const minutes = Math.floor(totalSeconds / 60)
	const seconds = totalSeconds % 60
	return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
}

// Extract the first timestamp from the log to use as baseline
function extractFirstTimestamp(log: string): number | null {
	// Match timestamp at start of line: [2025-11-28T09:35:23.187Z | ... or [2025-11-28T09:35:23.187Z]
	const match = log.match(/\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)[\s|\]]/)
	const isoString = match?.[1]
	if (!isoString) return null
	return new Date(isoString).getTime()
}

// Simplify log line by removing redundant metadata
function simplifyLogLine(line: string, baselineMs: number | null): { timestamp: string; simplified: string } {
	// Extract timestamp - matches [2025-11-28T09:35:23.187Z | ... format
	const timestampMatch = line.match(/\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)[\s|\]]/)
	const isoTimestamp = timestampMatch?.[1]
	if (!isoTimestamp) {
		return { timestamp: "", simplified: line }
	}

	const timestamp = baselineMs !== null ? formatElapsedTime(isoTimestamp, baselineMs) : isoTimestamp.slice(11, 19)

	// Remove the timestamp from the line (handles both [timestamp] and [timestamp | formats)
	let simplified = line.replace(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\s*\|?\s*/, "")

	// Remove redundant metadata: pid, run, task IDs (they're same for entire log)
	simplified = simplified.replace(/\|\s*pid:\d+\s*/g, "")
	simplified = simplified.replace(/\|\s*run:\d+\s*/g, "")
	simplified = simplified.replace(/\|\s*task:\d+\s*/g, "")
	simplified = simplified.replace(/runTask\s*\|\s*/g, "")

	// Clean up extra pipes, spaces, and trailing brackets
	simplified = simplified.replace(/\|\s*\|/g, "|")
	simplified = simplified.replace(/^\s*\|\s*/, "")
	simplified = simplified.replace(/\]\s*$/, "") // Remove trailing bracket if present

	return { timestamp, simplified }
}

// Format a single line with syntax highlighting using React elements (XSS-safe)
function formatLine(line: string): React.ReactNode[] {
	// Find all matches with their positions
	type Match = { start: number; end: number; text: string; className: string }
	const matches: Match[] = []

	for (const { pattern, className, wrapGroup } of HIGHLIGHT_PATTERNS) {
		// Reset regex state
		pattern.lastIndex = 0
		let regexMatch
		while ((regexMatch = pattern.exec(line)) !== null) {
			const capturedText = wrapGroup !== undefined ? regexMatch[wrapGroup] : regexMatch[0]
			// Skip if capture group didn't match
			if (!capturedText) continue
			const start =
				wrapGroup !== undefined ? regexMatch.index + regexMatch[0].indexOf(capturedText) : regexMatch.index
			matches.push({
				start,
				end: start + capturedText.length,
				text: capturedText,
				className,
			})
		}
	}

	// Sort matches by position and filter overlapping ones
	matches.sort((a, b) => a.start - b.start)
	const filteredMatches: Match[] = []
	for (const m of matches) {
		const lastMatch = filteredMatches[filteredMatches.length - 1]
		if (!lastMatch || m.start >= lastMatch.end) {
			filteredMatches.push(m)
		}
	}

	// Build result with highlighted spans
	const result: React.ReactNode[] = []
	let currentPos = 0

	for (const [i, m] of filteredMatches.entries()) {
		// Add text before this match
		if (m.start > currentPos) {
			result.push(line.slice(currentPos, m.start))
		}
		// Add highlighted match
		result.push(
			<span key={`${i}-${m.start}`} className={m.className}>
				{m.text}
			</span>,
		)
		currentPos = m.end
	}

	// Add remaining text
	if (currentPos < line.length) {
		result.push(line.slice(currentPos))
	}

	return result.length > 0 ? result : [line]
}

// Determine the visual style for a log line based on its content
function getLineStyle(line: string): string {
	if (line.includes("ERROR")) return "bg-red-950/30 border-l-2 border-red-500"
	if (line.includes("WARN") || line.includes("WARNING")) return "bg-yellow-950/20 border-l-2 border-yellow-500"
	if (line.includes("taskToolFailed")) return "bg-red-950/30 border-l-2 border-red-500"
	if (line.includes("taskStarted") || line.includes("taskCreated")) return "bg-purple-950/20"
	if (line.includes("EvalPass")) return "bg-green-950/30 border-l-2 border-green-500"
	if (line.includes("EvalFail")) return "bg-red-950/30 border-l-2 border-red-500"
	if (line.includes("taskCompleted") || line.includes("taskAborted")) return "bg-blue-950/20"
	return ""
}

// Format log content with basic highlighting (XSS-safe - no dangerouslySetInnerHTML)
function formatLogContent(log: string): React.ReactNode[] {
	const lines = log.split("\n")
	const baselineMs = extractFirstTimestamp(log)

	return lines.map((line, index) => {
		if (!line.trim()) {
			return (
				<div key={index} className="h-2">
					{" "}
				</div>
			)
		}

		const parsed = simplifyLogLine(line, baselineMs)
		const lineStyle = getLineStyle(line)

		return (
			<div key={index} className={`flex hover:bg-white/10 py-0.5 rounded-sm transition-colors ${lineStyle}`}>
				{/* Elapsed time */}
				<span className="text-blue-400 font-mono w-12 flex-shrink-0 tabular-nums text-right pr-2">
					{parsed.timestamp}
				</span>
				{/* Log content - pl-12 ensures wrapped lines are indented under the timestamp */}
				<span className="flex-1 break-words" style={{ textIndent: "-0.5rem", paddingLeft: "0.5rem" }}>
					{formatLine(parsed.simplified)}
				</span>
			</div>
		)
	})
}

export function Run({ run }: { run: Run }) {
	const runStatus = useRunStatus(run)
	const { tasks, tokenUsage, toolUsage, usageUpdatedAt, heartbeat, runners } = runStatus

	const [selectedTask, setSelectedTask] = useState<Task | null>(null)
	const [taskLog, setTaskLog] = useState<string | null>(null)
	const [isLoadingLog, setIsLoadingLog] = useState(false)
	const [copied, setCopied] = useState(false)
	const [showKillDialog, setShowKillDialog] = useState(false)
	const [isKilling, setIsKilling] = useState(false)
	const [groupByStatus, setGroupByStatus] = useState(() => {
		// Initialize from localStorage if available (client-side only)
		if (typeof window !== "undefined") {
			const stored = localStorage.getItem("evals-group-by-status")
			return stored === "true"
		}
		return false
	})

	// Persist groupByStatus to localStorage
	useEffect(() => {
		localStorage.setItem("evals-group-by-status", String(groupByStatus))
	}, [groupByStatus])

	// Determine if run is still active (has heartbeat or runners)
	const isRunActive = !run.taskMetricsId && (!!heartbeat || (runners && runners.length > 0))

	const onKillRun = useCallback(async () => {
		setIsKilling(true)
		try {
			const result = await killRun(run.id)
			if (result.killedContainers.length > 0) {
				toast.success(`Killed ${result.killedContainers.length} container(s)`)
			} else if (result.errors.length === 0) {
				toast.info("No running containers found")
			} else {
				toast.error(result.errors.join(", "))
			}
		} catch (error) {
			console.error("Failed to kill run:", error)
			toast.error("Failed to kill run")
		} finally {
			setIsKilling(false)
			setShowKillDialog(false)
		}
	}, [run.id])

	const onCopyLog = useCallback(async () => {
		if (!taskLog) return

		try {
			await navigator.clipboard.writeText(taskLog)
			setCopied(true)
			toast.success("Log copied to clipboard")
			setTimeout(() => setCopied(false), 2000)
		} catch (error) {
			console.error("Failed to copy log:", error)
			toast.error("Failed to copy log")
		}
	}, [taskLog])

	// Handle ESC key to close the dialog
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape" && selectedTask) {
				setSelectedTask(null)
			}
		}

		document.addEventListener("keydown", handleKeyDown)
		return () => document.removeEventListener("keydown", handleKeyDown)
	}, [selectedTask])

	const taskMetrics: Record<number, TaskMetrics> = useMemo(() => {
		// Reference usageUpdatedAt to trigger recomputation when Map contents change
		void usageUpdatedAt
		const metrics: Record<number, TaskMetrics> = {}

		// Helper to calculate duration from database timestamps when streaming duration
		// is unavailable (e.g., page was loaded after TaskStarted event was published)
		const calculateDurationFromTimestamps = (task: TaskWithMetrics): number => {
			if (!task.startedAt) return 0
			const startTime = new Date(task.startedAt).getTime()
			const endTime = task.finishedAt ? new Date(task.finishedAt).getTime() : Date.now()
			return endTime - startTime
		}

		tasks?.forEach((task) => {
			const streamingUsage = tokenUsage.get(task.id)
			const dbMetrics = task.taskMetrics

			// For finished tasks, prefer DB values but fall back to streaming values
			// This handles race conditions during timeout where DB might not have latest data
			if (task.finishedAt) {
				// Check if DB metrics have meaningful values (not just default/empty)
				const dbHasData = dbMetrics && (dbMetrics.tokensIn > 0 || dbMetrics.tokensOut > 0 || dbMetrics.cost > 0)
				if (dbHasData) {
					// If DB duration is 0 but we have timestamps, calculate from timestamps
					const duration = dbMetrics.duration || calculateDurationFromTimestamps(task)
					metrics[task.id] = { ...dbMetrics, duration }
				} else if (streamingUsage) {
					// Fall back to streaming values if DB is empty/stale
					// Use streaming duration, or calculate from timestamps if not available
					const duration = streamingUsage.duration || calculateDurationFromTimestamps(task)
					metrics[task.id] = {
						tokensIn: streamingUsage.totalTokensIn,
						tokensOut: streamingUsage.totalTokensOut,
						tokensContext: streamingUsage.contextTokens,
						duration,
						cost: streamingUsage.totalCost,
					}
				} else {
					// Task finished but no DB metrics and no streaming data
					// (e.g., page loaded after task completed, metrics not persisted)
					// Still provide duration calculated from timestamps
					metrics[task.id] = {
						tokensIn: 0,
						tokensOut: 0,
						tokensContext: 0,
						duration: calculateDurationFromTimestamps(task),
						cost: 0,
					}
				}
			} else if (streamingUsage) {
				// For running tasks, use streaming values
				// Use streaming duration, or calculate from task.startedAt if not available
				// (happens when page loads after TaskStarted event was already published)
				const duration = streamingUsage.duration || calculateDurationFromTimestamps(task)
				metrics[task.id] = {
					tokensIn: streamingUsage.totalTokensIn,
					tokensOut: streamingUsage.totalTokensOut,
					tokensContext: streamingUsage.contextTokens,
					duration,
					cost: streamingUsage.totalCost,
				}
			} else if (task.startedAt) {
				// Task has started (has startedAt in DB) but no streaming data yet
				// This can happen when page loads after TaskStarted but before TokenUsageUpdated
				metrics[task.id] = {
					tokensIn: 0,
					tokensOut: 0,
					tokensContext: 0,
					duration: calculateDurationFromTimestamps(task),
					cost: 0,
				}
			}
		})

		return metrics
	}, [tasks, tokenUsage, usageUpdatedAt])

	const onViewTaskLog = useCallback(
		async (task: Task) => {
			// Only allow viewing logs for tasks that have started.
			// Note: we treat presence of derived metrics as evidence of a started task,
			// since this page may be rendered without streaming `tokenUsage` populated.
			const hasStarted = !!task.startedAt || !!tokenUsage.get(task.id) || !!taskMetrics[task.id]
			if (!hasStarted) {
				toast.error("Task has not started yet")
				return
			}

			setSelectedTask(task)
			setIsLoadingLog(true)
			setTaskLog(null)

			try {
				const response = await fetch(`/api/runs/${run.id}/logs/${task.id}`)

				if (!response.ok) {
					const error = await response.json()
					toast.error(error.error || "Failed to load log")
					setSelectedTask(null)
					return
				}

				const data = await response.json()
				setTaskLog(data.logContent)
			} catch (error) {
				console.error("Error loading task log:", error)
				toast.error("Failed to load log")
				setSelectedTask(null)
			} finally {
				setIsLoadingLog(false)
			}
		},
		[run.id, tokenUsage, taskMetrics],
	)

	// Collect all unique tool names from all tasks and sort by total attempts
	const toolColumns = useMemo<ToolName[]>(() => {
		// Reference usageUpdatedAt to trigger recomputation when Map contents change
		void usageUpdatedAt
		if (!tasks) return []

		const toolTotals = new Map<ToolName, number>()

		for (const task of tasks) {
			// Get both DB and streaming values
			const dbToolUsage = task.taskMetrics?.toolUsage
			const streamingToolUsage = toolUsage.get(task.id)

			// For finished tasks, prefer DB values but fall back to streaming values
			// For running tasks, use streaming values
			// This handles race conditions during timeout where DB might not have latest data
			const taskToolUsage = task.finishedAt
				? dbToolUsage && Object.keys(dbToolUsage).length > 0
					? dbToolUsage
					: streamingToolUsage
				: streamingToolUsage

			if (taskToolUsage) {
				for (const [toolName, usage] of Object.entries(taskToolUsage)) {
					const tool = toolName as ToolName
					const current = toolTotals.get(tool) ?? 0
					toolTotals.set(tool, current + usage.attempts)
				}
			}
		}

		// Sort by total attempts descending
		return Array.from(toolTotals.entries())
			.sort((a, b) => b[1] - a[1])
			.map(([name]): ToolName => name)
		// toolUsage ref is stable; usageUpdatedAt triggers recomputation when Map contents change
	}, [tasks, toolUsage, usageUpdatedAt])

	// Compute aggregate stats
	const stats = useMemo(() => {
		// Reference usageUpdatedAt to trigger recomputation when Map contents change
		void usageUpdatedAt
		if (!tasks) return null

		const passed = tasks.filter((t) => t.passed === true).length
		const failed = tasks.filter((t) => t.passed === false).length
		const completed = passed + failed

		let totalTokensIn = 0
		let totalTokensOut = 0
		let totalCost = 0
		let totalDuration = 0

		// Aggregate tool usage from all tasks (both finished and running)
		const toolUsageAggregate: ToolUsage = {}

		for (const task of tasks) {
			const metrics = taskMetrics[task.id]
			if (metrics) {
				totalTokensIn += metrics.tokensIn
				totalTokensOut += metrics.tokensOut
				totalCost += metrics.cost
				totalDuration += metrics.duration
			}

			// Aggregate tool usage: prefer DB values for finished tasks, fall back to streaming values
			// This handles race conditions during timeout where DB might not have latest data
			const dbToolUsage = task.taskMetrics?.toolUsage
			const streamingToolUsage = toolUsage.get(task.id)
			const taskToolUsage = task.finishedAt
				? dbToolUsage && Object.keys(dbToolUsage).length > 0
					? dbToolUsage
					: streamingToolUsage
				: streamingToolUsage

			if (taskToolUsage) {
				for (const [key, usage] of Object.entries(taskToolUsage)) {
					const tool = key as keyof ToolUsage
					if (!toolUsageAggregate[tool]) {
						toolUsageAggregate[tool] = { attempts: 0, failures: 0 }
					}
					toolUsageAggregate[tool].attempts += usage.attempts
					toolUsageAggregate[tool].failures += usage.failures
				}
			}
		}

		const remaining = tasks.length - completed

		return {
			passed,
			failed,
			completed,
			remaining,
			passRate: completed > 0 ? ((passed / completed) * 100).toFixed(1) : null,
			totalTokensIn,
			totalTokensOut,
			totalCost,
			totalDuration,
			toolUsage: toolUsageAggregate,
		}
		// Map refs are stable; usageUpdatedAt triggers recomputation when Map contents change
	}, [tasks, taskMetrics, toolUsage, usageUpdatedAt])

	// Calculate elapsed time (wall-clock time from run creation to completion or now)
	const elapsedTime = useMemo(() => {
		// Reference usageUpdatedAt to trigger recomputation for live elapsed time updates
		void usageUpdatedAt
		if (!tasks || tasks.length === 0) return null

		const startTime = new Date(run.createdAt).getTime()

		// If run is complete, find the latest finishedAt from tasks
		if (run.taskMetricsId) {
			const latestFinish = tasks.reduce((latest, task) => {
				if (task.finishedAt) {
					const finishTime = new Date(task.finishedAt).getTime()
					return finishTime > latest ? finishTime : latest
				}
				return latest
			}, startTime)
			return latestFinish - startTime
		}

		// If still running, use current time
		return Date.now() - startTime
	}, [tasks, run.createdAt, run.taskMetricsId, usageUpdatedAt])

	// Task status categories
	type TaskStatusCategory = "failed" | "in_progress" | "passed" | "not_started"

	const getTaskStatusCategory = useCallback(
		(task: TaskWithMetrics): TaskStatusCategory => {
			if (task.passed === false) return "failed"
			if (task.passed === true) return "passed"
			// Check streaming data, DB metrics, or startedAt timestamp
			const hasStarted = !!task.startedAt || !!tokenUsage.get(task.id) || !!taskMetrics[task.id]
			if (hasStarted) return "in_progress"
			return "not_started"
		},
		[tokenUsage, taskMetrics],
	)

	// Group tasks by status while preserving original index
	const groupedTasks = useMemo(() => {
		if (!tasks || !groupByStatus) return null

		const groups: Record<TaskStatusCategory, Array<{ task: TaskWithMetrics; originalIndex: number }>> = {
			failed: [],
			in_progress: [],
			passed: [],
			not_started: [],
		}

		tasks.forEach((task, index) => {
			const status = getTaskStatusCategory(task)
			groups[status].push({ task, originalIndex: index })
		})

		return groups
	}, [tasks, groupByStatus, getTaskStatusCategory])

	const statusLabels = useMemo(
		(): Record<TaskStatusCategory, { label: string; className: string; count: number }> => ({
			failed: { label: "Failed", className: "text-red-500", count: groupedTasks?.failed.length ?? 0 },
			in_progress: {
				label: "In Progress",
				className: "text-yellow-500",
				count: groupedTasks?.in_progress.length ?? 0,
			},
			passed: { label: "Passed", className: "text-green-500", count: groupedTasks?.passed.length ?? 0 },
			not_started: {
				label: "Not Started",
				className: "text-muted-foreground",
				count: groupedTasks?.not_started.length ?? 0,
			},
		}),
		[groupedTasks],
	)

	const statusOrder: TaskStatusCategory[] = ["failed", "in_progress", "passed", "not_started"]

	// Helper to render a task row
	const renderTaskRow = (task: TaskWithMetrics, originalIndex: number) => {
		const hasStarted = !!task.startedAt || !!tokenUsage.get(task.id) || !!taskMetrics[task.id]
		return (
			<TableRow
				key={task.id}
				className={`${hasStarted ? "cursor-pointer hover:bg-muted/50" : ""} ${task.passed === false ? "bg-red-950/30 border-l-2 border-l-red-500" : ""}`}
				onClick={() => hasStarted && onViewTaskLog(task)}>
				<TableCell className="text-center text-muted-foreground font-mono text-xs">
					{originalIndex + 1}
				</TableCell>
				<TableCell>
					<div className="flex items-center gap-2">
						<TaskStatus task={task} running={hasStarted} />
						<div className="flex items-center gap-2">
							<span>
								{task.language}/{task.exercise}
								{task.iteration > 1 && (
									<span className="text-muted-foreground ml-1">(#{task.iteration})</span>
								)}
							</span>
							{hasStarted && (
								<Tooltip>
									<TooltipTrigger asChild>
										<FileText className="size-3 text-muted-foreground" />
									</TooltipTrigger>
									<TooltipContent>Click to view log</TooltipContent>
								</Tooltip>
							)}
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
						{toolColumns.map((toolName) => {
							const dbUsage = task.taskMetrics?.toolUsage?.[toolName]
							const streamingUsage = toolUsage.get(task.id)?.[toolName]
							const usage = task.finishedAt ? (dbUsage ?? streamingUsage) : streamingUsage

							const successRate =
								usage && usage.attempts > 0
									? ((usage.attempts - usage.failures) / usage.attempts) * 100
									: 100
							const rateColor =
								successRate === 100
									? "text-muted-foreground"
									: successRate >= 80
										? "text-yellow-500"
										: "text-red-500"
							return (
								<TableCell key={toolName} className="text-xs text-center">
									{usage ? (
										<div className="flex flex-col items-center">
											<span className="font-medium">{usage.attempts}</span>
											<span className={rateColor}>{formatToolUsageSuccessRate(usage)}</span>
										</div>
									) : (
										<span className="text-muted-foreground">-</span>
									)}
								</TableCell>
							)
						})}
						<TableCell className="font-mono text-xs">
							{taskMetrics[task.id]!.duration ? formatDuration(taskMetrics[task.id]!.duration) : "-"}
						</TableCell>
						<TableCell className="font-mono text-xs">
							{formatCurrency(taskMetrics[task.id]!.cost)}
						</TableCell>
					</>
				) : (
					<TableCell colSpan={5 + toolColumns.length} />
				)}
			</TableRow>
		)
	}

	return (
		<>
			<div>
				{!tasks ? (
					<LoaderCircle className="size-4 animate-spin" />
				) : (
					<>
						{/* View Toggle */}
						<div className="flex justify-end mb-2">
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										variant="outline"
										size="sm"
										onClick={() => setGroupByStatus(!groupByStatus)}
										className="flex items-center gap-2">
										{groupByStatus ? (
											<>
												<List className="size-4" />
												<span>Show Order</span>
											</>
										) : (
											<>
												<Layers className="size-4" />
												<span>Group by Status</span>
											</>
										)}
									</Button>
								</TooltipTrigger>
								<TooltipContent>
									{groupByStatus ? "Show tasks in run order" : "Group tasks by status"}
								</TooltipContent>
							</Tooltip>
						</div>
						<Table className="border">
							<TableHeader className="sticky top-0 z-10">
								{stats && (
									<TableRow>
										<TableHead colSpan={6 + toolColumns.length} className="bg-muted p-4">
											{/* Provider, Model title and status */}
											<div className="flex items-center justify-center gap-3 mb-3 relative">
												{run.settings?.apiProvider && (
													<span className="text-sm text-muted-foreground">
														{run.settings.apiProvider}
													</span>
												)}
												<div className="font-mono">{run.model}</div>
												<RunStatus runStatus={runStatus} isComplete={!!run.taskMetricsId} />
												{run.description && (
													<span className="text-sm text-muted-foreground">
														- {run.description}
													</span>
												)}
												{isRunActive && (
													<Tooltip>
														<TooltipTrigger asChild>
															<Button
																variant="ghost"
																size="sm"
																onClick={() => setShowKillDialog(true)}
																disabled={isKilling}
																className="absolute right-0 flex items-center gap-1 text-muted-foreground hover:text-destructive">
																{isKilling ? (
																	<LoaderCircle className="size-4 animate-spin" />
																) : (
																	<StopCircle className="size-4" />
																)}
																Kill
															</Button>
														</TooltipTrigger>
														<TooltipContent>
															Stop all containers for this run
														</TooltipContent>
													</Tooltip>
												)}
											</div>
											{/* Main Stats Row */}
											<div className="flex items-start justify-center gap-x-8 gap-y-3">
												{/* Pass Rate / Fail Rate / Remaining % */}
												<div className="text-center min-w-[160px]">
													<div className="text-2xl font-bold whitespace-nowrap">
														<span className="text-green-600">
															{stats.completed > 0
																? `${((stats.passed / stats.completed) * 100).toFixed(1)}%`
																: "-"}
														</span>
														<span className="text-muted-foreground mx-1">/</span>
														<span className="text-red-600">
															{stats.completed > 0
																? `${((stats.failed / stats.completed) * 100).toFixed(1)}%`
																: "-"}
														</span>
														<span className="text-muted-foreground mx-1">/</span>
														<span className="text-muted-foreground">
															{tasks.length > 0
																? `${((stats.remaining / tasks.length) * 100).toFixed(1)}%`
																: "-"}
														</span>
													</div>
													<div className="text-xs text-muted-foreground">
														<span className="text-green-600">{stats.passed}</span>
														{" / "}
														<span className="text-red-600">{stats.failed}</span>
														{" / "}
														<span>{stats.remaining}</span>
														{" of "}
														{tasks.length}
													</div>
												</div>

												{/* Tokens */}
												<div className="text-center min-w-[140px]">
													<div className="text-xl font-bold font-mono whitespace-nowrap">
														{formatTokens(stats.totalTokensIn)}
														<span className="text-muted-foreground mx-1">/</span>
														{formatTokens(stats.totalTokensOut)}
													</div>
													<div className="text-xs text-muted-foreground">Tokens In / Out</div>
												</div>

												{/* Cost */}
												<div className="text-center min-w-[70px]">
													<div className="text-2xl font-bold font-mono">
														{formatCurrency(stats.totalCost)}
													</div>
													<div className="text-xs text-muted-foreground">Cost</div>
												</div>

												{/* Duration */}
												<div className="text-center min-w-[90px]">
													<div className="text-2xl font-bold font-mono whitespace-nowrap">
														{stats.totalDuration > 0
															? formatDuration(stats.totalDuration)
															: "-"}
													</div>
													<div className="text-xs text-muted-foreground">Duration</div>
												</div>

												{/* Elapsed Time */}
												<div className="text-center min-w-[90px]">
													<div className="text-2xl font-bold font-mono whitespace-nowrap">
														{elapsedTime !== null ? formatDuration(elapsedTime) : "-"}
													</div>
													<div className="text-xs text-muted-foreground">Elapsed</div>
												</div>

												{/* Estimated Time Remaining - only show if run is active and we have data */}
												{!run.taskMetricsId &&
													elapsedTime !== null &&
													stats.completed > 0 &&
													stats.remaining > 0 && (
														<div className="text-center min-w-[90px]">
															<div className="text-2xl font-bold font-mono whitespace-nowrap text-muted-foreground">
																~
																{formatDuration(
																	(elapsedTime / stats.completed) * stats.remaining,
																)}
															</div>
															<div className="text-xs text-muted-foreground">
																Est. Remaining
															</div>
														</div>
													)}
											</div>

											{/* Tool Usage Row */}
											{Object.keys(stats.toolUsage).length > 0 && (
												<div className="flex items-center justify-center gap-2 flex-wrap mt-3">
													{Object.entries(stats.toolUsage)
														.sort(([, a], [, b]) => b.attempts - a.attempts)
														.map(([toolName, usage]) => {
															const abbr = getToolAbbreviation(toolName)
															const successRate =
																usage.attempts > 0
																	? ((usage.attempts - usage.failures) /
																			usage.attempts) *
																		100
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
																	<TooltipContent side="bottom">
																		{toolName}
																	</TooltipContent>
																</Tooltip>
															)
														})}
												</div>
											)}
										</TableHead>
									</TableRow>
								)}
								<TableRow>
									<TableHead className="w-12 text-center">#</TableHead>
									<TableHead>Exercise</TableHead>
									<TableHead className="text-center">Tokens In / Out</TableHead>
									<TableHead>Context</TableHead>
									{toolColumns.map((toolName) => (
										<TableHead key={toolName} className="text-xs text-center">
											<Tooltip>
												<TooltipTrigger>{getToolAbbreviation(toolName)}</TooltipTrigger>
												<TooltipContent>{toolName}</TooltipContent>
											</Tooltip>
										</TableHead>
									))}
									<TableHead>Duration</TableHead>
									<TableHead>Cost</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{groupByStatus && groupedTasks
									? // Grouped view
										statusOrder.map((status) => {
											const group = groupedTasks[status]
											if (group.length === 0) return null
											const { label, className } = statusLabels[status]
											return (
												<Fragment key={status}>
													<TableRow className="bg-muted/50 hover:bg-muted/50">
														<TableCell colSpan={6 + toolColumns.length} className="py-2">
															<span className={`font-semibold ${className}`}>
																{label} ({group.length})
															</span>
														</TableCell>
													</TableRow>
													{group.map(({ task, originalIndex }) =>
														renderTaskRow(task, originalIndex),
													)}
												</Fragment>
											)
										})
									: // Default order view
										tasks.map((task, index) => renderTaskRow(task, index))}
							</TableBody>
						</Table>
					</>
				)}
			</div>

			{/* Task Log Dialog - Full Screen */}
			<Dialog open={!!selectedTask} onOpenChange={() => setSelectedTask(null)}>
				<DialogContent className="w-[95vw] !max-w-[95vw] h-[90vh] flex flex-col">
					<DialogHeader className="flex-shrink-0">
						<div className="flex items-center justify-between pr-8">
							<DialogTitle className="flex items-center gap-2">
								<FileText className="size-4" />
								{selectedTask?.language}/{selectedTask?.exercise}
								{selectedTask?.iteration && selectedTask.iteration > 1 && (
									<span className="text-muted-foreground">(#{selectedTask.iteration})</span>
								)}
								<span
									className={`ml-2 text-sm ${
										selectedTask?.passed === true
											? "text-green-600"
											: selectedTask?.passed === false
												? "text-red-600"
												: "text-yellow-500"
									}`}>
									(
									{selectedTask?.passed === true
										? "Passed"
										: selectedTask?.passed === false
											? "Failed"
											: "Running"}
									)
								</span>
							</DialogTitle>
							{taskLog && (
								<Button
									variant="outline"
									size="sm"
									onClick={onCopyLog}
									className="flex items-center gap-1">
									{copied ? (
										<>
											<Check className="size-4" />
											Copied!
										</>
									) : (
										<>
											<Copy className="size-4" />
											Copy Log
										</>
									)}
								</Button>
							)}
						</div>
					</DialogHeader>
					<div className="flex-1 min-h-0 overflow-hidden">
						{isLoadingLog ? (
							<div className="flex items-center justify-center h-full">
								<LoaderCircle className="size-6 animate-spin" />
							</div>
						) : taskLog ? (
							<ScrollArea className="h-full w-full">
								<div className="text-xs font-mono bg-muted p-4 rounded-md overflow-x-auto">
									{formatLogContent(taskLog)}
								</div>
							</ScrollArea>
						) : (
							<div className="flex items-center justify-center h-full text-muted-foreground">
								Log file not available (may have been cleared)
							</div>
						)}
					</div>
				</DialogContent>
			</Dialog>

			{/* Kill Run Confirmation Dialog */}
			<AlertDialog open={showKillDialog} onOpenChange={setShowKillDialog}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Kill Run?</AlertDialogTitle>
						<AlertDialogDescription>
							This will stop the controller and all task runner containers for this run. Any running tasks
							will be terminated immediately. This action cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={isKilling}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={onKillRun}
							disabled={isKilling}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
							{isKilling ? (
								<>
									<LoaderCircle className="size-4 animate-spin mr-2" />
									Killing...
								</>
							) : (
								"Kill Run"
							)}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	)
}
