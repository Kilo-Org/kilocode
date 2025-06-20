import React from "react"
import type { HistoryItem } from "@roo-code/types"
import prettyBytes from "pretty-bytes"
import { vscode } from "@/utils/vscode"
import { formatDate } from "@/utils/format"
import { Button } from "@/components/ui"
import { CopyButton } from "./CopyButton"

export interface TaskItemHeaderProps {
	item: HistoryItem
	variant: "compact" | "full"
	isSelectionMode: boolean
	t: (key: string, options?: any) => string
	onDelete?: (taskId: string) => void
}

const TaskItemHeader: React.FC<TaskItemHeaderProps> = ({ item, variant, isSelectionMode, t, onDelete }) => {
	const isCompact = variant === "compact"

	// Standardized icon styles
	const actionIconStyle: React.CSSProperties = {
		fontSize: "16px",
		color: "var(--vscode-descriptionForeground)",
		verticalAlign: "middle",
	}

	const handleDeleteClick = (e: React.MouseEvent) => {
		e.stopPropagation()
		if (e.shiftKey) {
			vscode.postMessage({ type: "deleteTaskWithId", text: item.id })
		} else if (onDelete) {
			onDelete(item.id)
		}
	}

	// kilocode_change start
	const handleFavoriteClick = (e: React.MouseEvent) => {
		e.stopPropagation()
		vscode.postMessage({ type: "toggleTaskFavorite", text: item.id })
	}
	// kilocode_change end

	return (
		<div className="flex justify-between items-center pb-0">
			<div className="flex items-center flex-wrap gap-x-2 text-xs">
				<span className="text-vscode-descriptionForeground font-medium text-sm uppercase">
					{formatDate(item.ts)}
				</span>
			</div>

			{/* Action Buttons */}
			{!isSelectionMode && (
				<div className="flex flex-row gap-0 items-center opacity-20 group-hover:opacity-50 hover:opacity-100">
					{/* kilocode_change start */}
					{/* Favorite Star Button */}
					<Button
						variant="ghost"
						size="icon"
						title={item.isFavorited ? t("history:unfavoriteTask") : t("history:favoriteTask")}
						data-testid="favorite-task-button"
						onClick={handleFavoriteClick}
						className={item.isFavorited ? "text-yellow-500" : ""}>
						<span
							className={`codicon ${item.isFavorited ? "codicon-star-full" : "codicon-star-empty"}`}
							style={actionIconStyle}
						/>
					</Button>
					{/* kilocode_change end */}

					{isCompact ? (
						<CopyButton itemTask={item.task} />
					) : (
						<>
							{onDelete && (
								<Button
									variant="ghost"
									size="icon"
									title={t("history:deleteTaskTitle")}
									data-testid="delete-task-button"
									onClick={handleDeleteClick}>
									<span className="codicon codicon-trash" style={actionIconStyle} />
								</Button>
							)}
							{!isCompact && item.size && (
								<span className="text-vscode-descriptionForeground ml-1 text-sm">
									{prettyBytes(item.size)}
								</span>
							)}
						</>
					)}
				</div>
			)}
		</div>
	)
}

export default TaskItemHeader
