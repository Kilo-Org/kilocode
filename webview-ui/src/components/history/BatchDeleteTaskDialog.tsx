import { useCallback } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	Button,
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

	const favoritedTasks = tasks?.filter((task) => taskIds.includes(task.id) && task.isFavorited) ?? [] // kilocode_change
	const hasFavoritedTasks = favoritedTasks.length > 0 // kilocode_change

	const onDelete = useCallback(() => {
		if (taskIds.length > 0) {
			vscode.postMessage({ type: "deleteMultipleTasksWithIds", ids: taskIds })
			onOpenChange?.(false)
		}
	}, [taskIds, onOpenChange])

	return (
		<AlertDialog {...props}>
			<AlertDialogContent className="max-w-md">
				<AlertDialogHeader>
					<AlertDialogTitle>{t("history:deleteTasks")}</AlertDialogTitle>
					<AlertDialogDescription className="text-vscode-foreground">
						<div className="mb-2">{t("history:confirmDeleteTasks", { count: taskIds.length })}</div>
						{/* kilocode_change start */}
						{hasFavoritedTasks && (
							<div className="text-yellow-500 mb-2">
								{t("history:deleteTasksFavoritedWarning", { count: favoritedTasks.length })}
							</div>
						)}
						{/* kilocode_change end */}
						<div className="text-vscode-editor-foreground bg-vscode-editor-background p-2 rounded text-sm">
							{t("history:deleteTasksWarning")}
						</div>
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel asChild>
						<Button variant="secondary">{t("history:cancel")}</Button>
					</AlertDialogCancel>
					<AlertDialogAction asChild>
						<Button variant="destructive" onClick={onDelete}>
							<span className="codicon codicon-trash mr-1"></span>
							{t("history:deleteItems", { count: taskIds.length })}
						</Button>
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
