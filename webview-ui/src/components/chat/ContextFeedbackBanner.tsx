// kilocode_change - new file: Visual feedback for file drag-drop operations
import React, { useEffect } from "react"
import { CheckCircle, Info, X } from "lucide-react"

import { useAppTranslation } from "@/i18n/TranslationContext"
import { cn } from "@/lib/utils"

export type FeedbackType = "success" | "info"

interface ContextFeedbackBannerProps {
	isVisible: boolean
	type: FeedbackType
	messageKey: string
	interpolations?: Record<string, string | number>
	onDismiss: () => void
	className?: string
}

export const ContextFeedbackBanner: React.FC<ContextFeedbackBannerProps> = ({
	isVisible,
	type,
	messageKey,
	interpolations,
	onDismiss,
	className,
}) => {
	const { t } = useAppTranslation()

	useEffect(() => {
		if (isVisible) {
			const timer = setTimeout(() => {
				onDismiss()
			}, 3000) // 3s auto-dismiss

			return () => clearTimeout(timer)
		}
	}, [isVisible, onDismiss])

	if (!isVisible) {
		return null
	}

	const Icon = type === "success" ? CheckCircle : Info

	const styles = {
		success: {
			border: "1px solid var(--vscode-testing-iconPassed)",
			color: "var(--vscode-testing-iconPassed)",
			background: "var(--vscode-input-background)",
		},
		info: {
			border: "1px solid var(--vscode-notificationsInfoIcon-foreground)",
			color: "var(--vscode-notificationsInfoIcon-foreground)",
			background: "var(--vscode-input-background)",
		},
	}

	return (
		<div
			className={cn(
				"flex items-center gap-2 px-3 py-2 mb-2",
				"rounded-md text-sm",
				"animate-in slide-in-from-top-2 duration-200",
				className,
			)}
			style={styles[type]}
			role="status"
			aria-live="polite">
			<Icon className="w-4 h-4 flex-shrink-0" />
			<span className="flex-1">{t(messageKey, interpolations)}</span>
			<button
				onClick={onDismiss}
				className={cn(
					"flex-shrink-0 p-0.5 rounded cursor-pointer",
					"hover:bg-black/10 focus:outline-none focus:ring-1",
					"focus:ring-[var(--vscode-focusBorder)]",
				)}
				aria-label="Dismiss">
				<X className="w-3 h-3" />
			</button>
		</div>
	)
}