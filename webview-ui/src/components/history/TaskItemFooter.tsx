import React from "react"
import type { HistoryItem } from "@roo-code/types"
import { Coins, FileIcon } from "lucide-react"
import prettyBytes from "pretty-bytes"
import { formatLargeNumber } from "@/utils/format"
import { CopyButton } from "./CopyButton"
import { ExportButton } from "./ExportButton"

export interface TaskItemFooterProps {
	item: HistoryItem
	variant: "compact" | "full"
	isSelectionMode?: boolean
}

const TaskItemFooter: React.FC<TaskItemFooterProps> = ({ item, variant, isSelectionMode = false }) => {
	return (
<<<<<<< HEAD
		<div
			className={cn("text-xs text-vscode-descriptionForeground", {
				"mt-2 flex items-center flex-wrap gap-x-2": isCompact,
				"mt-1 flex justify-between items-end": !isCompact,
			})}>
			{isCompact ? (
				<>
					{/* Compact Cache */}
					{!!item.cacheWrites && (
						<span className="flex items-center gap-px" data-testid="cache-compact">
							<i className="codicon codicon-database" style={metadataIconWithTextAdjustStyle} />
							{formatLargeNumber(item.cacheWrites || 0)}
							<i className="codicon codicon-arrow-right" style={metadataIconWithTextAdjustStyle} />
							{formatLargeNumber(item.cacheReads || 0)}
						</span>
					)}

					{/* Compact Tokens */}
					{(item.tokensIn || item.tokensOut) && (
						<>
							<span data-testid="tokens-in-footer-compact">
								↑ {formatLargeNumber(item.tokensIn || 0)}
							</span>
							<span data-testid="tokens-out-footer-compact">
								↓ {formatLargeNumber(item.tokensOut || 0)}
							</span>
						</>
					)}
					{/* Compact Cost */}
					{!!item.totalCost && (
						<span className="flex items-center">
							<Coins className="inline-block size-[1em] mr-1" />
							<span data-testid="cost-footer-compact">{"$" + item.totalCost.toFixed(2)}</span>
						</span>
					)}
				</>
			) : (
				<>
					<div className="flex flex-col gap-1">
						{/* Cache Info */}
						{!!item.cacheWrites && (
							<div className="flex items-center flex-wrap gap-x-1">
								<span className="font-medium">{t("history:cacheLabel")}</span>
								<span className="flex items-center gap-px" data-testid="cache-writes">
									<i className="codicon codicon-database" style={metadataIconWithTextAdjustStyle} />
									<span className="font-medium">{formatLargeNumber(item.cacheWrites || 0)}</span>
								</span>
								<span className="flex items-center gap-px" data-testid="cache-reads">
									<i
										className="codicon codicon-arrow-right"
										style={metadataIconWithTextAdjustStyle}
									/>
									<span className="font-medium">{formatLargeNumber(item.cacheReads || 0)}</span>
								</span>
							</div>
						)}

						{/* Full Tokens */}
						{(item.tokensIn || item.tokensOut) && (
							<div className="flex items-center flex-wrap gap-x-1">
								<span className="font-medium">{t("history:tokensLabel")}</span>
								<span className="flex items-center gap-px" data-testid="tokens-in-footer-full">
									<i className="codicon codicon-arrow-up" style={metadataIconWithTextAdjustStyle} />
									<span className="font-medium">{formatLargeNumber(item.tokensIn || 0)}</span>
								</span>
								<span className="flex items-center gap-px" data-testid="tokens-out-footer-full">
									<i className="codicon codicon-arrow-down" style={metadataIconWithTextAdjustStyle} />
									<span className="font-medium">{formatLargeNumber(item.tokensOut || 0)}</span>
								</span>
							</div>
						)}
						{/* Full Cost */}
						{!!item.totalCost && (
							<div className="flex items-center flex-wrap gap-x-1">
								<span className="font-medium">{t("history:apiCostLabel")}</span>
								<span data-testid="cost-footer-full">{"$" + item.totalCost.toFixed(4)}</span>
							</div>
						)}
					</div>
					{/* Action Buttons for non-compact view */}
					{!isSelectionMode && (
						<div className="flex flex-row gap-0 items-center opacity-50 hover:opacity-100">
							<CopyButton itemTask={item.task} />
							<ExportButton itemId={item.id} />
						</div>
					)}
				</>
=======
		<div className="text-xs text-vscode-descriptionForeground flex justify-between items-center mt-1">
			<div className="flex gap-2">
				{!!(item.cacheReads || item.cacheWrites) && (
					<span className="flex items-center" data-testid="cache-compact">
						<i className="mr-1 codicon codicon-cloud-upload text-sm! text-vscode-descriptionForeground" />
						<span className="inline-block mr-1">{formatLargeNumber(item.cacheWrites || 0)}</span>
						<i className="mr-1 codicon codicon-cloud-download text-sm! text-vscode-descriptionForeground" />
						<span>{formatLargeNumber(item.cacheReads || 0)}</span>
					</span>
				)}

				{/* Full Tokens */}
				{!!(item.tokensIn || item.tokensOut) && (
					<span className="flex items-center gap-1">
						<span data-testid="tokens-in-footer-compact">↑ {formatLargeNumber(item.tokensIn || 0)}</span>
						<span data-testid="tokens-out-footer-compact">↓ {formatLargeNumber(item.tokensOut || 0)}</span>
					</span>
				)}

				{/* Full Cost */}
				{!!item.totalCost && (
					<span className="flex items-center">
						<Coins className="inline-block size-[1em] mr-1" />
						<span data-testid="cost-footer-compact">{"$" + item.totalCost.toFixed(2)}</span>
					</span>
				)}

				{!!item.size && (
					<span className="flex items-center">
						<FileIcon className="inline-block size-[1em] mr-1" />
						<span data-testid="size-footer-compact">{prettyBytes(item.size)}</span>
					</span>
				)}
			</div>

			{/* Action Buttons for non-compact view */}
			{!isSelectionMode && (
				<div className="flex flex-row gap-0 items-center opacity-50 hover:opacity-100">
					<CopyButton itemTask={item.task} />
					{variant === "full" && <ExportButton itemId={item.id} />}
				</div>
>>>>>>> upstream-at-v3.21.1
			)}
		</div>
	)
}

export default TaskItemFooter
