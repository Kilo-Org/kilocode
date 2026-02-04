import { memo } from "react"
import { ArrowRight } from "lucide-react"
import { vscode } from "@/utils/vscode"
import { cn } from "@/lib/utils"
import type { DisplayHistoryItem } from "./types"
import { StandardTooltip } from "../ui"

interface SubtaskRowProps {
	/** The subtask to display */
	item: DisplayHistoryItem
	/** Optional className for styling */
	className?: string
}

/**
 * Displays an individual subtask row when the parent's subtask list is expanded.
 * Shows the task name and token/cost info in an indented format.
 */
const SubtaskRow = ({ item, className }: SubtaskRowProps) => {
	const handleClick = () => {
		vscode.postMessage({ type: "showTaskWithId", text: item.id })
	}

	return (
		<div
			data-testid={`subtask-row-${item.id}`}
			className={cn(
				"group flex items-center justify-between gap-2 pl-1 pr-4 py-1 ml-6 cursor-pointer",
				"text-vscode-foreground/60 hover:text-vscode-foreground transition-colors",
				className,
			)}
			onClick={handleClick}
			role="button"
			tabIndex={0}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault()
					handleClick()
				}
			}}>
			<StandardTooltip content={item.task} delay={600}>
				<span className="text-sm line-clamp-1">{item.task}</span>
			</StandardTooltip>
			<ArrowRight className="size-3 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
		</div>
	)
}

export default memo(SubtaskRow)
