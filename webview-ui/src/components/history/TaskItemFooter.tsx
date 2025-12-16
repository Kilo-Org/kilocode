import { formatTimeAgo } from "@/utils/format"
import type { HistoryItem } from "@roo-code/types"
import React from "react"
import { StandardTooltip } from "../ui/standard-tooltip"
import { CopyButton } from "./CopyButton"
import { DeleteButton } from "./DeleteButton"
// import { ExportButton } from "./ExportButton"

export interface TaskItemFooterProps {
	item: HistoryItem
	variant: "compact" | "full"
	isSelectionMode?: boolean
	onDelete?: (taskId: string) => void
}

const TaskItemFooter: React.FC<TaskItemFooterProps> = ({
	item,
	// variant,
	isSelectionMode = false,
	onDelete,
}) => {
	return (
		<div className="text-xs text-vscode-descriptionForeground flex justify-end items-center">
			<div className="flex gap-2 items-center text-vscode-descriptionForeground/60">
				{/* Datetime with time-ago format */}
				<StandardTooltip content={new Date(item.ts).toLocaleString()}>
					<span className="first-letter:uppercase">{formatTimeAgo(item.ts)}</span>
				</StandardTooltip>
				{/* <span>·</span> */}
				{/* Cost
				{!!item.totalCost && (
					<span className="flex items-center" data-testid="cost-footer-compact">
						{"$" + item.totalCost.toFixed(2)}
					</span>
				)} */}
			</div>

			{/* Action Buttons for non-compact view */}
			{!isSelectionMode && (
				<div className="flex flex-row gap-1 items-center text-vscode-descriptionForeground/60 hover:text-vscode-descriptionForeground">
					<CopyButton itemTask={item.task} />
					{/* <FavoriteButton isFavorited={item.isFavorited ?? false} id={item.id} /> */}
					{/* {variant === "full" && <ExportButton itemId={item.id} />} */}
					{onDelete && <DeleteButton itemId={item.id} onDelete={onDelete} />}
				</div>
			)}
		</div>
	)
}

export default TaskItemFooter
