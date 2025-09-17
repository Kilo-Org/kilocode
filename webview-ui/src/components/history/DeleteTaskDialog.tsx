import { useCallback, useEffect } from "react"
import { useKeyPress } from "react-use"
import { AlertDialogProps } from "@radix-ui/react-alert-dialog"

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
import { useAppTranslation } from "@/i18n/TranslationContext"
import { vscode } from "@/utils/vscode"
import { useTaskWithId } from "@/kilocode/hooks/useTaskHistory"

interface DeleteTaskDialogProps extends AlertDialogProps {
	taskId: string
}

export const DeleteTaskDialog = ({ taskId, ...props }: DeleteTaskDialogProps) => {
	const { t } = useAppTranslation()
	const [isEnterPressed] = useKeyPress("Enter")
	const { data: tasks } = useTaskWithId([taskId]) // kilocode_change

	const { onOpenChange } = props

	const task = tasks?.find((t) => t.id === taskId) // kilocode_change
	const isFavorited = task?.isFavorited // kilocode_change

	const onDelete = useCallback(() => {
		if (taskId) {
			vscode.postMessage({ type: "deleteTaskWithId", text: taskId })
			onOpenChange?.(false)
		}
	}, [taskId, onOpenChange])

	useEffect(() => {
		if (taskId && isEnterPressed) {
			onDelete()
		}
	}, [taskId, isEnterPressed, onDelete])

	return (
		<AlertDialog {...props}>
			<AlertDialogContent onEscapeKeyDown={() => onOpenChange?.(false)}>
				<AlertDialogHeader>
					<AlertDialogTitle>{t("history:deleteTask")}</AlertDialogTitle>
					{/* kilocode_change start */}
					<AlertDialogDescription>
						{isFavorited ? (
							<div className="text-yellow-500 mb-2">{t("history:deleteTaskFavoritedWarning")}</div>
						) : null}
						{t("history:deleteTaskMessage")}
					</AlertDialogDescription>
					{/* kilocode_change end */}
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel asChild>
						<Button variant="secondary">{t("history:cancel")}</Button>
					</AlertDialogCancel>
					<AlertDialogAction asChild>
						<Button variant="destructive" onClick={onDelete}>
							{t("history:delete")}
						</Button>
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
