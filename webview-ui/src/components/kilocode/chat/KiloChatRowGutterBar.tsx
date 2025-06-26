import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { getTaskTimelineMessageColor } from "@/utils/messageColors"
import type { ClineMessage } from "@roo-code/types"

export function KiloChatRowGutterBar({ message }: { message: ClineMessage }) {
	const { hoveringTaskTimeline } = useExtensionState()

	return (
		<div
			className={cn(
				"absolute w-[4px] left-[4px] top-0 bottom-0  opacity-0 transition-opacity",
				getTaskTimelineMessageColor(message),
				hoveringTaskTimeline && "opacity-70",
			)}
		/>
	)
}
