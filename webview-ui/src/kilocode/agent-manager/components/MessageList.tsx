import React, { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { useAtomValue, useSetAtom } from "jotai"
import { useTranslation } from "react-i18next"
import { Virtuoso, VirtuosoHandle } from "react-virtuoso"
import { sessionMessagesAtomFamily } from "../state/atoms/messages"
import { sessionInputAtomFamily, selectedSessionAtom } from "../state/atoms/sessions"
import {
	sessionMessageQueueAtomFamily,
	sessionSendingMessageIdAtomFamily,
	removeFromQueueAtom,
	retryFailedMessageAtom,
} from "../state/atoms/messageQueue"
import type { QueuedMessage } from "../state/atoms/messageQueue"
import type { ClineMessage, SuggestionItem, FollowUpData } from "@roo-code/types"
import { safeJsonParse } from "@roo/safeJsonParse"
import { combineCommandSequences } from "@roo/combineCommandSequences"
import { SimpleMarkdown } from "./SimpleMarkdown"
import { FollowUpSuggestions } from "./FollowUpSuggestions"
import { CommandExecutionBlock } from "./CommandExecutionBlock"
import { vscode } from "../utils/vscode"
import {
	MessageCircle,
	MessageCircleQuestion,
	ArrowRightLeft,
	TerminalSquare,
	CheckCircle2,
	AlertCircle,
	User,
	Clock,
	Loader,
	Check,
	X,
} from "lucide-react"
import { cn } from "../../../lib/utils"

interface MessageListProps {
	sessionId: string
}

// Parse exit code from various formats (number, string, etc.)
function parseExitCode(raw: unknown): number | undefined {
	if (typeof raw === "number") return raw
	if (typeof raw === "string" && raw.trim() && !Number.isNaN(Number(raw))) return Number(raw)
	return undefined
}

// Extract execution metadata from command output message
function extractCommandMetadata(msg: ClineMessage): { exitCode?: number; status?: string; isRunning?: boolean } | null {
	const metadata = msg.metadata as Record<string, unknown> | undefined
	if (!metadata) return null

	return {
		exitCode: parseExitCode(metadata.exitCode),
		status: typeof metadata.status === "string" ? metadata.status : undefined,
		isRunning: msg.partial ?? false,
	}
}

/**
 * Displays messages for a session from Jotai state.
 */
export function MessageList({ sessionId }: MessageListProps) {
	const { t } = useTranslation("agentManager")
	const messages = useAtomValue(sessionMessagesAtomFamily(sessionId))
	const queue = useAtomValue(sessionMessageQueueAtomFamily(sessionId))
	const sendingMessageId = useAtomValue(sessionSendingMessageIdAtomFamily(sessionId))
	const setInputValue = useSetAtom(sessionInputAtomFamily(sessionId))
	const retryFailedMessage = useSetAtom(retryFailedMessageAtom)
	const removeFromQueue = useSetAtom(removeFromQueueAtom)
	const selectedSession = useAtomValue(selectedSessionAtom)
	const virtuosoRef = useRef<VirtuosoHandle>(null)

	// Get session's yoloMode - if true, don't show approval buttons
	const sessionYoloMode = selectedSession?.yoloMode ?? true // Default true for backward compat

	// Combine command and command_output messages into single entries
	const combinedMessages = useMemo(() => combineCommandSequences(messages), [messages])

	const commandExecutionByTs = useMemo(() => {
		const info = new Map<number, { exitCode?: number; status?: string; isRunning?: boolean }>()

		for (let i = 0; i < messages.length; i++) {
			const msg = messages[i]
			if (msg.type !== "ask" || msg.ask !== "command") continue

			let data: { exitCode?: number; status?: string; isRunning?: boolean } | null = null

			// Find output messages following this command
			for (let j = i + 1; j < messages.length; j++) {
				const next = messages[j]
				if (next.type === "ask" && next.ask === "command") break
				if (next.ask !== "command_output" && next.say !== "command_output") continue

				const extracted = extractCommandMetadata(next)
				if (extracted) {
					// Merge data, keeping exitCode if we already have it
					// (ask.command_output has exitCode, say.command_output doesn't)
					if (data === null) {
						data = extracted
					} else {
						data = {
							exitCode: data.exitCode ?? extracted.exitCode,
							status: extracted.status ?? data.status,
							isRunning: extracted.isRunning,
						}
					}
				}
			}

			if (data) info.set(msg.ts, data)
		}

		return info
	}, [messages])

	// Auto-scroll to bottom when new messages arrive using Virtuoso API
	useEffect(() => {
		if (combinedMessages.length > 0) {
			virtuosoRef.current?.scrollToIndex({
				index: combinedMessages.length - 1,
				behavior: "smooth",
			})
		}
	}, [combinedMessages.length])

	const handleSuggestionClick = useCallback(
		(suggestion: SuggestionItem) => {
			vscode.postMessage({
				type: "agentManager.sendMessage",
				sessionId,
				content: suggestion.answer,
			})
		},
		[sessionId],
	)

	const handleCopyToInput = useCallback(
		(suggestion: SuggestionItem) => {
			setInputValue((current) => (current !== "" ? `${current} \n${suggestion.answer}` : suggestion.answer))
		},
		[setInputValue],
	)

	const handleRetryMessage = useCallback(
		(sessionId: string, messageId: string) => {
			retryFailedMessage({ sessionId, messageId })
		},
		[retryFailedMessage],
	)

	const handleDiscardMessage = useCallback(
		(sessionId: string, messageId: string) => {
			removeFromQueue({ sessionId, messageId })
		},
		[removeFromQueue],
	)

	// Combine messages and queued messages for virtualization
	const allItems = useMemo(() => {
		return [...combinedMessages, ...queue.map((q) => ({ type: "queued" as const, data: q }))]
	}, [combinedMessages, queue])

	// Item content renderer for Virtuoso
	const itemContent = useCallback(
		(index: number, item: ClineMessage | { type: "queued"; data: QueuedMessage }) => {
			// Check if this is a queued message
			if ("type" in item && item.type === "queued") {
				const queuedMsg = item.data
				return (
					<QueuedMessageItem
						key={`queued-${queuedMsg.id}`}
						queuedMessage={queuedMsg}
						isSending={sendingMessageId === queuedMsg.id}
						onRetry={handleRetryMessage}
						onDiscard={handleDiscardMessage}
					/>
				)
			}

			// Regular message
			const msg = item as ClineMessage
			// isLastCombinedMessage: true for the last regular message, excluding queued user messages
			const isLastCombinedMessage = index === combinedMessages.length - 1
			return (
				<MessageItem
					key={msg.ts || index}
					message={msg}
					isLast={isLastCombinedMessage}
					sessionId={sessionId}
					sessionYoloMode={sessionYoloMode}
					allMessages={messages}
					commandExecutionByTs={commandExecutionByTs}
					onSuggestionClick={handleSuggestionClick}
					onCopyToInput={handleCopyToInput}
				/>
			)
		},
		[
			combinedMessages.length,
			messages,
			commandExecutionByTs,
			handleSuggestionClick,
			handleCopyToInput,
			sendingMessageId,
			handleRetryMessage,
			handleDiscardMessage,
			sessionId,
			sessionYoloMode,
		],
	)

	if (messages.length === 0 && queue.length === 0) {
		return (
			<div className="am-messages-empty">
				<MessageCircle className="w-12 h-12 mx-auto mb-4 opacity-20" />
				<p>{t("messages.waiting")}</p>
			</div>
		)
	}

	return (
		<div className="am-messages-container">
			<Virtuoso
				ref={virtuosoRef}
				data={allItems}
				itemContent={itemContent}
				followOutput="smooth"
				increaseViewportBy={{ top: 400, bottom: 400 }}
				className="am-messages-list"
			/>
		</div>
	)
}

interface FollowUpMetadata {
	question?: string
	suggest?: SuggestionItem[]
}

function extractFollowUpData(message: ClineMessage): { question: string; suggestions?: SuggestionItem[] } | null {
	const messageText = message.text || (message as { content?: string }).content || ""
	const metadata = (message.metadata as FollowUpMetadata | undefined) ?? {}
	const parsedData = safeJsonParse<FollowUpData>(messageText)

	const question = metadata.question || parsedData?.question || messageText
	const suggestions = metadata.suggest || parsedData?.suggest

	if (!question) return null
	return { question, suggestions }
}

interface MessageItemProps {
	message: ClineMessage
	isLast: boolean
	sessionId: string
	sessionYoloMode: boolean
	allMessages: ClineMessage[]
	commandExecutionByTs: Map<number, { exitCode?: number; status?: string; isRunning?: boolean }>
	onSuggestionClick?: (suggestion: SuggestionItem) => void
	onCopyToInput?: (suggestion: SuggestionItem) => void
}

function MessageItem({
	message,
	isLast,
	sessionId,
	sessionYoloMode,
	allMessages,
	commandExecutionByTs,
	onSuggestionClick,
	onCopyToInput,
}: MessageItemProps) {
	const { t } = useTranslation("agentManager")

	// --- 1. Determine Message Style & Content ---
	// Note: CLI JSON output uses "content" instead of "text" for message body
	const messageText = message.text || (message as any).content || ""

	let icon = <MessageCircle size={16} />
	let title = t("messages.kiloSaid")
	let content: React.ReactNode = null
	let extraInfo: React.ReactNode = null
	let suggestions: SuggestionItem[] | undefined
	let needsApproval = false // Track if this ask message needs approval buttons
	let wasAutoApproved = false // Track if command was auto-approved (executed without user action)
	let wasDenied = false // Track if user clicked Deny button
	let userRespondedViaText = false // Track if user responded via text instead of clicking buttons

	// --- SAY ---
	if (message.type === "say") {
		switch (message.say) {
			case "api_req_started": {
				icon = <ArrowRightLeft size={16} className="opacity-70" />
				title = t("messages.apiRequest")
				const info = safeJsonParse<{ cost?: number }>(messageText)
				if (info?.cost !== undefined) {
					extraInfo = <span className="am-message-cost">${info.cost.toFixed(4)}</span>
				}
				// Don't show content for API req started, just header
				content = null
				break
			}
			case "text": {
				icon = <MessageCircle size={16} />
				title = t("messages.kiloSaid")
				content = <SimpleMarkdown content={messageText} />
				break
			}
			case "user_feedback": {
				icon = <User size={16} />
				title = t("messages.youSaid")
				content = <SimpleMarkdown content={messageText} />
				break
			}
			case "completion_result": {
				icon = <CheckCircle2 size={16} className="text-green-500" />
				title = t("messages.taskCompleted")
				content = <SimpleMarkdown content={messageText} />
				break
			}
			case "error": {
				icon = <AlertCircle size={16} className="text-red-500" />
				title = t("messages.error")
				content = <SimpleMarkdown content={messageText} />
				break
			}
			case "api_req_finished":
			case "checkpoint_saved":
			case "command_output":
				return null // Skip internal messages (command_output is combined with command)
			default:
				content = <SimpleMarkdown content={messageText} />
		}
	}

	// --- ASK ---
	if (message.type === "ask") {
		switch (message.ask) {
			case "followup": {
				icon = <MessageCircleQuestion size={16} />
				title = t("messages.question")
				const followUpData = extractFollowUpData(message)
				suggestions = followUpData?.suggestions
				content = (
					<div>
						<SimpleMarkdown content={followUpData?.question || messageText} />
					</div>
				)
				break
			}
			case "command": {
				icon = <TerminalSquare size={16} />
				title = t("messages.command")
				const execInfo = commandExecutionByTs.get(message.ts)
				content = (
					<CommandExecutionBlock
						text={messageText}
						isRunning={execInfo?.isRunning ?? message.partial}
						isLast={isLast}
						exitCode={execInfo?.exitCode}
						terminalStatus={execInfo?.status}
					/>
				)
				// Show approval buttons only when NOT in YOLO mode
				if (!sessionYoloMode) {
					needsApproval = true
					// Check if command was executed or user responded via text
					const msgIndex = allMessages.findIndex((m) => m.ts === message.ts)
					if (msgIndex !== -1) {
						const messagesAfter = allMessages.slice(msgIndex + 1)
						const hasOutput = messagesAfter.some((m) => m.type === "say" && m.say === "command_output")
						const userFeedbackMsg = messagesAfter.find((m) => m.type === "say" && m.say === "user_feedback")
						if (hasOutput) {
							wasAutoApproved = true
						} else if (userFeedbackMsg) {
							const feedbackText = userFeedbackMsg.text || (userFeedbackMsg as any).content || ""
							if (feedbackText === "User denied this operation") {
								wasDenied = true
							} else {
								userRespondedViaText = true
							}
						}
					}
				}
				break
			}
			case "command_output": {
				// Skip standalone command_output - combined with command message
				return null
			}
			case "tool": {
				// Tool info can be in metadata (from CLI) or parsed from text
				const metadata = message.metadata as { tool?: string; path?: string; todos?: unknown[] } | undefined
				const toolInfo = metadata?.tool ? metadata : safeJsonParse<{ tool: string; path?: string }>(messageText)
				// Skip updateTodoList - it's displayed in the header via TodoListDisplay
				if (toolInfo?.tool === "updateTodoList") {
					return null
				}
				icon = <TerminalSquare size={16} />
				title = t("messages.tool")
				// Try to parse tool use for better display
				if (toolInfo) {
					const toolDetails = toolInfo.path ? `(${toolInfo.path})` : ""
					content = (
						<SimpleMarkdown
							content={t("messages.usingTool", { tool: toolInfo.tool, details: toolDetails })}
						/>
					)
				} else {
					content = <SimpleMarkdown content={messageText} />
				}
				// Show approval buttons only when NOT in YOLO mode and not already answered
				if (!sessionYoloMode && !message.isAnswered) {
					needsApproval = true
					// Check if user responded via text or clicked Deny
					const msgIndex = allMessages.findIndex((m) => m.ts === message.ts)
					if (msgIndex !== -1) {
						const userFeedbackMsg = allMessages
							.slice(msgIndex + 1)
							.find((m) => m.type === "say" && m.say === "user_feedback")
						if (userFeedbackMsg) {
							const feedbackText = userFeedbackMsg.text || (userFeedbackMsg as any).content || ""
							if (feedbackText === "User denied this operation") {
								wasDenied = true
							} else {
								userRespondedViaText = true
							}
						}
					}
				}
				break
			}
			default:
				content = <SimpleMarkdown content={messageText} />
		}
	}

	return (
		<div
			className={`am-message-item ${message.type === "say" && message.say === "api_req_started" ? "am-api-req" : ""}`}>
			<div className="am-message-icon">{icon}</div>
			<div className="am-message-content-wrapper">
				<div className="am-message-header">
					<span className="am-message-author">{title}</span>
					<span className="am-message-ts">{new Date(message.ts).toLocaleTimeString()}</span>
					{extraInfo}
				</div>
				{content && <div className="am-message-body">{content}</div>}
				{needsApproval && (
					<ApprovalButtons
						sessionId={sessionId}
						messageTs={message.ts}
						isAnswered={message.isAnswered}
						wasAutoApproved={wasAutoApproved}
						wasDenied={wasDenied}
						userRespondedViaText={userRespondedViaText}
					/>
				)}
				{suggestions && suggestions.length > 0 && onSuggestionClick && (
					<FollowUpSuggestions
						suggestions={suggestions}
						onSuggestionClick={onSuggestionClick}
						onCopyToInput={onCopyToInput}
					/>
				)}
			</div>
		</div>
	)
}

/**
 * Approval buttons for ask messages when YOLO mode is OFF.
 * Shows Approve/Deny buttons that send responses via JSON-IO to the CLI.
 */
interface ApprovalButtonsProps {
	sessionId: string
	messageTs: number
	isAnswered?: boolean
	wasAutoApproved?: boolean // True if command was executed without user action
	wasDenied?: boolean // True if user clicked Deny button
	userRespondedViaText?: boolean // True if user responded via text input instead of clicking buttons
}

function ApprovalButtons({
	sessionId,
	messageTs,
	isAnswered,
	wasAutoApproved,
	wasDenied,
	userRespondedViaText,
}: ApprovalButtonsProps) {
	const { t } = useTranslation("agentManager")
	// Track which button was clicked: "approved" | "denied" | null
	const [response, setResponse] = useState<"approved" | "denied" | null>(null)

	// Determine final state: user clicked OR auto-approved by CLI OR command executed OR denied OR user responded via text
	const isResolved = response !== null || isAnswered || wasAutoApproved || wasDenied || userRespondedViaText
	// Determine which button should appear selected
	// Priority: local click state > wasDenied > wasAutoApproved/isAnswered > null (for text response)
	const effectiveResponse =
		response ??
		(wasDenied ? "denied" : userRespondedViaText ? null : isAnswered || wasAutoApproved ? "approved" : null)

	const handleApprove = () => {
		if (isResolved) return
		setResponse("approved")
		vscode.postMessage({
			type: "agentManager.respondToApproval",
			sessionId,
			approved: true,
			messageTs,
		})
	}

	const handleDeny = () => {
		if (isResolved) return
		setResponse("denied")
		vscode.postMessage({
			type: "agentManager.respondToApproval",
			sessionId,
			approved: false,
			text: "User denied this operation",
			messageTs,
		})
	}

	return (
		<div className="am-approval-buttons" role="group" aria-label="Approval actions">
			<button
				className={cn(
					"am-approve-btn",
					isResolved && "am-approval-disabled",
					effectiveResponse === "approved" && "am-approval-selected",
				)}
				onClick={handleApprove}
				disabled={isResolved}
				aria-label={t("messages.approve")}>
				<Check size={14} />
				{t("messages.approve")}
			</button>
			<button
				className={cn(
					"am-deny-btn",
					isResolved && "am-approval-disabled",
					effectiveResponse === "denied" && "am-approval-selected",
				)}
				onClick={handleDeny}
				disabled={isResolved}
				aria-label={t("messages.deny")}>
				<X size={14} />
				{t("messages.deny")}
			</button>
		</div>
	)
}

interface QueuedMessageItemProps {
	queuedMessage: QueuedMessage
	isSending: boolean
	onRetry: (sessionId: string, messageId: string) => void
	onDiscard: (sessionId: string, messageId: string) => void
}

function QueuedMessageItem({ queuedMessage, isSending: _isSending, onRetry, onDiscard }: QueuedMessageItemProps) {
	const { t } = useTranslation("agentManager")

	let icon = <Clock size={16} className="opacity-70" />
	let statusText = t("chatInput.messageSending")
	let statusColor = "text-vscode-descriptionForeground"

	if (queuedMessage.status === "sending") {
		icon = <Loader size={16} className="animate-spin opacity-70" />
		statusText = t("chatInput.messageSending")
		statusColor = "text-vscode-descriptionForeground"
	} else if (queuedMessage.status === "failed") {
		icon = <AlertCircle size={16} className="text-vscode-errorForeground" />
		statusText = queuedMessage.error || "Failed to send message"
		statusColor = "text-vscode-errorForeground"
	} else {
		icon = <Clock size={16} className="opacity-70" />
		statusText = t("chatInput.messageSending")
		statusColor = "text-vscode-descriptionForeground"
	}

	const handleRetry = () => {
		onRetry(queuedMessage.sessionId, queuedMessage.id)
	}

	const handleDiscard = () => {
		onDiscard(queuedMessage.sessionId, queuedMessage.id)
	}

	const canRetry = queuedMessage.retryCount < queuedMessage.maxRetries

	return (
		<div className={cn("am-message-item", queuedMessage.status === "failed" && "opacity-75")}>
			<div className="am-message-icon">{icon}</div>
			<div className="am-message-content-wrapper">
				<div className="am-message-header">
					<span className="am-message-author text-vscode-descriptionForeground">{t("messages.youSaid")}</span>
					<span className={cn("am-message-ts text-xs", statusColor)}>{statusText}</span>
				</div>
				<div className="am-message-body">
					<SimpleMarkdown content={queuedMessage.content} />
				</div>
				{queuedMessage.status === "failed" && (
					<div className="mt-2 space-y-2">
						{queuedMessage.error && (
							<p className="text-xs text-vscode-errorForeground">Error: {queuedMessage.error}</p>
						)}
						{queuedMessage.retryCount > 0 && (
							<p className="text-xs text-vscode-descriptionForeground">
								Retry attempt {queuedMessage.retryCount} of {queuedMessage.maxRetries}
							</p>
						)}
						<div className="flex gap-2">
							{canRetry && (
								<button
									onClick={handleRetry}
									className="text-xs px-2 py-1 rounded bg-vscode-button-background hover:bg-vscode-button-hoverBackground text-vscode-button-foreground">
									Retry
								</button>
							)}
							<button
								onClick={handleDiscard}
								className="text-xs px-2 py-1 rounded bg-vscode-errorBackground hover:opacity-80 text-vscode-errorForeground">
								Discard
							</button>
						</div>
					</div>
				)}
			</div>
		</div>
	)
}
