import { useState } from "react"
import { useTranslation } from "react-i18next"
import { FoldVertical } from "lucide-react"

import type { ContextTruncation } from "@roo-code/types"

interface TruncationResultRowProps {
	data: ContextTruncation
}

/**
 * Displays the result of a sliding window truncation operation.
 * Shows information about how many messages were removed and the
 * token count before and after truncation.
 *
 * This component provides visual feedback for truncation events which
 * were previously silent, addressing a gap in the context management UI.
 */
export function TruncationResultRow({ data }: TruncationResultRowProps) {
	const { t } = useTranslation()
	const [isExpanded, setIsExpanded] = useState(false)

	const { messagesRemoved, prevContextTokens, newContextTokens } = data

	// Handle null/undefined values to prevent crashes
	const removedCount = messagesRemoved ?? 0
	const prevTokens = prevContextTokens ?? 0
	const newTokens = newContextTokens ?? 0

	return (
		<div className="mb-2">
			<div
				className="flex items-center justify-between cursor-pointer select-none"
				onClick={() => setIsExpanded(!isExpanded)}>
				<div className="flex items-center gap-2 flex-grow">
					<FoldVertical size={16} className="text-vscode-foreground" />
					<span className="font-bold text-vscode-foreground">
						{t("chat:contextManagement.truncation.title")}
					</span>
					<span className="text-vscode-descriptionForeground text-sm">
						{prevTokens.toLocaleString()} → {newTokens.toLocaleString()}{" "}
						{t("chat:contextManagement.tokens")}
					</span>
				</div>
				<span className={`codicon codicon-chevron-${isExpanded ? "up" : "down"}`}></span>
			</div>

			{isExpanded && (
				<div className="mt-2 ml-0 p-4 bg-vscode-editor-background rounded text-vscode-foreground text-sm">
					<div className="flex flex-col gap-2">
						<div className="flex items-center gap-2">
							<span className="text-vscode-descriptionForeground">
								{t("chat:contextManagement.truncation.messagesRemoved", { count: removedCount })}
							</span>
						</div>
						<p className="text-vscode-descriptionForeground text-xs">
							{t("chat:contextManagement.truncation.description")}
						</p>
					</div>
				</div>
			)}
		</div>
	)
}
