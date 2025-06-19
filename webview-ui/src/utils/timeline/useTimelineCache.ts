import { useMemo, useRef } from "react"
import type { ClineMessage } from "@roo-code/types"
import { consolidateMessagesForTimeline } from "./consolidateMessagesForTimeline"
import { calculateTaskTimelineSizes, type MessageSizeData } from "./calculateTaskTimelineSizes"
import { getTaskTimelineMessageColor } from "./taskTimelineTypeRegistry"

export interface CachedTimelineMessageData {
	index: number
	color: string
	message: ClineMessage | ClineMessage[]
	sizeData: MessageSizeData
}

export interface TaskTimelineMessageData extends CachedTimelineMessageData {
	isActive: boolean
}

interface ProcessedTimelineCache {
	processedMessages: (ClineMessage | ClineMessage[])[]
	messageToOriginalIndex: Map<ClineMessage | ClineMessage[], number>
	messageSizeData: MessageSizeData[]
	sourceLength: number
}

export function useTaskTimelineCache(groupedMessages: (ClineMessage | ClineMessage[])[]): CachedTimelineMessageData[] {
	const cacheRef = useRef<ProcessedTimelineCache | null>(null)

	const processedData = useMemo(() => {
		const cache = cacheRef.current
		const currentLength = groupedMessages.length

		if (cache && currentLength === cache.sourceLength) {
			return cache
		}

		const { processedMessages, messageToOriginalIndex } = consolidateMessagesForTimeline(groupedMessages)
		const messageSizeData = calculateTaskTimelineSizes(processedMessages)

		const newCache: ProcessedTimelineCache = {
			processedMessages,
			messageToOriginalIndex,
			messageSizeData,
			sourceLength: currentLength,
		}

		cacheRef.current = newCache
		return newCache
	}, [groupedMessages])

	const timelineData = useMemo(() => {
		return processedData.processedMessages.map((message, filteredIndex) => {
			const originalIndex = processedData.messageToOriginalIndex.get(message) || 0
			return {
				index: originalIndex,
				color: getTaskTimelineMessageColor(message),
				message,
				sizeData: processedData.messageSizeData[filteredIndex],
			}
		})
	}, [processedData])

	return timelineData
}
