import { memo, useRef, useEffect, useCallback, useMemo } from "react"
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso"
import type { ClineMessage } from "@roo-code/types"
import { TaskTimelineMessage } from "./TaskTimelineMessage"
import { MAX_HEIGHT_PX as TASK_TIMELINE_MAX_HEIGHT_PX } from "../../utils/timeline/calculateTaskTimelineSizes"
import { consolidateMessagesForTimeline } from "../../utils/timeline/consolidateMessagesForTimeline"
import { calculateTaskTimelineSizes } from "../../utils/timeline/calculateTaskTimelineSizes"
import { getTaskTimelineMessageColor } from "../../utils/messageColors"
import { TooltipProvider } from "../ui/tooltip"
import { useExtensionState } from "../../context/ExtensionStateContext"

// We hide the scrollbars for the TaskTimeline by wrapping it in a container with
// overflow hidden. This hides the scrollbars for the actual Virtuoso element
// by clipping them out view. This just needs to be greater than the webview scrollbar width.
const SCROLLBAR_WIDTH_PX = 25

interface TaskTimelineProps {
	groupedMessages: (ClineMessage | ClineMessage[])[]
	onMessageClick?: (index: number) => void
	isTaskActive?: boolean
}

export const TaskTimeline = memo<TaskTimelineProps>(({ groupedMessages, onMessageClick, isTaskActive = false }) => {
	const { setHoveringTaskTimeline } = useExtensionState()
	const virtuosoRef = useRef<VirtuosoHandle>(null)
	const previousGroupedLengthRef = useRef(groupedMessages.length)

	const handleMouseEnter = useCallback(() => {
		setHoveringTaskTimeline(true)
	}, [setHoveringTaskTimeline])

	const handleMouseLeave = useCallback(() => {
		setHoveringTaskTimeline(false)
	}, [setHoveringTaskTimeline])

	const timelineMessagesData = useMemo(() => {
		const { processedMessages, messageToOriginalIndex } = consolidateMessagesForTimeline(groupedMessages)
		const messageSizeData = calculateTaskTimelineSizes(processedMessages)

		return processedMessages.map((message, filteredIndex) => {
			const originalIndex = messageToOriginalIndex.get(message) || 0
			return {
				index: originalIndex,
				color: getTaskTimelineMessageColor(message),
				message,
				sizeData: messageSizeData[filteredIndex],
			}
		})
	}, [groupedMessages])

	const activeIndex = isTaskActive ? groupedMessages.length - 1 : -1

	const itemContent = useCallback(
		(index: number) => (
			<TaskTimelineMessage
				data={timelineMessagesData[index]}
				activeIndex={activeIndex}
				onClick={() => onMessageClick?.(timelineMessagesData[index].index)}
			/>
		),
		[timelineMessagesData, activeIndex, onMessageClick],
	)

	// Auto-scroll to show the latest message when
	// new messages are added or on initial mount
	useEffect(() => {
		const currentLength = groupedMessages.length
		const previousLength = previousGroupedLengthRef.current
		const hasNewMessages = currentLength > previousLength
		const isInitialMount = previousLength === 0 && currentLength > 0

		// Scroll to end if we have timeline data and either:
		// 1. New messages were added, or 2. This is the initial mount with data
		if (timelineMessagesData.length > 0 && (hasNewMessages || isInitialMount)) {
			const targetIndex = timelineMessagesData.length - 1
			const behavior = isInitialMount ? "auto" : "smooth"
			virtuosoRef.current?.scrollToIndex({ index: targetIndex, align: "end", behavior })
		}

		previousGroupedLengthRef.current = currentLength
	}, [groupedMessages.length, timelineMessagesData.length])

	return (
		<TooltipProvider>
			<div
				className="w-full px-2 overflow-hidden"
				style={{ height: `${TASK_TIMELINE_MAX_HEIGHT_PX}px` }}
				onMouseEnter={handleMouseEnter}
				onMouseLeave={handleMouseLeave}>
				<Virtuoso
					ref={virtuosoRef}
					data={timelineMessagesData}
					itemContent={itemContent}
					horizontalDirection={true}
					initialTopMostItemIndex={timelineMessagesData.length - 1}
					className="w-full"
					style={{ height: `${TASK_TIMELINE_MAX_HEIGHT_PX + SCROLLBAR_WIDTH_PX}px` }}
				/>
			</div>
		</TooltipProvider>
	)
})

TaskTimeline.displayName = "TaskTimeline"
