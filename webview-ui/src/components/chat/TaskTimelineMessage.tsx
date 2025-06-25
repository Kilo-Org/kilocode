import { memo, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import type { ClineMessage } from "@roo-code/types"
import { cn } from "@/lib/utils"
import { getMessageTypeDescription } from "@/utils/messageColors"
import { MAX_HEIGHT_PX, type MessageSizeData } from "@/utils/timeline/calculateTaskTimelineSizes"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

interface TimelineMessageData {
	index: number
	color: string
	message: ClineMessage | ClineMessage[]
	sizeData: MessageSizeData
}

interface TaskTimelineMessageProps {
	data: TimelineMessageData
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
			className="mr-0.5 relative overflow-hidden"
			style={{ width: `${data.sizeData.width}px`, height: `${MAX_HEIGHT_PX}px` }}>
			<Tooltip>
				<TooltipTrigger asChild>
					<div
						className={cn(
							"absolute bottom-0 left-0 right-0 cursor-pointer rounded-t-xs",
							"transition-all duration-200 hover:opacity-70",
							isNew && "animate-fade-in",
							isActive && "animate-slow-pulse-delayed",
							data.color,
						)}
						style={{ height: `${(data.sizeData.height / MAX_HEIGHT_PX) * 100}%` }}
						onClick={onClick}
					/>
				</TooltipTrigger>
				<TooltipContent>{tooltip}</TooltipContent>
			</Tooltip>
		</div>
	)
})

TaskTimelineMessage.displayName = "TaskTimelineMessageProps"
