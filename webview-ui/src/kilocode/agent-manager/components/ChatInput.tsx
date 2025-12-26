import React, { useState, useRef, useEffect } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { useTranslation } from "react-i18next"
import { vscode } from "../utils/vscode"
import { GitBranch, SendHorizontal, Square } from "lucide-react"
import DynamicTextArea from "react-textarea-autosize"
import { cn } from "../../../lib/utils"
import { StandardTooltip } from "../../../components/ui"
import { sessionInputAtomFamily } from "../state/atoms/sessions"
import { sessionTodoStatsAtomFamily } from "../state/atoms/todos"
import { AgentTodoList } from "./AgentTodoList"
import { addToQueueAtom } from "../state/atoms/messageQueue"

interface ChatInputProps {
	sessionId: string
	sessionLabel?: string
	isActive?: boolean
	showCancel?: boolean
	showFinishToBranch?: boolean
	worktreeBranchName?: string
	sessionStatus?: "creating" | "running" | "done" | "error" | "stopped"
}

export const ChatInput: React.FC<ChatInputProps> = ({
	sessionId,
	sessionLabel,
	isActive = false,
	showCancel = false,
	showFinishToBranch = false,
	worktreeBranchName,
	sessionStatus,
}) => {
	const { t } = useTranslation("agentManager")
	const [messageText, setMessageText] = useAtom(sessionInputAtomFamily(sessionId))
	const todoStats = useAtomValue(sessionTodoStatsAtomFamily(sessionId))
	const [isFocused, setIsFocused] = useState(false)
	const textareaRef = useRef<HTMLTextAreaElement>(null)
	const addToQueue = useSetAtom(addToQueueAtom)

	// Auto-focus the textarea when the session changes (user selects a different session)
	useEffect(() => {
		textareaRef.current?.focus()
	}, [sessionId])

	const trimmedMessage = messageText.trim()
	const isEmpty = trimmedMessage.length === 0
	const isSessionCompleted = sessionStatus === "done" || sessionStatus === "error" || sessionStatus === "stopped"

	// Send is disabled when empty
	// Note: Users CAN queue multiple messages while one is sending (for running sessions)
	// Note: Users CAN send messages to completed sessions (to resume them)
	const sendDisabled = isEmpty

	const handleSend = () => {
		if (isEmpty) return

		if (isSessionCompleted) {
			// Resume a completed session with a new message (sent directly, not queued)
			vscode.postMessage({
				type: "agentManager.resumeSession",
				sessionId,
				sessionLabel,
				content: trimmedMessage,
			})
			setMessageText("")
		} else {
			// For running sessions, queue the message instead of sending directly
			const queuedMsg = addToQueue({ sessionId, content: trimmedMessage })

			if (queuedMsg) {
				// Notify the extension that a message has been queued
				vscode.postMessage({
					type: "agentManager.messageQueued",
					sessionId,
					messageId: queuedMsg.id,
					sessionLabel,
					content: trimmedMessage,
				})

				setMessageText("")
			}
		}
	}

	const handleCancel = () => {
		vscode.postMessage({
			type: "agentManager.cancelSession",
			sessionId,
		})
	}

	const handleFinishToBranch = () => {
		vscode.postMessage({
			type: "agentManager.finishWorktreeSession",
			sessionId,
		})
	}

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
			e.preventDefault()
			handleSend()
		}
	}

	const hasTodos = todoStats.totalCount > 0

	return (
		<div className="am-chat-input-container">
			{/* Unified wrapper when todos present - handles border and focus state */}
			<div
				className={cn(
					"relative flex-1 flex flex-col min-h-0 overflow-hidden rounded",
					hasTodos && [
						"border bg-vscode-input-background",
						isFocused
							? "border-vscode-focusBorder outline outline-vscode-focusBorder"
							: "border-vscode-input-border",
					],
				)}>
				{/* Todo list above input */}
				{hasTodos && <AgentTodoList stats={todoStats} isIntegrated />}
				<div className={cn("relative", "flex-1", "flex", "flex-col-reverse", "min-h-0", "overflow-hidden")}>
					<DynamicTextArea
						ref={textareaRef}
						value={messageText}
						onChange={(e) => setMessageText(e.target.value)}
						onKeyDown={handleKeyDown}
						onFocus={() => setIsFocused(true)}
						onBlur={() => setIsFocused(false)}
						aria-label={t("chatInput.ariaLabel")}
						placeholder={t("chatInput.placeholderTypeTask")}
						minRows={3}
						maxRows={15}
						className={cn(
							"w-full",
							"text-vscode-input-foreground",
							"font-vscode-font-family",
							"text-vscode-editor-font-size",
							"leading-vscode-editor-line-height",
							"cursor-text",
							"!pt-3 !pl-3 pr-9",
							// Only show border when no todos (standalone mode)
							!hasTodos && [
								isFocused
									? "border border-vscode-focusBorder outline outline-vscode-focusBorder"
									: "border border-vscode-input-border",
								"rounded",
							],
							"bg-vscode-input-background",
							"transition-background-color duration-150 ease-in-out",
							"will-change-background-color",
							"min-h-[90px]",
							"box-border",
							"resize-none",
							"overflow-x-hidden",
							"overflow-y-auto",
							"!pb-10",
							"flex-none flex-grow",
							"z-[2]",
							"scrollbar-none",
							"scrollbar-hide",
						)}
					/>

					{/* Transparent overlay at bottom */}
					<div
						className="absolute bottom-[1px] left-2 right-2 h-10 bg-gradient-to-t from-[var(--vscode-input-background)] via-[var(--vscode-input-background)] to-transparent pointer-events-none z-[2]"
						aria-hidden="true"
					/>

					{/* Floating Actions */}
					<div className="absolute bottom-2 right-2 z-30 flex gap-1">
						{showFinishToBranch && (
							<StandardTooltip
								content={
									worktreeBranchName
										? t("chatInput.finishToBranchTitle", { branch: worktreeBranchName })
										: t("chatInput.finishToBranchTitleNoBranch")
								}>
								<button
									aria-label={
										worktreeBranchName
											? t("chatInput.finishToBranchTitle", { branch: worktreeBranchName })
											: t("chatInput.finishToBranchTitleNoBranch")
									}
									onClick={handleFinishToBranch}
									className={cn(
										"relative inline-flex items-center justify-center",
										"bg-transparent border-none p-1.5",
										"rounded-md min-w-[28px] min-h-[28px]",
										"opacity-60 hover:opacity-100 text-vscode-descriptionForeground hover:text-vscode-foreground",
										"transition-all duration-150",
										"hover:bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.15)]",
										"focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder",
										"active:bg-[rgba(255,255,255,0.1)]",
										"cursor-pointer",
									)}>
									<GitBranch size={14} />
								</button>
							</StandardTooltip>
						)}
						{isActive && showCancel && (
							<StandardTooltip content={t("chatInput.cancelTitle")}>
								<button
									aria-label={t("chatInput.cancelTitle")}
									onClick={handleCancel}
									className={cn(
										"relative inline-flex items-center justify-center",
										"bg-transparent border-none p-1.5",
										"rounded-md min-w-[28px] min-h-[28px]",
										"opacity-60 hover:opacity-100 text-vscode-errorForeground",
										"transition-all duration-150",
										"hover:bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.15)]",
										"focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder",
										"active:bg-[rgba(255,255,255,0.1)]",
										"cursor-pointer",
									)}>
									<Square size={14} fill="currentColor" />
								</button>
							</StandardTooltip>
						)}
						<StandardTooltip content={t("chatInput.sendTitle")}>
							<button
								aria-label={t("chatInput.sendTitle")}
								disabled={sendDisabled}
								onClick={handleSend}
								className={cn(
									"relative inline-flex items-center justify-center",
									"bg-transparent border-none p-1.5",
									"rounded-md min-w-[28px] min-h-[28px]",
									"opacity-60 hover:opacity-100 text-vscode-descriptionForeground hover:text-vscode-foreground",
									"transition-all duration-150",
									"hover:bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.15)]",
									"focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder",
									"active:bg-[rgba(255,255,255,0.1)]",
									!sendDisabled && "cursor-pointer",
									sendDisabled &&
										"opacity-40 cursor-not-allowed grayscale-[30%] hover:bg-transparent hover:border-[rgba(255,255,255,0.08)] active:bg-transparent",
								)}>
								{/* rtl support */}
								<SendHorizontal className="w-4 h-4 rtl:-scale-x-100" />
							</button>
						</StandardTooltip>
					</div>

					{/* Hint Text inside input */}
					{!messageText && (
						<div
							className="absolute left-3 right-[70px] z-30 flex items-center h-8 overflow-hidden text-ellipsis whitespace-nowrap"
							style={{
								bottom: "0.25rem",
								color: "var(--vscode-descriptionForeground)",
								opacity: 0.7,
								fontSize: "11px",
								userSelect: "none",
								pointerEvents: "none",
							}}>
							{t("chatInput.hint")}
						</div>
					)}
				</div>
			</div>
		</div>
	)
}
