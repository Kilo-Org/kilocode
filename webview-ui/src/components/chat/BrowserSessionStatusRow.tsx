import { memo } from "react"
import { Globe } from "lucide-react"
import { ClineMessage } from "@roo-code/types"

interface BrowserSessionStatusRowProps {
	message: ClineMessage
}

const BrowserSessionStatusRow = memo(({ message }: BrowserSessionStatusRowProps) => {
	const isOpened = message.text?.includes("opened")

	return (
		<div className="flex items-center gap-2 py-2 px-[15px] text-sm">
			<Globe
				className="w-4 h-4 shrink-0"
				style={{
					opacity: 0.7,
					color: isOpened ? "#4ade80" : "#9ca3af", // green when opened, gray when closed
				}}
			/>
			<span
				style={{
					color: isOpened ? "var(--vscode-testing-iconPassed)" : "var(--vscode-descriptionForeground)",
					fontWeight: 500,
				}}>
				{message.text}
			</span>
		</div>
	)
})

BrowserSessionStatusRow.displayName = "BrowserSessionStatusRow"

export default BrowserSessionStatusRow
