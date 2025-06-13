import { memo, useMemo, useRef, useEffect, useCallback, useState } from "react"
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso"
import type { ClineMessage } from "@roo-code/types"
import { useTranslation } from "react-i18next"
import { TaskTimelineMessageSquare, getMessageTypeColor, type MessageSquareData } from "./TaskTimelineMessageSquare"

interface TaskTimeline {
	groupedMessages: (ClineMessage | ClineMessage[])[]
	onMessageClick: (index: number) => void
	currentMessageIndex?: number
	className?: string
	isTaskActive?: boolean
}

export const TaskTimeline = memo<TaskTimeline>(
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
					<div className="px-0.5">
						<TaskTimelineMessageSquare
							data={data}
							t={t}
							onClick={() => {
								userInteractionRef.current = true
								onMessageClick(data.index)
							}}
						/>
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

TaskTimeline.displayName = "TaskTimelineDisplayRow"
