import React from "react"
import { cn } from "@/lib/utils"
import { useAppTranslation } from "@/i18n/TranslationContext"

interface ModeIndicatorProps {
	mode?: string
	className?: string
	onClick?: () => void
	clickable?: boolean
}

const MODE_COLORS = {
	code: "bg-blue-500/20 text-blue-300 border-blue-500/30",
	architect: "bg-purple-500/20 text-purple-300 border-purple-500/30",
	ask: "bg-green-500/20 text-green-300 border-green-500/30",
	debug: "bg-red-500/20 text-red-300 border-red-500/30",
	orchestrator: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
	translate: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
	test: "bg-orange-500/20 text-orange-300 border-orange-500/30",
	default:
		"bg-vscode-descriptionForeground/20 text-vscode-descriptionForeground border-vscode-descriptionForeground/30",
} as const

export const ModeIndicator: React.FC<ModeIndicatorProps> = ({ mode, className, onClick, clickable = false }) => {
	const { t } = useAppTranslation()

	if (!mode) {
		return null
	}

	const colorClass = MODE_COLORS[mode as keyof typeof MODE_COLORS] || MODE_COLORS.default
	const modeLabel = t(`history:modes.${mode}`, { defaultValue: mode })

	return (
		<span
			className={cn(
				"inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border",
				colorClass,
				clickable && "cursor-pointer hover:opacity-80 transition-opacity",
				className,
			)}
			onClick={clickable ? onClick : undefined}
			title={clickable ? t("history:filterByMode", { mode: modeLabel }) : undefined}>
			{modeLabel}
		</span>
	)
}
