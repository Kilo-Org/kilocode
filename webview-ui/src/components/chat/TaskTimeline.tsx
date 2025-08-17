import type { ClineMessage } from "@roo-code/types"
import { forwardRef, memo, useCallback, useEffect, useMemo, useRef } from "react"
// import { useDrag } from "@use-gesture/react" // Temporarily removed due to dependency issues
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
		const isDragging = useRef(false)
		const lastX = useRef(0)

		const handleMouseDown = useCallback(
			(e: React.MouseEvent) => {
				isDragging.current = true
				lastX.current = e.clientX
				const element = (ref as React.MutableRefObject<HTMLDivElement>).current
				if (element) {
					element.style.cursor = "grabbing"
					element.style.userSelect = "none"
				}
				e.preventDefault()
			},
			[ref],
		)

		const handleMouseMove = useCallback(
			(e: React.MouseEvent) => {
				if (!isDragging.current) return
				const element = (ref as React.MutableRefObject<HTMLDivElement>).current
				if (!element) return

				const dx = e.clientX - lastX.current
				element.scrollLeft -= dx
				lastX.current = e.clientX
				e.preventDefault()
			},
			[ref],
		)

		const handleMouseUp = useCallback(() => {
			isDragging.current = false
			const element = (ref as React.MutableRefObject<HTMLDivElement>).current
			if (element) {
				element.style.cursor = "grab"
				element.style.userSelect = "auto"
			}
		}, [ref])

		useEffect(() => {
			const handleGlobalMouseUp = () => {
				if (isDragging.current) {
					handleMouseUp()
				}
			}

			const handleGlobalMouseMove = (e: MouseEvent) => {
				if (!isDragging.current) return
				const element = (ref as React.MutableRefObject<HTMLDivElement>).current
				if (!element) return

				const dx = e.clientX - lastX.current
				element.scrollLeft -= dx
				lastX.current = e.clientX
				e.preventDefault()
			}

			document.addEventListener("mouseup", handleGlobalMouseUp)
			document.addEventListener("mousemove", handleGlobalMouseMove)

			return () => {
				document.removeEventListener("mouseup", handleGlobalMouseUp)
				document.removeEventListener("mousemove", handleGlobalMouseMove)
			}
		}, [handleMouseUp, ref])

		return (
			<div
				{...props}
				ref={ref}
				className={`overflow-x-auto overflow-y-hidden touch-none cursor-grab ${className || ""}`}
				style={style}
				onMouseDown={handleMouseDown}
				onMouseMove={handleMouseMove}
				onMouseUp={handleMouseUp}
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
