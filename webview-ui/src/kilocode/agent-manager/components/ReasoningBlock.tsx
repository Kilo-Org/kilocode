import React, { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Lightbulb, ChevronUp } from "lucide-react"
import { cn } from "../../../lib/utils"
import { SimpleMarkdown } from "./SimpleMarkdown"

interface ReasoningBlockProps {
	content: string
	ts: number
	isStreaming: boolean
	isLast: boolean
}

export const ReasoningBlock: React.FC<ReasoningBlockProps> = ({ content, ts: _ts, isStreaming, isLast }) => {
	const { t } = useTranslation("agentManager")
	const [isCollapsed, setIsCollapsed] = useState(true) // Default collapsed
	const startTimeRef = useRef<number>(Date.now())
	const [elapsed, setElapsed] = useState<number>(0)

	useEffect(() => {
		if (isLast && isStreaming) {
			const tick = () => setElapsed(Date.now() - startTimeRef.current)
			tick()
			const id = setInterval(tick, 1000)
			return () => clearInterval(id)
		}
	}, [isLast, isStreaming])

	const seconds = Math.floor(elapsed / 1000)
	const secondsLabel = t("messages.thinkingSeconds", { count: seconds })

	const handleToggle = () => {
		setIsCollapsed(!isCollapsed)
	}

	return (
		<div className="am-reasoning-block group">
			<div className="am-reasoning-header" onClick={handleToggle}>
				<div className="am-reasoning-title">
					<Lightbulb size={16} />
					<span className="font-bold">{t("messages.thinking")}</span>
					{elapsed > 0 && <span className="am-reasoning-elapsed">{secondsLabel}</span>}
				</div>
				<ChevronUp size={16} className={cn("am-reasoning-chevron", isCollapsed && "am-collapsed")} />
			</div>
			{(content?.trim()?.length ?? 0) > 0 && !isCollapsed && (
				<div className="am-reasoning-content">
					<SimpleMarkdown content={content} />
				</div>
			)}
		</div>
	)
}
