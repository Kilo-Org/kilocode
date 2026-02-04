import React from "react"
import type { HistoryItem } from "@roo-code/types"
import { formatTimeAgo } from "@/utils/format"
import { CopyButton } from "./CopyButton"
import { ExportButton } from "./ExportButton"
import { DeleteButton } from "./DeleteButton"
import { FavoriteButton } from "../kilocode/history/FavoriteButton" // kilocode_change
import { KiloShareSessionButton } from "./KiloShareSessionButton" // kilocode_change
import { StandardTooltip } from "../ui/standard-tooltip"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { Split } from "lucide-react"

export interface TaskItemFooterProps {
	item: HistoryItem
	variant: "compact" | "full"
	isSelectionMode?: boolean
	isSubtask?: boolean
	onDelete?: (taskId: string) => void
}

const TaskItemFooter: React.FC<TaskItemFooterProps> = ({
	item,
	variant,
	isSelectionMode = false,
	isSubtask = false,
	onDelete,
}) => {
	const { t } = useAppTranslation()

	return (
		<div className="text-xs text-vscode-descriptionForeground flex justify-between items-center">
			<div className="flex gap-1 items-center text-vscode-descriptionForeground/60">
				{/* Subtask tag */}
				{isSubtask && (
					<>
						<Split className="size-3" />
						<span>{t("history:subtaskTag")}</span>
						<span>·</span>
					</>
				)}
				{/* Datetime with time-ago format */}
				<StandardTooltip content={new Date(item.ts).toLocaleString()}>
					<span className="first-letter:uppercase">{formatTimeAgo(item.ts)}</span>
				</StandardTooltip>

				{/* Cost */}
				{!!item.totalCost && (
					<>
						<span>·</span>
						<span className="flex items-center" data-testid="cost-footer-compact">
							{"$" + item.totalCost.toFixed(2)}
						</span>
					</>
				)}
			</div>

			{/* Action Buttons for non-compact view */}
			{!isSelectionMode && (
				<div className="flex flex-row gap-0 -mx-1.5 items-center text-vscode-descriptionForeground/60 hover:text-vscode-descriptionForeground opacity-0 group-hover:opacity-100">
					<CopyButton itemTask={item.task} />
					<FavoriteButton isFavorited={item.isFavorited ?? false} id={item.id} />
					<KiloShareSessionButton id={item.id} />
					{variant === "full" && <ExportButton itemId={item.id} />}
					{onDelete && <DeleteButton itemId={item.id} onDelete={onDelete} />}
				</div>
			)}
		</div>
	)
}

export default TaskItemFooter
