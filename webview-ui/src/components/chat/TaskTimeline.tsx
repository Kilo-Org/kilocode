import { memo, useMemo, useRef, useEffect, useCallback } from "react"
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso"
import type { ClineMessage } from "@roo-code/types"
import { TaskTimelineMessage } from "./TaskTimelineMessage"
import { VirtuosoHorizontalNoScrollbarScroller } from "../ui/VirtuosoHorizontalNoScrollbarScroller"
import { processTimelineMessages } from "../../utils/timeline/timelineMessageProcessing"
import { getTaskTimelineMessageColor } from "../../utils/timeline/taskTimelineTypeRegistry"
import {
	calculateTaskTimelineSizes,
	MAX_HEIGHT_PX,
	type MessageSizeData,
} from "../../utils/timeline/calculateTaskTimelineSizes"

export interface TaskTimelineMessageData {
	index: number
	color: string
	isActive: boolean
	message: ClineMessage | ClineMessage[]
	sizeData: MessageSizeData
}

interface TaskTimelineProps {
	groupedMessages: (ClineMessage | ClineMessage[])[]
	onMessageClick?: (index: number) => void
	currentMessageIndex?: number
	isTaskActive?: boolean
}

export const TaskTimeline = memo<TaskTimelineProps>(
	({ groupedMessages, onMessageClick, currentMessageIndex, isTaskActive = false }) => {
		const previousLengthRef = useRef(0)
		const virtuosoRef = useRef<VirtuosoHandle>(null)

		// Create data for message squares using the centralized processing
		const timelineMessagesData = useMemo<TaskTimelineMessageData[]>(() => {
			const { processedMessages, messageToOriginalIndex } = processTimelineMessages(groupedMessages)
			const currentLength = processedMessages.length
			const messageSizeData = calculateTaskTimelineSizes(processedMessages)

			const timelineData = processedMessages.map((message, filteredIndex) => {
				const originalIndex = messageToOriginalIndex.get(message) || 0
				return {
					index: originalIndex, // Use original index for click handling
					color: getTaskTimelineMessageColor(message),
					isActive: currentMessageIndex === originalIndex && isTaskActive,
					message,
					sizeData: messageSizeData[filteredIndex], // Add dynamic size data
				}
			})

			// Update the previous length for next render
			previousLengthRef.current = currentLength

			return timelineData
		}, [groupedMessages, currentMessageIndex, isTaskActive])

		const itemContent = useCallback(
			(index: number) => (
				<TaskTimelineMessage
					data={timelineMessagesData[index]}
					onClick={() => onMessageClick?.(timelineMessagesData[index].index)}
				/>
			),
			[timelineMessagesData, onMessageClick],
		)

		// Auto-scroll to show the latest message when new messages are added
		useEffect(() => {
			if (virtuosoRef.current && timelineMessagesData.length > 0) {
				const targetIndex = timelineMessagesData.length - 1
				virtuosoRef.current.scrollToIndex({ index: targetIndex, align: "end", behavior: "smooth" })
			}
		}, [timelineMessagesData.length])

		return (
			<div className="w-full px-2">
				<Virtuoso
					ref={virtuosoRef}
					data={timelineMessagesData}
					itemContent={itemContent}
					horizontalDirection={true}
					initialTopMostItemIndex={timelineMessagesData.length - 1}
					className="w-full"
					style={{ height: `${MAX_HEIGHT_PX}px` }}
					components={{
						Scroller: VirtuosoHorizontalNoScrollbarScroller,
					}}
				/>
			</div>
		)
	},
)

TaskTimeline.displayName = "TaskTimeline"
