import React from "react"
import { vscode } from "../../utils/vscode"
import { useAppTranslation } from "@/i18n/TranslationContext"

const BottomControls: React.FC = () => {
	const { t } = useAppTranslation()

	const showFeedbackOptions = () => {
		vscode.postMessage({ type: "showFeedbackOptions" })
	}

	return (
		<div className="flex flex-row justify-end w-auto h-[30px] mx-3.5 mb-1">
			<button
				className="vscode-button flex items-center gap-1.5 p-0.75 rounded-sm text-vscode-foreground cursor-pointer hover:bg-vscode-list-hoverBackground"
				title={t("common:feedback.title")}
				onClick={showFeedbackOptions}>
				<span className="codicon codicon-feedback text-sm"></span>
			</button>
		</div>
	)
}

export default BottomControls
