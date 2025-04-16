import { memo } from "react"

import { vscode } from "@/utils/vscode"
import { formatLargeNumber, formatDate } from "@/utils/format"
import { Button, Checkbox } from "@/components/ui"

import { useAppTranslation } from "../../i18n/TranslationContext"
import { CopyButton } from "./CopyButton"
import { useTaskSearch } from "./useTaskSearch"

type HistoryPreviewProps = {
	showHistoryView: () => void
}
const HistoryPreview = ({ showHistoryView }: HistoryPreviewProps) => {
	const { tasks, showAllWorkspaces, setShowAllWorkspaces } = useTaskSearch()
	const { t } = useAppTranslation()

	return (
		<div className="flex flex-col gap-3 shrink-0 mx-5">
			<div className="flex items-center justify-between text-vscode-descriptionForeground">
				<div className="flex items-center gap-1">
					<span className="codicon codicon-comment-discussion scale-90 mr-1" />
					<span className="font-medium text-xs uppercase">{t("history:recentTasks")}</span>
				</div>
				<Button variant="ghost" size="sm" onClick={() => showHistoryView()} className="uppercase">
					{t("history:viewAll")}
				</Button>
			</div>
			<div className="flex items-center gap-2 mb-2">
				<Checkbox
					id="show-all-workspaces"
					checked={showAllWorkspaces}
					onCheckedChange={(checked) => setShowAllWorkspaces(checked === true)}
					variant="description"
				/>
				<label htmlFor="show-all-workspaces" className="text-xs text-vscode-foreground cursor-pointer">
					{t("history:showAllWorkspaces")}
				</label>
			</div>
			{tasks.slice(0, 3).map((item) => (
				<div
					key={item.id}
					className="bg-vscode-toolbar-hoverBackground/50 hover:bg-vscode-toolbar-hoverBackground/75 rounded-xs relative overflow-hidden opacity-90 hover:opacity-100 cursor-pointer"
					onClick={() => vscode.postMessage({ type: "showTaskWithId", text: item.id })}>
					<div className="flex flex-col gap-2 p-3 pt-1">
						<div className="flex justify-between items-center">
							<span className="text-xs font-medium text-vscode-descriptionForeground uppercase">
								{formatDate(item.ts)}
							</span>
							<CopyButton itemTask={item.task} />
						</div>
						<div
							className="text-vscode-descriptionForeground overflow-hidden whitespace-pre-wrap"
							style={{
								display: "-webkit-box",
								WebkitLineClamp: 3,
								WebkitBoxOrient: "vertical",
								wordBreak: "break-word",
								overflowWrap: "anywhere",
							}}>
							{item.task}
						</div>
						<div className="text-xs text-vscode-descriptionForeground">
							<span>
								{t("history:tokens", {
									in: formatLargeNumber(item.tokensIn || 0),
									out: formatLargeNumber(item.tokensOut || 0),
								})}
							</span>
							{!!item.cacheWrites && (
								<>
									{" • "}
									<span>
										{t("history:cache", {
											writes: formatLargeNumber(item.cacheWrites || 0),
											reads: formatLargeNumber(item.cacheReads || 0),
										})}
									</span>
								</>
							)}
							{!!item.totalCost && (
								<>
									{" • "}
									<span>{t("history:apiCost", { cost: item.totalCost?.toFixed(4) })}</span>
								</>
							)}
						</div>
						{showAllWorkspaces && item.workspace && (
							<div className="flex flex-row gap-1 text-vscode-descriptionForeground text-xs mt-1">
								<span className="codicon codicon-folder scale-80" />
								<span>{item.workspace}</span>
							</div>
						)}
					</div>
				</div>
			))}
		</div>
	)
}

export default memo(HistoryPreview)
