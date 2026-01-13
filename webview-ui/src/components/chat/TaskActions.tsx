import { useState } from "react"
import { useTranslation } from "react-i18next"

import type { HistoryItem } from "@roo-code/types"

import { vscode } from "@/utils/vscode"
import { useCopyToClipboard } from "@/utils/clipboard"
import { useExtensionState } from "@/context/ExtensionStateContext"

import { DeleteTaskDialog } from "../history/DeleteTaskDialog"
// import { ShareButton } from "./ShareButton" // kilocode_change unused
// import { CloudTaskButton } from "./CloudTaskButton" // kilocode_change: unused
import { CopyIcon, DownloadIcon, Trash2Icon, FileJsonIcon, MessageSquareCodeIcon } from "lucide-react"
import { LucideIconButton } from "./LucideIconButton"

interface TaskActionsProps {
	item?: HistoryItem
	buttonsDisabled: boolean
}

export const TaskActions = ({ item, buttonsDisabled }: TaskActionsProps) => {
	const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null)
	const { t } = useTranslation()
	const { copyWithFeedback } = useCopyToClipboard()
	const { debug } = useExtensionState()

	return (
		<div className="flex flex-row items-center -ml-0.5 mt-1 gap-1">
			<LucideIconButton
				icon={DownloadIcon}
				title={t("chat:task.export")}
				onClick={() => vscode.postMessage({ type: "exportCurrentTask" })}
			/>

			{item?.task && (
				<LucideIconButton
					icon={CopyIcon}
					title={t("history:copyPrompt")}
					onClick={(e) => copyWithFeedback(item.task, e)}
				/>
			)}
			{!!item?.size && item.size > 0 && (
				<>
					<LucideIconButton
						icon={Trash2Icon}
						title={t("chat:task.delete")}
						disabled={buttonsDisabled}
						onClick={(e) => {
							e.stopPropagation()
							if (e.shiftKey) {
								vscode.postMessage({ type: "deleteTaskWithId", text: item.id })
							} else {
								setDeleteTaskId(item.id)
							}
						}}
					/>
					{deleteTaskId && (
						<DeleteTaskDialog
							taskId={deleteTaskId}
							onOpenChange={(open) => !open && setDeleteTaskId(null)}
							open
						/>
					)}
				</>
			)}
			{/* <ShareButton item={item} disabled={false} showLabel={false} /> kilocode_change: unused */}
			{/* <CloudTaskButton item={item} disabled={buttonsDisabled} />  */}
			{debug && item?.id && (
				<>
					<LucideIconButton
						icon={FileJsonIcon}
						title={t("chat:task.openApiHistory")}
						onClick={() => vscode.postMessage({ type: "openDebugApiHistory" })}
					/>
					<LucideIconButton
						icon={MessageSquareCodeIcon}
						title={t("chat:task.openUiHistory")}
						onClick={() => vscode.postMessage({ type: "openDebugUiHistory" })}
					/>
				</>
			)}
		</div>
	)
}
