import React from "react"
import MarkdownBlock from "../../common/MarkdownBlock"
import { useTranslation } from "react-i18next"

interface NewTaskPreviewProps {
	context: string
}

export const NewTaskPreview: React.FC<NewTaskPreviewProps> = ({ context }) => {
	const { t } = useTranslation()

	return (
		<div className="bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)] rounded-[3px] p-[14px] pb-[6px]">
			<span style={{ fontWeight: "bold" }}>{t("kilocode:newTaskPreview.task")}</span>
			<MarkdownBlock markdown={context} />
		</div>
	)
}

export default NewTaskPreview
