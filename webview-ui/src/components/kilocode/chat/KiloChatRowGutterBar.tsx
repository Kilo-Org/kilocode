import { cn } from "@/lib/utils"
import { shouldShowInTimeline, getTaskTimelineMessageColor } from "@/utils/messageColors"
import type { ClineMessage } from "@roo-code/types"

export function KiloChatRowGutterBar({ message }: { message: ClineMessage }) {
	return shouldShowInTimeline(message) ? (
		<div className={cn("absolute left-0 top-0 bottom-0 w-0.5 opacity-50", getTaskTimelineMessageColor(message))} />
	) : null
}
