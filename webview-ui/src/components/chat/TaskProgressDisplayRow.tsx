import { memo, useMemo, useRef, useEffect } from "react"
import type { ClineMessage } from "@roo-code/types"

interface TaskProgressDisplayRowProps {
	groupedMessages: (ClineMessage | ClineMessage[])[]
	onMessageClick: (index: number) => void
	currentMessageIndex?: number
	className?: string
}

interface MessageSquareData {
	index: number
	color: string
	isActive: boolean
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

const MessageSquare = memo(({ data }: { data: MessageSquareData }) => {
	return (
		<div
			className={`
				w-3 h-3 rounded-sm cursor-pointer transition-all duration-200 hover:scale-110 flex-shrink-0
				${data.color}
				${data.isActive ? "animate-slow-pulse" : ""}
			`}
			onClick={() => {
				// This will be handled by the parent component
			}}
			title={`Message ${data.index + 1}`}
		/>
	)
})

MessageSquare.displayName = "MessageSquare"

export const TaskProgressDisplayRow = memo<TaskProgressDisplayRowProps>(
	({ groupedMessages, onMessageClick, currentMessageIndex, className = "" }) => {
		const virtuosoRef = useRef<any>(null)

		// Create data for virtualization
		const messageSquareData = useMemo<MessageSquareData[]>(() => {
			return groupedMessages.map((message, index) => ({
				index,
				color: getMessageTypeColor(message),
				isActive: currentMessageIndex === index,
			}))
		}, [groupedMessages, currentMessageIndex])

		// Auto-scroll to latest message
		useEffect(() => {
			if (virtuosoRef.current && messageSquareData.length > 0) {
				// Scroll to the end to show the latest message
				virtuosoRef.current.scrollToIndex({
					index: messageSquareData.length - 1,
					align: "end",
					behavior: "smooth",
				})
			}
		}, [messageSquareData.length])

		// Auto-scroll to current active message
		useEffect(() => {
			if (virtuosoRef.current && currentMessageIndex !== undefined && currentMessageIndex >= 0) {
				virtuosoRef.current.scrollToIndex({
					index: currentMessageIndex,
					align: "center",
					behavior: "smooth",
				})
			}
		}, [currentMessageIndex])

		if (messageSquareData.length === 0) {
			return null
		}

		return (
			<div
				className={`
					w-full h-5 overflow-x-scroll overflow-y-hidden ${className}
					scrollbar-hide
				`}
				style={{
					scrollbarWidth: "none" /* Firefox */,
					msOverflowStyle: "none" /* IE10+ */,
				}}>
				<div className="flex items-center gap-0.5 h-full min-w-fit">
					{messageSquareData.map((data) => (
						<div
							key={`message-square-${data.index}`}
							className="px-0.5"
							onClick={() => onMessageClick(data.index)}>
							<MessageSquare data={data} />
						</div>
					))}
				</div>
			</div>
		)
	},
)

TaskProgressDisplayRow.displayName = "TaskProgressDisplayRow"
