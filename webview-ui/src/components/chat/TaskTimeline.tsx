import { memo, useRef, useEffect, useCallback } from "react"
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso"
import type { ClineMessage } from "@roo-code/types"
import { TaskTimelineMessage } from "./TaskTimelineMessage"
import { VirtuosoHorizontalNoScrollbarScroller } from "../ui/VirtuosoHorizontalNoScrollbarScroller"
import { MAX_HEIGHT_PX } from "../../utils/timeline/calculateTaskTimelineSizes"
import { useTaskTimelineCache } from "../../utils/timeline/useTimelineCache"

interface TaskTimelineProps {
	groupedMessages: (ClineMessage | ClineMessage[])[]
	onMessageClick?: (index: number) => void
	isTaskActive?: boolean
}

export const TaskTimeline = memo<TaskTimelineProps>(({ groupedMessages, onMessageClick, isTaskActive = false }) => {
	const virtuosoRef = useRef<VirtuosoHandle>(null)
	const previousGroupedLengthRef = useRef(groupedMessages.length)

	const timelineMessagesData = useTaskTimelineCache(groupedMessages)
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
})

TaskTimeline.displayName = "TaskTimeline"
