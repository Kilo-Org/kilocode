import { useCallback, useMemo, useState } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	Button,
	Checkbox,
} from "@/components/ui"
import { vscode } from "@/utils/vscode"
import { AlertDialogProps } from "@radix-ui/react-alert-dialog"
import { useTaskWithId } from "@/kilocode/hooks/useTaskHistory"

interface BatchDeleteTaskDialogProps extends AlertDialogProps {
	taskIds: string[]
}

export const BatchDeleteTaskDialog = ({ taskIds, ...props }: BatchDeleteTaskDialogProps) => {
	const { t } = useAppTranslation()
	const { data: tasks } = useTaskWithId(taskIds) // kilocode_change
	const { onOpenChange } = props
	const [includeFavorited, setIncludeFavorited] = useState(false) // kilocode_change

	const favoritedTasks = tasks?.filter((task) => taskIds.includes(task.id) && task.isFavorited) ?? [] // kilocode_change
	const hasFavoritedTasks = favoritedTasks.length > 0 // kilocode_change
	const nonFavoritedTaskIds = taskIds.filter((id) => !favoritedTasks.some((task) => task.id === id)) // kilocode_change

	// kilocode_change start
	const deleteTaskIds = useMemo(() => {
		if (!hasFavoritedTasks) {
			return taskIds
		}
		return includeFavorited ? taskIds : nonFavoritedTaskIds
	}, [hasFavoritedTasks, includeFavorited, nonFavoritedTaskIds, taskIds])
	// kilocode_change end

	const onDelete = useCallback(() => {
		if (deleteTaskIds.length > 0) {
			vscode.postMessage({
				type: "deleteMultipleTasksWithIds",
				ids: taskIds,
				excludeFavorites: hasFavoritedTasks && !includeFavorited,
			})
		}
		onOpenChange?.(false)
	}, [deleteTaskIds.length, hasFavoritedTasks, includeFavorited, onOpenChange, taskIds])

	return (
		<AlertDialog {...props}>
			<AlertDialogContent className="max-w-md">
				<AlertDialogHeader>
					<AlertDialogTitle>{t("history:deleteTasks")}</AlertDialogTitle>
					<AlertDialogDescription className="text-vscode-foreground">
						<div className="mb-2">{t("history:confirmDeleteTasks", { count: deleteTaskIds.length })}</div>
						<div className="text-vscode-editor-foreground bg-vscode-editor-background rounded text-sm">
							{t("history:deleteTasksWarning")}
						</div>
					</AlertDialogDescription>
				</AlertDialogHeader>
				{/* kilocode_change start */}
				{hasFavoritedTasks && (
					<label className="inline-flex items-center gap-2 text-sm text-vscode-foreground mb-2 w-fit">
						<Checkbox
							checked={includeFavorited}
							onCheckedChange={(checked) => setIncludeFavorited(Boolean(checked))}
							className="h-[14px] w-[14px] rounded-[3px] border-vscode-descriptionForeground data-[state=checked]:border-vscode-button-background data-[state=checked]:bg-vscode-button-background data-[state=checked]:text-vscode-button-foreground data-[state=checked]:[&_svg]:text-vscode-button-foreground [&_svg]:h-3 [&_svg]:w-3 [&_svg]:translate-y-[0.5px]"
							data-testid="include-favorited-checkbox"
						/>
						<span className="leading-none">{t("history:deleteFavoritedCheckbox")}</span>
					</label>
				)}
				<AlertDialogFooter className="flex-row items-end justify-end">
					<div className="flex items-center space-x-2">
						<AlertDialogCancel asChild>
							<Button variant="secondary" className="min-w-[140px] h-7 px-2.5 justify-center text-sm">
								{t("history:cancel")}
							</Button>
						</AlertDialogCancel>
						<Button
							variant="destructive"
							onClick={onDelete}
							className="flex items-center justify-center gap-2 min-w-[140px] h-7 px-2.5 text-sm">
							<span className="codicon codicon-trash size-4 align-middle"></span>
							{t("history:deleteItems", { count: deleteTaskIds.length })}
						</Button>
					</div>
				</AlertDialogFooter>
				{/* kilocode_change end */}
			</AlertDialogContent>
		</AlertDialog>
	)
}
