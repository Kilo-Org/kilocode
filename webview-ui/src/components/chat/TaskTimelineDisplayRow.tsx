import { memo, useMemo, useRef, useEffect, useCallback, useState } from "react"
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso"
import type { ClineMessage } from "@roo-code/types"
import { useTranslation } from "react-i18next"

interface TaskTimelineDisplayRowProps {
	groupedMessages: (ClineMessage | ClineMessage[])[]
	onMessageClick: (index: number) => void
	currentMessageIndex?: number
	className?: string
	isTaskActive?: boolean
}

interface MessageSquareData {
	index: number
	color: string
	isActive: boolean
	message: ClineMessage | ClineMessage[]
	isNew: boolean
}

const getMessageTypeColor = (message: ClineMessage | ClineMessage[]): string => {
	if (Array.isArray(message)) {
		return "bg-cyan-400" // Cyan for grouped messages
	}

	const singleMessage = message as ClineMessage
	if (singleMessage.type === "ask") {
		switch (singleMessage.ask) {
			case "followup":
				return "bg-gray-300" // Light gray for user messages
			case "command":
				return "bg-purple-500" // Purple for command approvals
			case "tool":
				// Parse tool data for more specific coloring
				if (singleMessage.text) {
					try {
						const toolData = JSON.parse(singleMessage.text)
						if (
							toolData.tool === "read_file" ||
							toolData.tool === "list_files" ||
							toolData.tool === "list_code_definition_names" ||
							toolData.tool === "search_files"
						) {
							return "bg-yellow-300" // Yellow for file read operations
						} else if (toolData.tool === "apply_diff" || toolData.tool === "write_to_file") {
							return "bg-blue-500" // Blue for file edit/create operations
						} else if (toolData.tool === "browser_action") {
							return "bg-purple-500" // Purple for browser actions
						}
					} catch (_e) {
						// JSON parse error, use default
					}
				}
				return "bg-yellow-300" // Default yellow for tool approvals
			case "browser_action_launch":
				return "bg-purple-500" // Purple for browser launch approvals
			case "use_mcp_server":
				return "bg-orange-400" // Orange for MCP server
			case "api_req_failed":
				return "bg-red-500" // Red for errors
			case "completion_result":
				return "bg-green-500" // Green for task completion
			default:
				return "bg-gray-400" // Dark gray for unknown
		}
	}

	// Handle say types
	if (singleMessage.type === "say") {
		switch (singleMessage.say) {
			case "text":
				return "bg-gray-300" // Light gray for assistant responses
			case "command_output":
				return "bg-purple-500" // Purple for terminal commands
			case "completion_result":
				return "bg-green-500" // Green for task success
			case "reasoning":
				return "bg-gray-300" // Light gray for AI reasoning
			case "api_req_started":
				return "bg-orange-400" // Orange for API requests
			case "mcp_server_response":
				return "bg-orange-400" // Orange for MCP server responses
			case "error":
				return "bg-red-500" // Red for errors
			default:
				return "bg-gray-400" // Dark gray for unknown
		}
	}

	return "bg-gray-400" // Fallback
}

const getMessageTypeDescription = (message: ClineMessage | ClineMessage[], t: any): string => {
	if (Array.isArray(message)) {
		return t("kilocode:taskTimeline.tooltip.messageTypes.unknown")
	}

	const singleMessage = message as ClineMessage
	let messageType: string

	if (singleMessage.type === "ask") {
		messageType = singleMessage.ask || "unknown"

		// For tool messages, try to get more specific type from JSON
		if (messageType === "tool" && singleMessage.text) {
			try {
				const toolData = JSON.parse(singleMessage.text)
				if (toolData.tool === "browser_action") {
					messageType = "browser_action"
				}
				// Keep as "tool" for other tool types
			} catch (_e) {
				// JSON parse error, keep as "tool"
			}
		}
	} else if (singleMessage.type === "say") {
		messageType = singleMessage.say || "unknown"
	} else {
		messageType = "unknown"
	}

	// Use direct message type as translation key
	const translationKey = `kilocode:taskTimeline.tooltip.messageTypes.${messageType}`

	// Try the translation, fallback to unknown if it doesn't exist
	try {
		return t(translationKey)
	} catch {
		return t("kilocode:taskTimeline.tooltip.messageTypes.unknown")
	}
}

const MessageSquare = memo(({ data, t }: { data: MessageSquareData; t: any }) => {
	const messageDescription = getMessageTypeDescription(data.message, t)
	const tooltip = t("kilocode:taskTimeline.tooltip.clickToScroll", {
		messageType: messageDescription,
		messageNumber: data.index + 1,
	})

	return (
		<div
			className={`
				w-3 h-3 rounded-xs cursor-pointer transition-all duration-200 flex-shrink-0
				${data.color}
				hover:opacity-80
				${data.isActive ? "animate-slow-pulse" : ""}
				${data.isNew ? "animate-fade-in" : ""}
			`}
			onClick={() => {
				// This will be handled by the parent component
			}}
			title={tooltip}
		/>
	)
})

MessageSquare.displayName = "MessageSquare"

export const TaskTimelineDisplayRow = memo<TaskTimelineDisplayRowProps>(
	({ groupedMessages, onMessageClick, currentMessageIndex, className = "", isTaskActive = false }) => {
		const { t } = useTranslation()
		const virtuosoRef = useRef<VirtuosoHandle>(null)
		const userInteractionRef = useRef(false)
		const previousLengthRef = useRef(0)
		const [newMessageIndices, setNewMessageIndices] = useState<Set<number>>(new Set())

		// Create data for message squares
		const messageSquareData = useMemo<MessageSquareData[]>(() => {
			const currentLength = groupedMessages.length
			const previousLength = previousLengthRef.current

			// Track new message indices
			if (currentLength > previousLength) {
				const newIndices = new Set<number>()
				for (let i = previousLength; i < currentLength; i++) {
					newIndices.add(i)
				}
				setNewMessageIndices(newIndices)

				// Clear the new message flags after animation duration
				setTimeout(() => {
					setNewMessageIndices(new Set())
				}, 300) // Match the animation duration
			}

			const data = groupedMessages.map((message, index) => ({
				index,
				color: getMessageTypeColor(message),
				isActive: currentMessageIndex === index && isTaskActive,
				message,
				isNew: newMessageIndices.has(index), // Mark new messages for fade-in animation
			}))

			// Update the previous length for next render
			previousLengthRef.current = currentLength

			return data
		}, [groupedMessages, currentMessageIndex, isTaskActive, newMessageIndices])

		// Auto-scroll to show the latest message when new messages are added
		useEffect(() => {
			if (virtuosoRef.current && messageSquareData.length > 0 && !userInteractionRef.current) {
				// Only auto-scroll to the latest message when new messages are added
				const targetIndex = messageSquareData.length - 1

				virtuosoRef.current.scrollToIndex({
					index: targetIndex,
					align: "end",
					behavior: "smooth",
				})
			}
			// Reset user interaction flag after a delay to allow auto-scroll to resume
			if (userInteractionRef.current) {
				const timer = setTimeout(() => {
					userInteractionRef.current = false
				}, 1000) // 1 second delay before resuming auto-scroll
				return () => clearTimeout(timer)
			}
		}, [messageSquareData.length])

		// Item content renderer for Virtuoso
		const itemContent = useCallback(
			(index: number) => {
				const data = messageSquareData[index]
				return (
					<div
						className="px-0.5"
						onClick={() => {
							userInteractionRef.current = true
							onMessageClick(data.index)
						}}>
						<MessageSquare data={data} t={t} />
					</div>
				)
			},
			[messageSquareData, onMessageClick, t],
		)

		if (messageSquareData.length === 0) {
			return null
		}

		return (
			<div className={`w-full ${className} mt-2`}>
				<Virtuoso
					ref={virtuosoRef}
					data={messageSquareData}
					itemContent={itemContent}
					horizontalDirection={true}
					initialTopMostItemIndex={messageSquareData.length - 1}
					className="scrollbar-hide"
					style={{
						height: "20px", // 5 * 4px (h-5)
						width: "100%",
						overflowY: "hidden",
					}}
				/>
			</div>
		)
	},
)

TaskTimelineDisplayRow.displayName = "TaskTimelineDisplayRow"
