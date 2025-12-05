"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowDown, ArrowUp, ArrowUpDown, Rocket } from "lucide-react"

import type { Run, TaskMetrics } from "@roo-code/evals"
import type { ToolName } from "@roo-code/types"

import {
	Button,
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
import { Run as Row } from "@/components/home/run"

type RunWithTaskMetrics = Run & { taskMetrics: TaskMetrics | null }

type SortColumn = "model" | "provider" | "passed" | "failed" | "percent" | "cost" | "duration" | "createdAt"
type SortDirection = "asc" | "desc"

// Generate abbreviation from tool name (e.g., "read_file" -> "RF", "list_code_definition_names" -> "LCDN")
function getToolAbbreviation(toolName: string): string {
	return toolName
		.split("_")
		.map((word) => word[0]?.toUpperCase() ?? "")
		.join("")
}

function SortIcon({
	column,
	sortColumn,
	sortDirection,
}: {
	column: SortColumn
	sortColumn: SortColumn | null
	sortDirection: SortDirection
}) {
	if (sortColumn !== column) {
		return <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />
	}
	return sortDirection === "asc" ? <ArrowUp className="ml-1 h-3 w-3" /> : <ArrowDown className="ml-1 h-3 w-3" />
}

export function Runs({ runs }: { runs: RunWithTaskMetrics[] }) {
	const router = useRouter()
	const [sortColumn, setSortColumn] = useState<SortColumn | null>("createdAt")
	const [sortDirection, setSortDirection] = useState<SortDirection>("desc")

	const handleSort = (column: SortColumn) => {
		if (sortColumn === column) {
			setSortDirection(sortDirection === "asc" ? "desc" : "asc")
		} else {
			setSortColumn(column)
			setSortDirection("desc")
		}
	}

	// Collect all unique tool names from all runs and sort by total attempts
	const toolColumns = useMemo<ToolName[]>(() => {
		const toolTotals = new Map<ToolName, number>()

		for (const run of runs) {
			if (run.taskMetrics?.toolUsage) {
				for (const [toolName, usage] of Object.entries(run.taskMetrics.toolUsage)) {
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
	}, [runs])

	// Sort runs based on current sort column and direction
	const sortedRuns = useMemo(() => {
		if (!sortColumn) return runs

		return [...runs].sort((a, b) => {
			let aVal: string | number | Date | null = null
			let bVal: string | number | Date | null = null

			switch (sortColumn) {
				case "model":
					aVal = a.model
					bVal = b.model
					break
				case "provider":
					aVal = a.settings?.apiProvider ?? ""
					bVal = b.settings?.apiProvider ?? ""
					break
				case "passed":
					aVal = a.passed
					bVal = b.passed
					break
				case "failed":
					aVal = a.failed
					bVal = b.failed
					break
				case "percent":
					aVal = a.passed + a.failed > 0 ? a.passed / (a.passed + a.failed) : 0
					bVal = b.passed + b.failed > 0 ? b.passed / (b.passed + b.failed) : 0
					break
				case "cost":
					aVal = a.taskMetrics?.cost ?? 0
					bVal = b.taskMetrics?.cost ?? 0
					break
				case "duration":
					aVal = a.taskMetrics?.duration ?? 0
					bVal = b.taskMetrics?.duration ?? 0
					break
				case "createdAt":
					aVal = a.createdAt
					bVal = b.createdAt
					break
			}

			if (aVal === null || bVal === null) return 0

			let comparison = 0
			if (typeof aVal === "string" && typeof bVal === "string") {
				comparison = aVal.localeCompare(bVal)
			} else if (aVal instanceof Date && bVal instanceof Date) {
				comparison = aVal.getTime() - bVal.getTime()
			} else {
				comparison = (aVal as number) - (bVal as number)
			}

			return sortDirection === "asc" ? comparison : -comparison
		})
	}, [runs, sortColumn, sortDirection])

	// Calculate colSpan for empty state (7 base columns + dynamic tools + 3 end columns)
	const totalColumns = 7 + toolColumns.length + 3

	return (
		<>
			<Table className="border border-t-0">
				<TableHeader>
					<TableRow>
						<TableHead
							className="max-w-[200px] cursor-pointer select-none"
							onClick={() => handleSort("model")}>
							<div className="flex items-center">
								Model
								<SortIcon column="model" sortColumn={sortColumn} sortDirection={sortDirection} />
							</div>
						</TableHead>
						<TableHead className="cursor-pointer select-none" onClick={() => handleSort("provider")}>
							<div className="flex items-center">
								Provider
								<SortIcon column="provider" sortColumn={sortColumn} sortDirection={sortDirection} />
							</div>
						</TableHead>
						<TableHead className="cursor-pointer select-none" onClick={() => handleSort("createdAt")}>
							<div className="flex items-center">
								Created
								<SortIcon column="createdAt" sortColumn={sortColumn} sortDirection={sortDirection} />
							</div>
						</TableHead>
						<TableHead className="cursor-pointer select-none" onClick={() => handleSort("passed")}>
							<div className="flex items-center">
								Passed
								<SortIcon column="passed" sortColumn={sortColumn} sortDirection={sortDirection} />
							</div>
						</TableHead>
						<TableHead className="cursor-pointer select-none" onClick={() => handleSort("failed")}>
							<div className="flex items-center">
								Failed
								<SortIcon column="failed" sortColumn={sortColumn} sortDirection={sortDirection} />
							</div>
						</TableHead>
						<TableHead className="cursor-pointer select-none" onClick={() => handleSort("percent")}>
							<div className="flex items-center">
								%
								<SortIcon column="percent" sortColumn={sortColumn} sortDirection={sortDirection} />
							</div>
						</TableHead>
						<TableHead>Tokens</TableHead>
						{toolColumns.map((toolName) => (
							<TableHead key={toolName} className="text-xs text-center">
								<Tooltip>
									<TooltipTrigger>{getToolAbbreviation(toolName)}</TooltipTrigger>
									<TooltipContent>{toolName}</TooltipContent>
								</Tooltip>
							</TableHead>
						))}
						<TableHead className="cursor-pointer select-none" onClick={() => handleSort("cost")}>
							<div className="flex items-center">
								Cost
								<SortIcon column="cost" sortColumn={sortColumn} sortDirection={sortDirection} />
							</div>
						</TableHead>
						<TableHead className="cursor-pointer select-none" onClick={() => handleSort("duration")}>
							<div className="flex items-center">
								Duration
								<SortIcon column="duration" sortColumn={sortColumn} sortDirection={sortDirection} />
							</div>
						</TableHead>
						<TableHead></TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{sortedRuns.length ? (
						sortedRuns.map(({ taskMetrics, ...run }) => (
							<Row key={run.id} run={run} taskMetrics={taskMetrics} toolColumns={toolColumns} />
						))
					) : (
						<TableRow>
							<TableCell colSpan={totalColumns} className="text-center">
								No eval runs yet.
								<Button variant="link" onClick={() => router.push("/runs/new")}>
									Launch
								</Button>
								one now.
							</TableCell>
						</TableRow>
					)}
				</TableBody>
			</Table>
			<Button
				variant="default"
				className="absolute top-4 right-12 size-12 rounded-full"
				onClick={() => router.push("/runs/new")}>
				<Rocket className="size-6" />
			</Button>
		</>
	)
}
