import { ClineMessage } from "@roo-code/types"
import { Mention } from "../../chat/Mention"
import { Button } from "@src/components/ui"
import Thumbnails from "../../common/Thumbnails"
import { vscode } from "@src/utils/vscode"
import { useState } from "react"
import { useTranslation } from "react-i18next"

interface KiloChatRowUserFeedbackProps {
	message: ClineMessage
	isStreaming: boolean
	onChatReset?: () => void
}

export const KiloChatRowUserFeedback = ({ message, isStreaming, onChatReset }: KiloChatRowUserFeedbackProps) => {
	const { t } = useTranslation()
	const [isEditing, setIsEditing] = useState(false)
	const [editedText, setEditedText] = useState(message.text)

	const handleCancel = () => {
		setEditedText(message.text)
		setIsEditing(false)
	}

	const handleResend = () => {
		vscode.postMessage({ type: "editMessage", values: { ts: message.ts, text: editedText } })
		setIsEditing(false)
		if (onChatReset) {
			onChatReset()
		}
	}

	const handleRevertAndResend = () => {
		vscode.postMessage({ type: "editMessage", values: { ts: message.ts, text: editedText, revert: true } })
		setIsEditing(false)
		if (onChatReset) {
			onChatReset()
		}
	}

	if (isEditing) {
		return (
			<div className="bg-vscode-editor-background border rounded-xs p-1 overflow-hidden whitespace-pre-wrap">
				<textarea
					className="w-full h-24 p-2 border rounded-xs bg-vscode-input-background text-vscode-input-foreground"
					value={editedText}
					onChange={(e) => setEditedText(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
							e.preventDefault()
							handleRevertAndResend()
						}
					}}
				/>
				<div className="flex justify-end gap-2 mt-2">
					<Button onClick={handleCancel} variant="ghost">
						{t("kilocode:userFeedback:editCancel")}
					</Button>
					<Button variant="secondary" onClick={handleResend} disabled={editedText === message.text}>
						{t("kilocode:userFeedback:send")}
					</Button>
					<Button onClick={handleRevertAndResend} disabled={editedText === message.text}>
						{t("kilocode:userFeedback:restoreAndSend")}
					</Button>
				</div>
			</div>
		)
	}

	return (
		<div className="bg-vscode-editor-background border rounded-xs p-1 overflow-hidden whitespace-pre-wrap">
			<div className="flex justify-between">
				<div className="flex-grow px-2 py-1 wrap-anywhere">
					<Mention text={message.text} withShadow />
				</div>
				<div className="flex">
					<Button
						variant="ghost"
						size="icon"
						className="shrink-0"
						disabled={isStreaming}
						onClick={(e) => {
							e.stopPropagation()
							setIsEditing(true)
						}}>
						<span className="codicon codicon-edit" />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						className="shrink-0"
						disabled={isStreaming}
						onClick={(e) => {
							e.stopPropagation()
							vscode.postMessage({ type: "deleteMessage", value: message.ts })
						}}>
						<span className="codicon codicon-trash" />
					</Button>
				</div>
			</div>
			{message.images && message.images.length > 0 && (
				<Thumbnails images={message.images} style={{ marginTop: "8px" }} />
			)}
		</div>
	)
}
