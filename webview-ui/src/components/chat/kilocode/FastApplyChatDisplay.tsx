import MarkdownBlock from "@/components/common/MarkdownBlock"
import { formatLargeNumber } from "@/utils/format"
import { type ClineSayTool } from "@roo/ExtensionMessage"
import { VSCodeBadge } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"

export const FastApplyChatDisplay = ({
	fastApplyResult,
}: {
	fastApplyResult: NonNullable<ClineSayTool["fastApplyResult"]>
}) => {
	const [isFastApplyExpanded, setIsFastApplyExpanded] = useState(false)
	return (
		<div className="mt-2">
			{/* FastApply collapsed header - clickable */}
			<div
				className="flex items-center justify-between cursor-pointer select-none p-2 bg-vscode-badge-background border border-vscode-editorGroup-border rounded-xs"
				onClick={() => setIsFastApplyExpanded(!isFastApplyExpanded)}>
				<div className="flex items-center gap-2">
					<span className="codicon codicon-rocket text-vscode-badge-foreground" />
					<span className="font-medium text-vscode-badge-foreground">Fast Apply</span>

					{/* Token metrics */}
					<div className="flex items-center gap-1">
						{fastApplyResult.tokensIn && (
							<span className="flex items-center gap-0.5 text-sm text-vscode-badge-foreground">
								<span className="codicon codicon-arrow-up" />
								{formatLargeNumber(fastApplyResult.tokensIn)}
							</span>
						)}
						{fastApplyResult.tokensOut && (
							<span className="flex items-center gap-0.5 text-sm text-vscode-badge-foreground">
								<span className="codicon codicon-arrow-down" />
								{formatLargeNumber(fastApplyResult.tokensOut)}
							</span>
						)}
					</div>

					{/* Cost badge */}
					{fastApplyResult.cost && fastApplyResult.cost > 0 && (
						<VSCodeBadge>${fastApplyResult.cost.toFixed(4)}</VSCodeBadge>
					)}
				</div>

				<span
					className={`codicon codicon-chevron-${isFastApplyExpanded ? "up" : "down"} text-vscode-badge-foreground`}
				/>
			</div>

			{/* FastApply expanded content */}
			{isFastApplyExpanded && (
				<div className="mt-1 p-3 bg-vscode-editor-background border-l border-r border-b border-vscode-editorGroup-border rounded-b-xs">
					<MarkdownBlock markdown={fastApplyResult.description || ""} />
				</div>
			)}
		</div>
	)
}
