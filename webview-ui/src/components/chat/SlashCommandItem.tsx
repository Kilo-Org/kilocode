import React from "react"
import { useTranslation } from "react-i18next"
import { VSCodeBadge } from "@vscode/webview-ui-toolkit/react"
import { Edit, Trash2 } from "lucide-react"

import type { Command } from "@roo-code/types"

import { useAppTranslation } from "@/i18n/TranslationContext"
import { Button, StandardTooltip } from "@/components/ui"
import { vscode } from "@/utils/vscode"
import { ToolUseBlock, ToolUseBlockHeader } from "../common/ToolUseBlock"

// kilocode_change start: Add workflow execution support
interface SlashCommandItemProps {
	// Original props for command list mode
	command?: Command
	onDelete?: (command: Command) => void
	onClick?: (command: Command) => void

	// New props for workflow execution mode
	isWorkflowExecution?: boolean
	tool?: {
		tool: "runSlashCommand"
		command: string
		args?: string
		source?: string
		description?: string
	}
	messageType?: "ask" | "say"
	isExpanded?: boolean
	onToggleExpand?: () => void
}
// kilocode_change end

export const SlashCommandItem: React.FC<SlashCommandItemProps> = ({
	command,
	onDelete,
	onClick,
	isWorkflowExecution,
	tool,
	messageType = "say",
	isExpanded = false,
	onToggleExpand,
}) => {
	const { t: tList } = useAppTranslation() // kilocode_change: always call hooks at top level
	const { t: t2 } = useTranslation() // kilocode_change: for workflow execution translations

	// kilocode_change: Add diagnostic logging for workflow display issue
	console.log(`[SlashCommandItem] Rendering with props:`, {
		isWorkflowExecution,
		tool,
		messageType,
		isExpanded,
		toolKeys: tool ? Object.keys(tool) : "no tool",
	})
	// kilocode_change end

	// kilocode_change start: Workflow execution mode
	if (isWorkflowExecution && tool) {
		// kilocode_change: Add diagnostic logging for workflow display issue
		console.log(`[SlashCommandItem] Rendering workflow execution UI with tool:`, tool)
		// kilocode_change end
		const slashCommandInfo = tool

		return (
			<>
				<div className="flex items-center gap-2.5 mb-2.5" style={{ wordBreak: "break-word" }}>
					<span
						className="codicon codicon-play"
						style={{ color: "var(--vscode-foreground)", marginBottom: "-1.5px" }}></span>
					<span style={{ fontWeight: "bold" }}>
						{messageType === "ask" ? t2("chat:slashCommand.wantsToRun") : t2("chat:slashCommand.didRun")}
					</span>
				</div>
				{messageType === "ask" ? (
					<div
						className="mt-1"
						style={{
							backgroundColor: "var(--vscode-editor-background)",
							border: "1px solid var(--vscode-editorGroup-border)",
							borderRadius: "4px",
							overflow: "hidden",
							cursor: "pointer",
						}}
						onClick={onToggleExpand}>
						<ToolUseBlockHeader
							className="group"
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "space-between",
								padding: "10px 12px",
							}}>
							<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
								<span style={{ fontWeight: "500", fontSize: "var(--vscode-font-size)" }}>
									/{slashCommandInfo.command}
								</span>
								{slashCommandInfo.source && (
									<VSCodeBadge style={{ fontSize: "calc(var(--vscode-font-size) - 2px)" }}>
										{slashCommandInfo.source}
									</VSCodeBadge>
								)}
							</div>
							<span
								className={`codicon codicon-chevron-${isExpanded ? "up" : "down"} opacity-0 group-hover:opacity-100 transition-opacity duration-200`}></span>
						</ToolUseBlockHeader>
						{isExpanded && (slashCommandInfo.args || slashCommandInfo.description) && (
							<div
								className="p-3"
								style={{
									borderTop: "1px solid var(--vscode-editorGroup-border)",
									display: "flex",
									flexDirection: "column",
									gap: "8px",
								}}>
								{slashCommandInfo.args && (
									<div>
										<span style={{ fontWeight: "500" }}>Arguments: </span>
										<span style={{ color: "var(--vscode-descriptionForeground)" }}>
											{slashCommandInfo.args}
										</span>
									</div>
								)}
								{slashCommandInfo.description && (
									<div style={{ color: "var(--vscode-descriptionForeground)" }}>
										{slashCommandInfo.description}
									</div>
								)}
							</div>
						)}
					</div>
				) : (
					<div className="pl-6">
						<ToolUseBlock>
							<ToolUseBlockHeader
								style={{
									display: "flex",
									flexDirection: "column",
									alignItems: "flex-start",
									gap: "4px",
									padding: "10px 12px",
								}}>
								<div
									style={{
										display: "flex",
										alignItems: "center",
										gap: "8px",
										width: "100%",
									}}>
									<span style={{ fontWeight: "500", fontSize: "var(--vscode-font-size)" }}>
										/{slashCommandInfo.command}
									</span>
									{slashCommandInfo.args && (
										<span
											style={{
												color: "var(--vscode-descriptionForeground)",
												fontSize: "var(--vscode-font-size)",
											}}>
											{slashCommandInfo.args}
										</span>
									)}
								</div>
								{slashCommandInfo.description && (
									<div
										style={{
											color: "var(--vscode-descriptionForeground)",
											fontSize: "calc(var(--vscode-font-size) - 1px)",
										}}>
										{slashCommandInfo.description}
									</div>
								)}
								{slashCommandInfo.source && (
									<div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
										<VSCodeBadge style={{ fontSize: "calc(var(--vscode-font-size) - 2px)" }}>
											{slashCommandInfo.source}
										</VSCodeBadge>
									</div>
								)}
							</ToolUseBlockHeader>
						</ToolUseBlock>
					</div>
				)}
			</>
		)
	}
	// kilocode_change end

	// kilocode_change: Add diagnostic logging for workflow display issue
	console.log(
		`[SlashCommandItem] Not rendering workflow execution - returning null. isWorkflowExecution:`,
		isWorkflowExecution,
		", tool:",
		tool,
	)
	// kilocode_change end

	// Original command list mode
	if (!command || !onDelete) {
		return null
	}

	// Built-in commands cannot be edited or deleted
	const isBuiltIn = command.source === "built-in"

	const handleEdit = () => {
		if (command.filePath) {
			vscode.postMessage({
				type: "openFile",
				text: command.filePath,
			})
		} else {
			// Fallback: request to open command file by name and source
			vscode.postMessage({
				type: "openCommandFile",
				text: command.name,
				values: { source: command.source },
			})
		}
	}

	const handleDelete = () => {
		onDelete(command)
	}

	return (
		<div className="px-4 py-2 text-sm flex items-center group hover:bg-vscode-list-hoverBackground">
			{/* Command name - clickable */}
			<div className="flex-1 min-w-0 cursor-pointer" onClick={() => onClick?.(command)}>
				<div>
					<span className="truncate text-vscode-foreground">{command.name}</span>
					{command.description && (
						<div className="text-xs text-vscode-descriptionForeground truncate mt-0.5">
							{command.description}
						</div>
					)}
				</div>
			</div>

			{/* Action buttons - only show for non-built-in commands */}
			{!isBuiltIn && (
				<div className="flex items-center gap-2 ml-2">
					<StandardTooltip content={tList("chat:slashCommands.editCommand")}>
						<Button
							variant="ghost"
							size="icon"
							tabIndex={-1}
							onClick={handleEdit}
							className="size-6 flex items-center justify-center opacity-60 hover:opacity-100">
							<Edit className="w-4 h-4" />
						</Button>
					</StandardTooltip>

					<StandardTooltip content={tList("chat:slashCommands.deleteCommand")}>
						<Button
							variant="ghost"
							size="icon"
							tabIndex={-1}
							onClick={handleDelete}
							className="size-6 flex items-center justify-center opacity-60 hover:opacity-100 hover:text-red-400">
							<Trash2 className="w-4 h-4" />
						</Button>
					</StandardTooltip>
				</div>
			)}
		</div>
	)
}
