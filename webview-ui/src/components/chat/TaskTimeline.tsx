import { memo, useRef, useEffect, useCallback } from "react"
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso"
import type { ClineMessage } from "@roo-code/types"
import { TaskTimelineMessage } from "./TaskTimelineMessage"
import { VirtuosoHorizontalNoScrollbarScroller } from "../ui/VirtuosoHorizontalNoScrollbarScroller"
import { MAX_HEIGHT_PX } from "../../utils/timeline/calculateTaskTimelineSizes"
import { useTimelineCache } from "../../utils/timeline/useTimelineCache"

interface TaskTimelineProps {
	groupedMessages: (ClineMessage | ClineMessage[])[]
	onMessageClick?: (index: number) => void
	isTaskActive?: boolean
}

export const TaskTimeline = memo<TaskTimelineProps>(({ groupedMessages, onMessageClick, isTaskActive = false }) => {
	const virtuosoRef = useRef<VirtuosoHandle>(null)
	const previousGroupedLengthRef = useRef(groupedMessages.length)

	const timelineMessagesData = useTimelineCache(groupedMessages)
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

	// Auto-scroll to show the latest message when new messages are added
	useEffect(() => {
		const currentLength = groupedMessages.length
		const previousLength = previousGroupedLengthRef.current

		// Only scroll if we actually have new messages and timeline data is ready
		if (currentLength > previousLength && timelineMessagesData.length > 0) {
			const targetIndex = timelineMessagesData.length - 1
			virtuosoRef.current?.scrollToIndex({ index: targetIndex, align: "end", behavior: "smooth" })
		}

		previousGroupedLengthRef.current = currentLength
	}, [groupedMessages.length, timelineMessagesData.length])

	// Initial scroll to end when component first mounts with data
	useEffect(() => {
		if (timelineMessagesData.length > 0 && previousGroupedLengthRef.current === groupedMessages.length) {
			const targetIndex = timelineMessagesData.length - 1
			virtuosoRef.current?.scrollToIndex({ index: targetIndex, align: "end", behavior: "auto" })
		}
	}, [groupedMessages.length, timelineMessagesData.length]) // Only run when timeline data is first available

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
