import type { ClineMessage } from "@roo-code/types"

// Hard-coded constants for dynamic sizing
export const MAX_HEIGHT_PX = 26
const AVERAGE_REQUEST_TIME_MS = 3000 // on average
const MIN_WIDTH_PX = 8
const MAX_WIDTH_PX = 32
const MIN_HEIGHT_PX = 8
const TOP_PADDING_PX = 4

export interface MessageSizeData {
	width: number
	height: number
	contentLength: number
	timingMs: number | null
}

interface NormalizationBounds {
	maxContentLength: number
	maxTiming: number
}

/**
 * Calculate dynamic sizes for all messages
 * Width is always based on timing, height is always based on content
 */
export function calculateTaskTimelineSizes(messages: (ClineMessage | ClineMessage[])[]): MessageSizeData[] {
	if (messages.length === 0) {
		return []
	}

	// Calculate raw data for all messages
	const rawData = messages.map((message, index) => {
		const contentLength = calculateMessageContentLength(message)
		const timingMs = calculateMessageTiming(message, messages[index + 1] || null)
		return { contentLength, timingMs }
	})

	const { maxContentLength, maxTiming } = findMinMaxBoundingValues(rawData)

	return rawData.map(({ contentLength, timingMs }, index) => {
		// Normalize content length (0-1 scale) - used for HEIGHT
		const contentRatio = Math.min(1, contentLength / Math.max(1, maxContentLength))

		// Normalize timing (0-1 scale, with fallback to average) - used for WIDTH
		// For the last message, use minimum width since it's still active
		const effectiveTiming = index === messages.length - 1 ? MIN_WIDTH_PX : (timingMs ?? AVERAGE_REQUEST_TIME_MS)
		const timingRatio = Math.min(1, effectiveTiming / Math.max(1, maxTiming))

		const width = MIN_WIDTH_PX + timingRatio * (MAX_WIDTH_PX - MIN_WIDTH_PX)
		const height = MIN_HEIGHT_PX + contentRatio * (MAX_HEIGHT_PX - MIN_HEIGHT_PX - TOP_PADDING_PX)

		return {
			width: Math.round(width),
			height: Math.round(height),
			contentLength,
			timingMs,
		}
	})
}

function calculateMessageContentLength(message: ClineMessage | ClineMessage[]): number {
	if (Array.isArray(message)) {
		return message.reduce((total, msg) => total + calculateMessageContentLength(msg), 0)
	}

	let length = 0
	length += message.text?.length ?? 0
	length += message.reasoning?.length ?? 0
	length += (message.images?.length ?? 0) * 100 // Each image counts as X characters
	length += message.contextCondense?.summary.length ?? 0

	return Math.max(1, length) // Ensure minimum of 1
}

function calculateMessageTiming(
	currentMessage: ClineMessage | ClineMessage[],
	nextMessage: ClineMessage | ClineMessage[] | null,
): number | null {
	if (!nextMessage) return null // Last message has no "next" message

	const currentTs = Array.isArray(currentMessage) ? currentMessage[0]?.ts : currentMessage.ts
	const nextTs = Array.isArray(nextMessage) ? nextMessage[0]?.ts : nextMessage.ts
	if (!currentTs || !nextTs) return null

	return Math.max(0, nextTs - currentTs) // Time until next message appeared
}

function findMinMaxBoundingValues(
	rawData: Array<{ contentLength: number; timingMs: number | null }>,
): NormalizationBounds {
	const maxContentLength = Math.max(...rawData.map((d) => d.contentLength))
	const validTimings = rawData.map((d) => d.timingMs).filter((t): t is number => t !== null)
	const maxTiming = validTimings.length > 0 ? Math.max(...validTimings) : AVERAGE_REQUEST_TIME_MS

	return { maxContentLength, maxTiming }
}
