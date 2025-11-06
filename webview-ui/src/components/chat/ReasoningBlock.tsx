import { useExtensionState } from "@src/context/ExtensionStateContext"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { cn } from "@/lib/utils"
import { ChevronUp } from "lucide-react"
import MarkdownBlock from "../common/MarkdownBlock"

interface ReasoningBlockProps {
	content: string
	ts: number
	isStreaming: boolean
	isLast: boolean
	metadata?: any
}

export const ReasoningBlock = ({ content, isStreaming, isLast }: ReasoningBlockProps) => {
	const { t } = useTranslation()
	const { reasoningBlockCollapsed } = useExtensionState()

	const [isCollapsed, setIsCollapsed] = useState(reasoningBlockCollapsed)

	const startTimeRef = useRef<number>(Date.now())
	const [elapsed, setElapsed] = useState<number>(0)
	const contentRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		setIsCollapsed(reasoningBlockCollapsed)
	}, [reasoningBlockCollapsed])

	useEffect(() => {
		if (isLast && isStreaming) {
			const tick = () => setElapsed(Date.now() - startTimeRef.current)
			tick()
			const id = setInterval(tick, 1000)
			return () => clearInterval(id)
		}
	}, [isLast, isStreaming])

	const seconds = Math.floor(elapsed / 1000)
	const secondsLabel = t("chat:reasoning.seconds", { count: seconds })

	const handleToggle = () => {
		setIsCollapsed(!isCollapsed)
	}

	return (
		<div className="group">
			<div
				className="flex items-center justify-start gap-1 pr-2 cursor-pointer select-none opacity-40 hover:opacity-100"
				onClick={handleToggle}>
				<div className="flex items-center gap-2">
					{/* <Lightbulb className="w-4" /> */}
					<span className="font-bold text-vscode-foreground">{t("chat:reasoning.thinking")}</span>
					{elapsed > 0 && (
						<span className="text-sm text-vscode-descriptionForeground mt-0.5">{secondsLabel}</span>
					)}
				</div>
				<div className="flex items-center gap-2">
					<ChevronUp
						className={cn("w-4 transition-all group-hover:opacity-100", isCollapsed && "-rotate-180")}
					/>
				</div>
			</div>
			{(content?.trim()?.length ?? 0) > 0 && !isCollapsed && (
				<div ref={contentRef} className="text-vscode-descriptionForeground">
					<MarkdownBlock markdown={content} />
				</div>
			)}
		</div>
	)
}
