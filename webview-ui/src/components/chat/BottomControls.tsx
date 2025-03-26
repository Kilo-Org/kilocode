import React from "react"
import { vscode } from "../../utils/vscode"
import { useAppTranslation } from "@/i18n/TranslationContext"

const BottomControls: React.FC = () => {
	const { t } = useAppTranslation()

	const startNewTask = () => {
		// switches to new chat in chat view
		vscode.postMessage({ type: "clearTask" })
		// switches to new chat in all other views
		window.postMessage({ type: "action", action: "chatButtonClicked" }, "*")
	}

	const showFeedbackOptions = () => {
		vscode.postMessage({ type: "showFeedbackOptions" })
	}

	return (
		<div className="flex flex-row items-center justify-between w-auto h-[30px] mx-3.5 mb-1">
			{/* Left group */}
			<div className="flex items-center gap-1">
				<button
					className="vscode-button flex items-center gap-1.5 p-0.75 rounded-sm text-vscode-button-secondaryForeground cursor-pointer hover:bg-vscode-button-secondaryHoverBackground"
					title={t("chat:startNewTask.title")}
					onClick={startNewTask}>
					<span className="codicon codicon-add text-sm"></span>
				</button>
				<button
					className="vscode-button flex items-center gap-1.5 p-0.75 rounded-sm text-vscode-button-secondaryForeground cursor-pointer hover:bg-vscode-button-secondaryHoverBackground"
					title={t("chat:history.title")}
					onClick={() => window.postMessage({ type: "action", action: "historyButtonClicked" }, "*")}>
					<span className="codicon codicon-history text-sm"></span>
				</button>
			</div>
			{/* Right group */}
			<div className="flex items-center">
				<button
					className="vscode-button flex items-center gap-1.5 p-0.75 rounded-sm text-vscode-button-secondaryForeground cursor-pointer hover:bg-vscode-button-secondaryHoverBackground"
					title={t("common:feedback.title")}
					onClick={showFeedbackOptions}>
					<span className="codicon codicon-feedback text-sm"></span>
				</button>
			</div>
		</div>
	)
}

export default BottomControls
