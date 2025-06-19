import { memo, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { getMessageTypeDescription } from "@/utils/timeline/taskTimelineTypeRegistry"
import { MAX_HEIGHT_PX } from "@/utils/timeline/calculateTaskTimelineSizes"
import type { CachedTimelineMessageData } from "../../utils/timeline/useTimelineCache"

interface TaskTimelineMessageProps {
	data: CachedTimelineMessageData
	activeIndex: number
	onClick?: () => void
}

export const TaskTimelineMessage = memo(({ data, activeIndex, onClick }: TaskTimelineMessageProps) => {
	const { t } = useTranslation()
	const messageDescription = getMessageTypeDescription(data.message, t)
	const tooltip = t("kilocode:taskTimeline.tooltip.clickToScroll", {
		messageType: messageDescription,
		messageNumber: data.index + 1,
	})

	const isActive = activeIndex === data.index

	const [isNew, setIsNew] = useState(true)
	useEffect(() => {
		const newTimer = setTimeout(() => setIsNew(false), 1000)
		return () => clearTimeout(newTimer)
	}, [])

	return (
		<div
			className="mr-0.5 relative h-full"
			style={{ width: `${data.sizeData.width}px`, height: `${MAX_HEIGHT_PX}px` }}>
			<div
				className={cn(
					"absolute bottom-0 left-0 right-0 cursor-pointer rounded-t-xs",
					"transition-all duration-200 hover:opacity-70",
					isNew && "animate-fade-in",
					isActive && "animate-slow-pulse-delayed",
					data.color,
				)}
				style={{ height: `${((data.sizeData.height - 2) / MAX_HEIGHT_PX) * 100}%` }}
				onClick={onClick}
				title={tooltip}
			/>
		</div>
	)
})

TaskTimelineMessage.displayName = "TaskTimelineMessageProps"
