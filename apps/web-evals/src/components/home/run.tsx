import { useCallback, useState, useRef } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Ellipsis, ClipboardList, Copy, Check, LoaderCircle, Trash, Settings } from "lucide-react"

import type { Run as EvalsRun, TaskMetrics as EvalsTaskMetrics } from "@roo-code/evals"
import type { ToolName } from "@roo-code/types"

import { deleteRun } from "@/actions/runs"
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
	DialogHeader,
	DialogTitle,
	ScrollArea,
} from "@/components/ui"

type RunProps = {
	run: EvalsRun
	taskMetrics: EvalsTaskMetrics | null
	toolColumns: ToolName[]
}

export function Run({ run, taskMetrics, toolColumns }: RunProps) {
	const router = useRouter()
	const [deleteRunId, setDeleteRunId] = useState<number>()
	const [showSettings, setShowSettings] = useState(false)
	const continueRef = useRef<HTMLButtonElement>(null)
	const { isPending, copyRun, copied } = useCopyRun(run.id)

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
					{run.passed + run.failed > 0 && (
						<span>{((run.passed / (run.passed + run.failed)) * 100).toFixed(1)}%</span>
					)}
				</TableCell>
				<TableCell>
					{taskMetrics && (
						<div className="flex items-center gap-1">
							<span>{formatTokens(taskMetrics.tokensIn)}</span>/
							<span>{formatTokens(taskMetrics.tokensOut)}</span>
						</div>
					)}
				</TableCell>
				{toolColumns.map((toolName) => {
					const usage = taskMetrics?.toolUsage?.[toolName]
					return (
						<TableCell key={toolName} className="text-xs text-center">
							{usage ? (
								<div className="flex flex-col items-center">
									<span className="font-medium">{usage.attempts}</span>
									<span className="text-muted-foreground">{formatToolUsageSuccessRate(usage)}</span>
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
		</>
	)
}
