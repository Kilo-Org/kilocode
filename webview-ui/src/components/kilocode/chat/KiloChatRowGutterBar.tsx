import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { getTaskTimelineMessageColor } from "@/utils/messageColors"
import type { ClineMessage } from "@roo-code/types"

export function KiloChatRowGutterBar({ message }: { message: ClineMessage }) {
	const { hoveringTaskTimeline } = useExtensionState()

	return (
		<div
			className={cn(
				"absolute left-0 top-0 bottom-0 w-0.5 opacity-0 transition-opacity",
				getTaskTimelineMessageColor(message),
				hoveringTaskTimeline && "opacity-70",
			)}
		/>
	)
}
