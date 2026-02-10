import { useCallback, useState, useRef } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Ellipsis, ClipboardList, Copy, Check, LoaderCircle, Trash, Settings, FileDown, StickyNote } from "lucide-react"

import type { Run as EvalsRun, TaskMetrics as EvalsTaskMetrics } from "@roo-code/evals"
import type { ToolName } from "@roo-code/types"

import { deleteRun, updateRunDescription } from "@/actions/runs"
import {
	formatCurrency,
	formatDateTime,
	formatDuration,
	formatTokens,
	formatToolUsageSuccessRate,
} from "@/lib/formatters"
import { useCopyRun } from "@/hooks/use-copy-run"
import {
	Button,
	TableCell,
	TableRow,
	Textarea,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	ScrollArea,
} from "@/components/ui"

// Tool group type (same as in runs.tsx)
type ToolGroup = {
	id: string
	name: string
	icon: string
	tools: string[]
}

type RunProps = {
	run: EvalsRun
	taskMetrics: EvalsTaskMetrics | null
	toolColumns: ToolName[]
	toolGroups: ToolGroup[]
}

export function Run({ run, taskMetrics, toolColumns, toolGroups }: RunProps) {
	const router = useRouter()
	const [deleteRunId, setDeleteRunId] = useState<number>()
	const [showSettings, setShowSettings] = useState(false)
	const [isExportingLogs, setIsExportingLogs] = useState(false)
	const [showNotesDialog, setShowNotesDialog] = useState(false)
	const [editingDescription, setEditingDescription] = useState(run.description ?? "")
	const [isSavingNotes, setIsSavingNotes] = useState(false)
	const continueRef = useRef<HTMLButtonElement>(null)
	const { isPending, copyRun, copied } = useCopyRun(run.id)

	const hasDescription = Boolean(run.description && run.description.trim().length > 0)

	const handleSaveDescription = useCallback(async () => {
		setIsSavingNotes(true)
		try {
			const result = await updateRunDescription(run.id, editingDescription.trim() || null)
			if (result.success) {
				toast.success("Description saved")
				setShowNotesDialog(false)
				router.refresh()
			} else {
				toast.error("Failed to save description")
			}
		} catch (error) {
			console.error("Error saving description:", error)
			toast.error("Failed to save description")
		} finally {
			setIsSavingNotes(false)
		}
	}, [run.id, editingDescription, router])

	const onExportFailedLogs = useCallback(async () => {
		if (run.failed === 0) {
			toast.error("No failed tasks to export")
			return
		}

		setIsExportingLogs(true)
		try {
			const response = await fetch(`/api/runs/${run.id}/logs/failed`)

			if (!response.ok) {
				const error = await response.json()
				toast.error(error.error || "Failed to export logs")
				return
			}

			// Download the zip file
			const blob = await response.blob()
			const url = window.URL.createObjectURL(blob)
			const a = document.createElement("a")
			a.href = url
			a.download = `run-${run.id}-failed-logs.zip`
			document.body.appendChild(a)
			a.click()
			window.URL.revokeObjectURL(url)
			document.body.removeChild(a)

			toast.success("Failed logs exported successfully")
		} catch (error) {
			console.error("Error exporting logs:", error)
			toast.error("Failed to export logs")
		} finally {
			setIsExportingLogs(false)
		}
	}, [run.id, run.failed])

	const onConfirmDelete = useCallback(async () => {
		if (!deleteRunId) {
			return
		}

		try {
			await deleteRun(deleteRunId)
			setDeleteRunId(undefined)
		} catch (error) {
			console.error(error)
		}
	}, [deleteRunId])

	const handleRowClick = useCallback(
		(e: React.MouseEvent) => {
			// Don't navigate if clicking on the dropdown menu
			if ((e.target as HTMLElement).closest("[data-dropdown-trigger]")) {
				return
			}
			router.push(`/runs/${run.id}`)
		},
		[router, run.id],
	)

	// Helper to render a tool group cell
	const renderToolGroupCell = (group: ToolGroup) => {
		if (!taskMetrics?.toolUsage) {
			return <span className="text-muted-foreground">-</span>
		}

		let totalAttempts = 0
		let totalFailures = 0
		const breakdown: Array<{ tool: string; attempts: number; rate: string }> = []

		for (const toolName of group.tools) {
			const usage = taskMetrics.toolUsage[toolName as ToolName]
			if (usage) {
				totalAttempts += usage.attempts
				totalFailures += usage.failures
				const rate =
					usage.attempts > 0
						? `${Math.round(((usage.attempts - usage.failures) / usage.attempts) * 100)}%`
						: "0%"
				breakdown.push({ tool: toolName, attempts: usage.attempts, rate })
			}
		}

		if (totalAttempts === 0) {
			return <span className="text-muted-foreground">-</span>
		}

		const successRate = ((totalAttempts - totalFailures) / totalAttempts) * 100
		const rateColor =
			successRate === 100 ? "text-muted-foreground" : successRate >= 80 ? "text-yellow-500" : "text-red-500"

		return (
			<Tooltip>
				<TooltipTrigger>
					<div className="flex flex-col items-center">
						<span className="font-medium">{totalAttempts}</span>
						<span className={rateColor}>{Math.round(successRate)}%</span>
					</div>
				</TooltipTrigger>
				<TooltipContent>
					<div className="text-xs">
						<div className="font-semibold mb-1">{group.name}</div>
						{breakdown.map(({ tool, attempts, rate }) => (
							<div key={tool} className="flex justify-between gap-4">
								<span>{tool}:</span>
								<span>
									{attempts} ({rate})
								</span>
							</div>
						))}
					</div>
				</TooltipContent>
			</Tooltip>
		)
	}

	return (
		<>
			<TableRow className="cursor-pointer hover:bg-muted/50" onClick={handleRowClick}>
				<TableCell className="max-w-[200px] truncate">{run.model}</TableCell>
				<TableCell>{run.settings?.apiProvider ?? "-"}</TableCell>
				<TableCell className="text-sm text-muted-foreground whitespace-nowrap">
					{formatDateTime(run.createdAt)}
				</TableCell>
				<TableCell>{run.passed}</TableCell>
				<TableCell>{run.failed}</TableCell>
				<TableCell>
					{run.passed + run.failed > 0 &&
						(() => {
							const percent = (run.passed / (run.passed + run.failed)) * 100
							const colorClass =
								percent === 100 ? "text-green-500" : percent >= 80 ? "text-yellow-500" : "text-red-500"
							return <span className={colorClass}>{percent.toFixed(1)}%</span>
						})()}
				</TableCell>
				<TableCell>
					{taskMetrics && (
						<div className="flex items-center gap-1">
							<span>{formatTokens(taskMetrics.tokensIn)}</span>/
							<span>{formatTokens(taskMetrics.tokensOut)}</span>
						</div>
					)}
				</TableCell>
				{/* Tool Group Columns */}
				{toolGroups.map((group) => (
					<TableCell key={group.id} className="text-xs text-center">
						{renderToolGroupCell(group)}
					</TableCell>
				))}
				{toolColumns.map((toolName) => {
					const usage = taskMetrics?.toolUsage?.[toolName]
					const successRate =
						usage && usage.attempts > 0 ? ((usage.attempts - usage.failures) / usage.attempts) * 100 : 100
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
				<TableCell>{taskMetrics && formatCurrency(taskMetrics.cost)}</TableCell>
				<TableCell>{taskMetrics && formatDuration(taskMetrics.duration)}</TableCell>
				<TableCell onClick={(e) => e.stopPropagation()}>
					<div className="flex items-center gap-1">
						{/* Note Icon */}
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									variant="ghost"
									size="icon"
									className={hasDescription ? "" : "opacity-30 hover:opacity-60"}
									onClick={(e) => {
										e.stopPropagation()
										setEditingDescription(run.description ?? "")
										setShowNotesDialog(true)
									}}>
									<StickyNote className="h-4 w-4" />
								</Button>
							</TooltipTrigger>
							<TooltipContent className="max-w-[300px]">
								{hasDescription ? (
									<div className="whitespace-pre-wrap">{run.description}</div>
								) : (
									<div className="text-muted-foreground">No description. Click to add one.</div>
								)}
							</TooltipContent>
						</Tooltip>

						{/* More Actions Menu */}
						<DropdownMenu>
							<Button variant="ghost" size="icon" asChild>
								<DropdownMenuTrigger data-dropdown-trigger>
									<Ellipsis />
								</DropdownMenuTrigger>
							</Button>
							<DropdownMenuContent align="end">
								<DropdownMenuItem asChild>
									<Link href={`/runs/${run.id}`}>
										<div className="flex items-center gap-1">
											<ClipboardList />
											<div>View Tasks</div>
										</div>
									</Link>
								</DropdownMenuItem>
								{run.settings && (
									<DropdownMenuItem onClick={() => setShowSettings(true)}>
										<div className="flex items-center gap-1">
											<Settings />
											<div>View Settings</div>
										</div>
									</DropdownMenuItem>
								)}
								{run.taskMetricsId && (
									<DropdownMenuItem onClick={() => copyRun()} disabled={isPending || copied}>
										<div className="flex items-center gap-1">
											{isPending ? (
												<>
													<LoaderCircle className="animate-spin" />
													Copying...
												</>
											) : copied ? (
												<>
													<Check />
													Copied!
												</>
											) : (
												<>
													<Copy />
													Copy to Production
												</>
											)}
										</div>
									</DropdownMenuItem>
								)}
								{run.failed > 0 && (
									<DropdownMenuItem onClick={onExportFailedLogs} disabled={isExportingLogs}>
										<div className="flex items-center gap-1">
											{isExportingLogs ? (
												<>
													<LoaderCircle className="animate-spin" />
													Exporting...
												</>
											) : (
												<>
													<FileDown />
													Export Failed Logs
												</>
											)}
										</div>
									</DropdownMenuItem>
								)}
								<DropdownMenuItem
									onClick={() => {
										setDeleteRunId(run.id)
										setTimeout(() => continueRef.current?.focus(), 0)
									}}>
									<div className="flex items-center gap-1">
										<Trash />
										<div>Delete</div>
									</div>
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</TableCell>
			</TableRow>
			<AlertDialog open={!!deleteRunId} onOpenChange={() => setDeleteRunId(undefined)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Are you sure?</AlertDialogTitle>
						<AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction ref={continueRef} onClick={onConfirmDelete}>
							Continue
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
			<Dialog open={showSettings} onOpenChange={setShowSettings}>
				<DialogContent className="max-w-2xl max-h-[80vh]">
					<DialogHeader>
						<DialogTitle>Run Settings</DialogTitle>
					</DialogHeader>
					<ScrollArea className="max-h-[60vh]">
						<pre className="text-xs font-mono bg-muted p-4 rounded-md overflow-auto">
							{JSON.stringify(run.settings, null, 2)}
						</pre>
					</ScrollArea>
				</DialogContent>
			</Dialog>

			{/* Notes/Description Dialog */}
			<Dialog open={showNotesDialog} onOpenChange={setShowNotesDialog}>
				<DialogContent className="max-w-lg">
					<DialogHeader>
						<DialogTitle>Run Description</DialogTitle>
					</DialogHeader>
					<div className="space-y-4">
						<Textarea
							placeholder="Add a description or notes for this run..."
							value={editingDescription}
							onChange={(e) => setEditingDescription(e.target.value)}
							rows={4}
							className="resize-none"
						/>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setShowNotesDialog(false)}>
							Cancel
						</Button>
						<Button onClick={handleSaveDescription} disabled={isSavingNotes}>
							{isSavingNotes ? (
								<>
									<LoaderCircle className="h-4 w-4 mr-2 animate-spin" />
									Saving...
								</>
							) : (
								"Save"
							)}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	)
}
