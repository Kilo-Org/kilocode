// kilocode_change: new file
import { memo, useRef, useState } from "react"
import { useWindowSize } from "react-use"
import { useTranslation } from "react-i18next"
import { CloudUpload, CloudDownload, FoldVertical } from "lucide-react"
import { validateSlashCommand } from "@/utils/slash-commands"

import type { ClineMessage } from "@roo-code/types"

import { getModelMaxOutputTokens } from "@roo/api"

import { formatLargeNumber } from "@src/utils/format"
import { cn } from "@src/lib/utils"
import { Button, StandardTooltip } from "@src/components/ui"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { useSelectedModel } from "@/components/ui/hooks/useSelectedModel"
import { useTaskDiffStats } from "@/components/ui/hooks/kilocode/useTaskDiffStats"

import Thumbnails from "../common/Thumbnails"

import { TaskActions } from "../chat/TaskActions"
import { ShareButton } from "../chat/ShareButton"
import { ContextWindowProgress } from "../chat/ContextWindowProgress"
import { TaskTimeline } from "../chat/TaskTimeline"
import { mentionRegexGlobal } from "@roo/context-mentions"

import { vscode } from "@/utils/vscode"
import { TodoListDisplay } from "../chat/TodoListDisplay"
import DiffStatsDisplay from "./DiffStatsDisplay"

export interface TaskHeaderProps {
	task: ClineMessage
	tokensIn: number
	tokensOut: number
	cacheWrites?: number
	cacheReads?: number
	totalCost: number
	contextTokens: number
	buttonsDisabled: boolean
	handleCondenseContext: (taskId: string) => void
	onClose: () => void
	groupedMessages: (ClineMessage | ClineMessage[])[]
	onMessageClick?: (index: number) => void
	isTaskActive?: boolean
	todos?: any[]
}

const KiloTaskHeader = ({
	task,
	tokensIn,
	tokensOut,
	cacheWrites,
	cacheReads,
	totalCost,
	contextTokens,
	buttonsDisabled,
	handleCondenseContext,
	onClose,
	groupedMessages,
	onMessageClick,
	isTaskActive = false,
	todos,
}: TaskHeaderProps) => {
	const { t } = useTranslation()
	const { showTaskTimeline, showDiffStats, clineMessages } = useExtensionState()
	const { apiConfiguration, currentTaskItem, customModes } = useExtensionState()
	const { id: modelId, info: model } = useSelectedModel(apiConfiguration)
	const [isTaskExpanded, setIsTaskExpanded] = useState(false)

	// Aggregate diff stats from all accepted file operations in the current task
	// Use clineMessages from extension state which contains the full message history with isAnswered flags
	const diffStats = useTaskDiffStats(clineMessages)
	const hasDiffStats = diffStats.added > 0 || diffStats.removed > 0

	const textContainerRef = useRef<HTMLDivElement>(null)
	const textRef = useRef<HTMLDivElement>(null)
	const contextWindow = model?.contextWindow || 1

	const { width: windowWidth } = useWindowSize()

	const condenseButton = (
		<StandardTooltip content={t("chat:task.condenseContext")}>
			<button
				disabled={buttonsDisabled}
				onClick={() => currentTaskItem && handleCondenseContext(currentTaskItem.id)}
				className="shrink-0 min-h-[20px] min-w-[20px] p-[2px] cursor-pointer disabled:cursor-not-allowed opacity-85 hover:opacity-100 bg-transparent border-none rounded-md">
				<FoldVertical size={16} />
			</button>
		</StandardTooltip>
	)

	const hasTodos = todos && Array.isArray(todos) && todos.length > 0

	return (
		<div className="py-2 px-3">
			<div
				className={cn(
					"p-2.5 flex flex-col relative z-1 border",
					hasTodos ? "rounded-t-xs" : "rounded-xs",
					isTaskExpanded
						? "border-vscode-panel-border text-vscode-foreground"
						: "border-vscode-panel-border/80 text-vscode-foreground/80",
				)}>
				<div className="flex justify-between items-center gap-2">
					<div
						className="flex items-center cursor-pointer -ml-0.5 select-none grow min-w-0"
						onClick={() => setIsTaskExpanded(!isTaskExpanded)}>
						<div className="flex items-center shrink-0">
							<span className={`codicon codicon-chevron-${isTaskExpanded ? "down" : "right"}`}></span>
						</div>
						<div className="ml-1.5 whitespace-nowrap overflow-hidden text-ellipsis grow min-w-0">
							<span className="font-bold">
								{t("chat:task.title")}
								{!isTaskExpanded && ":"}
							</span>
							{!isTaskExpanded && (
								<span style={{ marginLeft: 4 }}>{highlightText(task.text, false, customModes)}</span>
							)}
						</div>
					</div>
					<StandardTooltip content={t("chat:task.closeAndStart")}>
						<Button variant="ghost" size="icon" onClick={onClose} className="shrink-0 w-5 h-5">
							<span className="codicon codicon-close" />
						</Button>
					</StandardTooltip>
				</div>
				{/* Collapsed state: Track context and cost if we have any */}
				{!isTaskExpanded && contextWindow > 0 && (
					<div className={`w-full flex flex-col gap-1 h-auto`}>
						{showTaskTimeline && (
							<TaskTimeline
								groupedMessages={groupedMessages}
								onMessageClick={onMessageClick}
								isTaskActive={isTaskActive}
							/>
						)}

						<div className="flex flex-row items-center gap-1">
							<ContextWindowProgress
								contextWindow={contextWindow}
								contextTokens={contextTokens || 0}
								maxTokens={
									model
										? getModelMaxOutputTokens({ modelId, model, settings: apiConfiguration })
										: undefined
								}
							/>
							{condenseButton}
							<ShareButton item={currentTaskItem} disabled={buttonsDisabled} />
							{showDiffStats !== false && hasDiffStats && (
								<DiffStatsDisplay added={diffStats.added} removed={diffStats.removed} />
							)}
							{!!totalCost && <span>${totalCost.toFixed(2)}</span>}
						</div>
					</div>
				)}
				{/* Expanded state: Show task text and images */}
				{isTaskExpanded && (
					<>
						<div
							ref={textContainerRef}
							className="-mt-0.5 text-vscode-font-size overflow-y-auto break-words break-anywhere relative">
							<div
								ref={textRef}
								className="overflow-auto max-h-80 whitespace-pre-wrap break-words break-anywhere"
								style={{
									display: "-webkit-box",
									WebkitLineClamp: "unset",
									WebkitBoxOrient: "vertical",
								}}>
								{highlightText(task.text, false, customModes)}
							</div>
						</div>
						{task.images && task.images.length > 0 && <Thumbnails images={task.images} />}

						{showTaskTimeline && (
							<TaskTimeline
								groupedMessages={groupedMessages}
								onMessageClick={onMessageClick}
								isTaskActive={isTaskActive}
							/>
						)}

						<div className="flex flex-col gap-1">
							{isTaskExpanded && contextWindow > 0 && (
								<div
									className={`w-full flex ${windowWidth < 400 ? "flex-col" : "flex-row"} gap-1 h-auto`}>
									<div className="flex items-center gap-1 flex-shrink-0">
										<span className="font-bold" data-testid="context-window-label">
											{t("chat:task.contextWindow")}
										</span>
									</div>
									<ContextWindowProgress
										contextWindow={contextWindow}
										contextTokens={contextTokens || 0}
										maxTokens={
											model
												? getModelMaxOutputTokens({
														modelId,
														model,
														settings: apiConfiguration,
													})
												: undefined
										}
									/>
									{condenseButton}
								</div>
							)}
							<div className="flex justify-between items-center h-[20px]">
								<div className="flex items-center gap-1 flex-wrap">
									<span className="font-bold">{t("chat:task.tokens")}</span>
									{typeof tokensIn === "number" && tokensIn > 0 && (
										<span className="flex items-center gap-0.5">
											<i className="codicon codicon-arrow-up text-xs font-bold" />
											{formatLargeNumber(tokensIn)}
										</span>
									)}
									{typeof tokensOut === "number" && tokensOut > 0 && (
										<span className="flex items-center gap-0.5">
											<i className="codicon codicon-arrow-down text-xs font-bold" />
											{formatLargeNumber(tokensOut)}
										</span>
									)}
								</div>
								{!totalCost && <TaskActions item={currentTaskItem} buttonsDisabled={buttonsDisabled} />}
							</div>

							{((typeof cacheReads === "number" && cacheReads > 0) ||
								(typeof cacheWrites === "number" && cacheWrites > 0)) && (
								<div className="flex items-center gap-1 flex-wrap h-[20px]">
									<span className="font-bold">{t("chat:task.cache")}</span>
									{typeof cacheWrites === "number" && cacheWrites > 0 && (
										<span className="flex items-center gap-0.5">
											<CloudUpload size={16} />
											{formatLargeNumber(cacheWrites)}
										</span>
									)}
									{typeof cacheReads === "number" && cacheReads > 0 && (
										<span className="flex items-center gap-0.5">
											<CloudDownload size={16} />
											{formatLargeNumber(cacheReads)}
										</span>
									)}
								</div>
							)}

							{!!totalCost && (
								<div className="flex justify-between items-center h-[20px]">
									<div className="flex items-center gap-1">
										<span className="font-bold">{t("chat:task.apiCost")}</span>
										<span>${totalCost?.toFixed(2)}</span>
									</div>
									<TaskActions item={currentTaskItem} buttonsDisabled={buttonsDisabled} />
								</div>
							)}

							{showDiffStats !== false && hasDiffStats && (
								<div className="flex items-center gap-1 h-[20px]">
									<span className="font-bold">{t("chat:task.changes")}</span>
									<DiffStatsDisplay added={diffStats.added} removed={diffStats.removed} />
								</div>
							)}
						</div>
					</>
				)}
			</div>
			<TodoListDisplay todos={todos ?? (task as any)?.tool?.todos ?? []} />
		</div>
	)
}

/**
 * Highlights slash-command in this text if it exists
 */
const highlightSlashCommands = (text: string, withShadow = true, customModes?: any[]) => {
	const match = text.match(/^\s*\/([a-zA-Z0-9_-]+)(\s*|$)/)
	if (!match) {
		return text
	}

	const commandName = match[1]
	const validationResult = validateSlashCommand(commandName, customModes)

	if (!validationResult || validationResult !== "full") {
		return text
	}

	const commandEndIndex = match[0].length
	const beforeCommand = text.substring(0, text.indexOf("/"))
	const afterCommand = match[2] + text.substring(commandEndIndex)

	return [
		beforeCommand,
		<span
			key="slashCommand"
			className={withShadow ? "mention-context-highlight-with-shadow" : "mention-context-highlight"}>
			/{commandName}
		</span>,
		afterCommand,
	]
}

/**
 * Highlights & formats all mentions inside this text
 */
export const highlightMentions = (text: string, withShadow = true) => {
	const parts = text.split(mentionRegexGlobal)

	return parts.map((part, index) => {
		if (index % 2 === 0) {
			// This is regular text
			return part
		} else {
			// This is a mention
			return (
				<span
					key={index}
					className={withShadow ? "mention-context-highlight-with-shadow" : "mention-context-highlight"}
					style={{ cursor: "pointer" }}
					onClick={() => vscode.postMessage({ type: "openMention", text: part })}>
					@{part}
				</span>
			)
		}
	})
}

/**
 * Handles parsing both mentions and slash-commands
 */
export const highlightText = (text?: string, withShadow = true, customModes?: any[]) => {
	if (!text) {
		return text
	}

	const resultWithSlashHighlighting = highlightSlashCommands(text, withShadow, customModes)

	if (resultWithSlashHighlighting === text) {
		// no highlighting done
		return highlightMentions(resultWithSlashHighlighting, withShadow)
	}

	if (Array.isArray(resultWithSlashHighlighting) && resultWithSlashHighlighting.length === 3) {
		const [beforeCommand, commandElement, afterCommand] = resultWithSlashHighlighting as [
			string,
			JSX.Element,
			string,
		]

		return [beforeCommand, commandElement, ...highlightMentions(afterCommand, withShadow)]
	}

	return [text]
}

export default memo(KiloTaskHeader)
