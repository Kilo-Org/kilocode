import React, { useEffect, useRef, useCallback } from "react"
import { useAtomValue, useSetAtom } from "jotai"
import { useTranslation } from "react-i18next"
import { sessionMessagesAtomFamily } from "../state/atoms/messages"
import { sessionInputAtomFamily } from "../state/atoms/sessions"
import type { ClineMessage, SuggestionItem, FollowUpData } from "@roo-code/types"
import { safeJsonParse } from "@roo/safeJsonParse"
import { SimpleMarkdown } from "./SimpleMarkdown"
import { FollowUpSuggestions } from "./FollowUpSuggestions"
import { vscode } from "../utils/vscode"
import {
	MessageCircle,
	MessageCircleQuestion,
	ArrowRightLeft,
	TerminalSquare,
	CheckCircle2,
	AlertCircle,
	User,
} from "lucide-react"

interface MessageListProps {
	sessionId: string
}

/**
 * Displays messages for a session from Jotai state.
 */
export function MessageList({ sessionId }: MessageListProps) {
	const { t } = useTranslation("agentManager")
	const messages = useAtomValue(sessionMessagesAtomFamily(sessionId))
	const setInputValue = useSetAtom(sessionInputAtomFamily(sessionId))
	const containerRef = useRef<HTMLDivElement>(null)

	// Auto-scroll to bottom when new messages arrive
	useEffect(() => {
		if (containerRef.current) {
			// Use requestAnimationFrame to ensure the DOM has updated
			requestAnimationFrame(() => {
				if (containerRef.current) {
					containerRef.current.scrollTop = containerRef.current.scrollHeight
				}
			})
		}
	}, [messages])

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

	if (messages.length === 0) {
		return (
			<div className="am-messages-empty">
				<MessageCircle className="w-12 h-12 mx-auto mb-4 opacity-20" />
				<p>{t("messages.waiting")}</p>
			</div>
		)
	}

	return (
		<div className="am-messages-container" ref={containerRef}>
			<div className="am-messages-list">
				{messages.map((msg, idx) => (
					<MessageItem
						key={msg.ts || idx}
						message={msg}
						onSuggestionClick={handleSuggestionClick}
						onCopyToInput={handleCopyToInput}
					/>
				))}
			</div>
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
	onSuggestionClick?: (suggestion: SuggestionItem) => void
	onCopyToInput?: (suggestion: SuggestionItem) => void
}

function MessageItem({ message, onSuggestionClick, onCopyToInput }: MessageItemProps) {
	const { t } = useTranslation("agentManager")

	// --- 1. Determine Message Style & Content ---
	// Note: CLI JSON output uses "content" instead of "text" for message body
	const messageText = message.text || (message as any).content || ""

	let icon = <MessageCircle size={16} />
	let title = t("messages.kiloSaid")
	let content: React.ReactNode = null
	let extraInfo: React.ReactNode = null
	let suggestions: SuggestionItem[] | undefined

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
				return null // Skip internal messages
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
				content = <SimpleMarkdown content={`\`${messageText}\``} />
				break
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
