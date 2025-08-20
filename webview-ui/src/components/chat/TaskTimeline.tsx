import type { ClineMessage } from "@roo-code/types"
import { forwardRef, memo, useCallback, useEffect, useMemo, useRef } from "react"
import { useDrag } from "@use-gesture/react"
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { getTaskTimelineMessageColor } from "../../utils/messageColors"
import {
	calculateTaskTimelineSizes,
	MAX_HEIGHT_PX as TASK_TIMELINE_MAX_HEIGHT_PX,
} from "../../utils/timeline/calculateTaskTimelineSizes"
import { consolidateMessagesForTimeline } from "../../utils/timeline/consolidateMessagesForTimeline"
import { TooltipProvider } from "../ui/tooltip"
import { TaskTimelineMessage } from "./TaskTimelineMessage"

// We hide the scrollbars for the TaskTimeline by wrapping it in a container with
// overflow hidden. This hides the scrollbars for the actual Virtuoso element
// by clipping them out view. This just needs to be greater than the webview scrollbar width.
const SCROLLBAR_WIDTH_PX = 25

interface TaskTimelineProps {
	groupedMessages: (ClineMessage | ClineMessage[])[]
	onMessageClick?: (index: number) => void
	isTaskActive?: boolean
}

// Translates vertical scrolling into horizontal scrolling and supports drag scrolling
const HorizontalScroller = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
	({ style, children, className, ...props }, ref) => {
		const bind = useDrag(
			({ active, delta: [dx] }) => {
				const element = (ref as React.MutableRefObject<HTMLDivElement>).current
				if (!element) return

				element.scrollLeft -= dx

				if (active) {
					element.style.cursor = "grabbing"
					element.style.userSelect = "none"
				} else {
					element.style.cursor = "grab"
					element.style.userSelect = "auto"
				}
			},
			{
				// Lock to horizontal axis only
				axis: "x",
				// Allow preventDefault to work properly
				eventOptions: { passive: false },
				// Prevent small drags from interfering with clicks
				filterTaps: true,
				// Use pointer events to capture mouse release outside element
				pointer: { capture: true },
				// Prevent conflicts with native browser scrolling on touch devices
				touchAction: "pan-x",
			},
		)

		return (
			<div
				{...props}
				{...bind()}
				ref={ref}
				className={`overflow-x-auto overflow-y-hidden touch-none cursor-grab ${className || ""}`}
				style={style}
				onWheel={(e) => {
					e.preventDefault()
					// Handle both vertical and horizontal wheel events
					;(ref as React.MutableRefObject<HTMLDivElement>).current!.scrollLeft += e.deltaY
				}}>
				{children}
			</div>
		)
	},
)

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
					components={{ Scroller: HorizontalScroller }}
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
