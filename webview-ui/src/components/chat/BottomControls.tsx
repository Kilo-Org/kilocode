import React from "react"
import { vscode } from "../../utils/vscode"
import { useAppTranslation } from "@/i18n/TranslationContext"

interface BottomControlsProps {
	// Add any props you might need here
}

const BottomControls: React.FC<BottomControlsProps> = (props) => {
	const { t } = useAppTranslation()

	const startNewTask = () => {
		vscode.postMessage({ type: "clearTask" })
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
				{/* TODO: add feedback button (out of scope for this PR) */}
				<button
					className="vscode-button flex items-center gap-1.5 p-0.75 rounded-sm text-vscode-button-secondaryForeground cursor-pointer hover:bg-vscode-button-secondaryHoverBackground"
					title={t("chat:startNewTask.title")}
					onClick={startNewTask}>
					<span className="codicon codicon-add text-sm"></span>
				</button>
			</div>
		</div>
	)
}

export default BottomControls
