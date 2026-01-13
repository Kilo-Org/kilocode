"use client"

import { Link2, Link2Off, CheckCircle2 } from "lucide-react"
import type { RunStatus as _RunStatus } from "@/hooks/use-run-status"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui"

function StreamIcon({ status }: { status: "connected" | "waiting" | "error" }) {
	if (status === "connected") {
		return <Link2 className="size-4 text-green-500" />
	}
	return <Link2Off className={cn("size-4", status === "waiting" ? "text-amber-500" : "text-rose-500")} />
}

export const RunStatus = ({
	runStatus: { sseStatus, heartbeat, runners = [] },
	isComplete = false,
}: {
	runStatus: _RunStatus
	isComplete?: boolean
}) => {
	// For completed runs, show a simple "Complete" badge
	if (isComplete) {
		return (
			<Tooltip>
				<TooltipTrigger asChild>
					<div className="flex items-center gap-1 cursor-default text-muted-foreground">
						<CheckCircle2 className="size-4" />
					</div>
				</TooltipTrigger>
				<TooltipContent side="bottom" className="font-mono text-xs">
					Run complete
				</TooltipContent>
			</Tooltip>
		)
	}

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<div className="flex items-center gap-2 cursor-default text-xs font-mono">
					{/* Task Stream status icon */}
					<StreamIcon status={sseStatus} />

					{/* Task Controller ID */}
					<span className={heartbeat ? "text-green-500" : "text-rose-500"}>{heartbeat ?? "-"}</span>

					{/* Task Runners count */}
					<span className={runners.length > 0 ? "text-green-500" : "text-rose-500"}>
						{runners.length > 0 ? `${runners.length}r` : "0r"}
					</span>
				</div>
			</TooltipTrigger>
			<TooltipContent side="bottom" className="font-mono text-xs max-w-md">
				<div className="space-y-1">
					<div className="flex items-center gap-2">
						<StreamIcon status={sseStatus} />
						<span>Task Stream: {sseStatus}</span>
					</div>
					<div className="flex items-center gap-2">
						<span className={heartbeat ? "text-green-500" : "text-rose-500"}>●</span>
						<span>Task Controller: {heartbeat ?? "dead"}</span>
					</div>
					<div className="flex items-center gap-2">
						<span className={runners.length > 0 ? "text-green-500" : "text-rose-500"}>●</span>
						<span>Task Runners: {runners.length > 0 ? runners.length : "none"}</span>
					</div>
					{runners.length > 0 && (
						<div className="mt-2 pt-2 border-t border-border text-muted-foreground space-y-0.5">
							{runners.map((runner) => (
								<div key={runner}>{runner}</div>
							))}
						</div>
					)}
				</div>
			</TooltipContent>
		</Tooltip>
	)
}
