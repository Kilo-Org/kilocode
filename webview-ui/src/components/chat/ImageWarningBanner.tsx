// kilocode_change - new file
import React, { useEffect } from "react"
import { TriangleAlert, X } from "lucide-react"

import { useAppTranslation } from "@/i18n/TranslationContext"
import { cn } from "@/lib/utils"

interface ImageWarningBannerProps {
	isVisible: boolean
	messageKey: string
	onDismiss: () => void
	className?: string
}

export const ImageWarningBanner: React.FC<ImageWarningBannerProps> = ({
	isVisible,
	messageKey,
	onDismiss,
	className,
}) => {
	const { t } = useAppTranslation()

	useEffect(() => {
		if (isVisible) {
			const timer = setTimeout(() => {
				onDismiss()
			}, 4000) // 4s

			return () => clearTimeout(timer)
		}
	}, [isVisible, onDismiss])

	if (!isVisible) {
		return null
	}

	return (
		<div
			className={cn(
				"flex items-center gap-2 px-3 py-2 mb-2",
				"rounded-md text-sm",
				"animate-in slide-in-from-top-2 duration-200",
				className,
			)}
			style={{
				border: "1px solid var(--vscode-inputValidation-errorBorder)",
				color: "var(--vscode-notificationsErrorIcon-foreground)",
			}}
			role="alert"
			aria-live="polite">
			<TriangleAlert className="w-4 h-4 flex-shrink-0" />
			<span className="flex-1">{t(messageKey)}</span>
			<button
				onClick={onDismiss}
				className={cn(
					"flex-shrink-0 p-0.5 rounded cursor-pointer",
					"hover:bg-black/10 focus:outline-none focus:ring-1",
					"focus:ring-[var(--vscode-focusBorder)]",
				)}
				aria-label="Dismiss warning">
				<X className="w-3 h-3" />
			</button>
		</div>
	)
}
