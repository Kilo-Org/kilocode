import { memo, useMemo, useRef, useEffect, useCallback } from "react"
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso"
import type { ClineMessage } from "@roo-code/types"

interface TaskProgressDisplayRowProps {
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
}

const getMessageTypeColor = (message: ClineMessage | ClineMessage[]): string => {
	if (Array.isArray(message)) {
		return "bg-cyan-500"
	}

	const singleMessage = message as ClineMessage
	if (singleMessage.type === "ask") {
		switch (singleMessage.ask) {
			case "followup":
				return "bg-blue-500" // User input
			case "command":
				return "bg-green-500" // Command execution
			case "tool":
				return "bg-blue-500" // Tool usage
			case "browser_action_launch":
				return "bg-cyan-500" // Browser actions
			case "use_mcp_server":
				return "bg-yellow-500" // MCP server
			case "api_req_failed":
				return "bg-red-500" // Errors
			case "completion_result":
				return "bg-green-500" // Task completed successfully
			default:
				return "bg-gray-500" // Default
		}
	}

	// Handle say types
	if (singleMessage.type === "say") {
		switch (singleMessage.say) {
			case "reasoning":
				return "bg-purple-500" // AI reasoning
			case "api_req_started":
				return "bg-orange-500" // Tool usage
			case "command_output":
				return "bg-green-500" // Command execution
			case "browser_action":
				return "bg-cyan-500" // Browser actions
			case "mcp_server_response":
				return "bg-yellow-500" // MCP server
			case "error":
				return "bg-red-500" // Errors
			case "text":
			default:
				return "bg-gray-500" // Text output / default
		}
	}

	return "bg-gray-500" // Fallback
}

const getMessageTypeDescription = (message: ClineMessage | ClineMessage[]): string => {
	if (Array.isArray(message)) {
		return "Multiple messages"
	}

	const singleMessage = message as ClineMessage
	if (singleMessage.type === "ask") {
		switch (singleMessage.ask) {
			case "followup":
				return "User input"
			case "command":
				return "Command execution"
			case "tool":
				return "Tool usage"
			case "browser_action_launch":
				return "Browser action"
			case "use_mcp_server":
				return "MCP server interaction"
			case "api_req_failed":
				return "API request failed"
			case "completion_result":
				return "Task completed"
			default:
				return "User interaction"
		}
	}

	// Handle say types
	if (singleMessage.type === "say") {
		switch (singleMessage.say) {
			case "reasoning":
				return "AI reasoning"
			case "api_req_started":
				return "API request"
			case "command_output":
				return "Command output"
			case "browser_action":
				return "Browser action"
			case "mcp_server_response":
				return "MCP server response"
			case "error":
				return "Error message"
			case "text":
			default:
				return "AI response"
		}
	}

	return "Message"
}

const MessageSquare = memo(({ data }: { data: MessageSquareData }) => {
	const messageDescription = getMessageTypeDescription(data.message)
	const tooltip = `Click to scroll to ${messageDescription.toLowerCase()} (message ${data.index + 1})`

	return (
		<div
			className={`
				w-3 h-3 rounded-xs cursor-pointer transition-all duration-200 flex-shrink-0
				${data.color}
				hover:opacity-80
				${data.isActive ? "animate-slow-pulse" : ""}
			`}
			onClick={() => {
				// This will be handled by the parent component
			}}
			title={tooltip}
		/>
	)
})

MessageSquare.displayName = "MessageSquare"

export const TaskProgressDisplayRow = memo<TaskProgressDisplayRowProps>(
	({ groupedMessages, onMessageClick, currentMessageIndex, className = "", isTaskActive = false }) => {
		const virtuosoRef = useRef<VirtuosoHandle>(null)
		const userInteractionRef = useRef(false)

		// Create data for message squares
		const messageSquareData = useMemo<MessageSquareData[]>(() => {
			return groupedMessages.map((message, index) => ({
				index,
				color: getMessageTypeColor(message),
				isActive: currentMessageIndex === index && isTaskActive,
				message,
			}))
		}, [groupedMessages, currentMessageIndex, isTaskActive])

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
						<MessageSquare data={data} />
					</div>
				)
			},
			[messageSquareData, onMessageClick],
		)

		if (messageSquareData.length === 0) {
			return null
		}

		return (
			<div className={`w-full ${className}`}>
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

TaskProgressDisplayRow.displayName = "TaskProgressDisplayRow"
