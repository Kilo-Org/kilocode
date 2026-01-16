import { memo, useState, useEffect, useRef } from "react"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { telemetryClient } from "@src/utils/TelemetryClient"
import { TelemetryEventName } from "@roo-code/types"

interface UsageQuotaBannerProps {
	/** Current number of requests used */
	requestsUsed: number
	/** Maximum number of requests allowed */
	requestsLimit: number
	/** Optional callback when upgrade is clicked */
	onUpgrade?: () => void
}

const THRESHOLDS = [50, 60, 70, 80, 90, 100]

const UsageQuotaBanner = memo(({ requestsUsed, requestsLimit }: UsageQuotaBannerProps) => {
	const { t } = useAppTranslation()
	const [isVisible, setIsVisible] = useState(false)
	const [dismissedThresholds, setDismissedThresholds] = useState<Set<number>>(new Set())
	const prevPercentageRef = useRef(0)

	useEffect(() => {
		// Calculate current percentage
		const currentPercentage = Math.floor((requestsUsed / requestsLimit) * 100)

		// Find the threshold that was just reached
		const reachedThreshold = THRESHOLDS.find(
			(t) => currentPercentage >= t && prevPercentageRef.current < t && !dismissedThresholds.has(t),
		)

		if (reachedThreshold) {
			setIsVisible(true)
		}

		prevPercentageRef.current = currentPercentage
	}, [requestsUsed, requestsLimit, dismissedThresholds])

	const currentPercentage = Math.floor((requestsUsed / requestsLimit) * 100)
	const isAtLimit = currentPercentage >= 100

	const handleDismiss = () => {
		const threshold = THRESHOLDS.find((t) => currentPercentage >= t)
		if (threshold) {
			setDismissedThresholds((prev) => new Set([...prev, threshold]))
		}
		setIsVisible(false)

		telemetryClient.capture(TelemetryEventName.UPSELL_DISMISSED, {
			upsellId: `usage-quota-${currentPercentage}`,
		})
	}

	const handleUpgrade = () => {
		telemetryClient.capture(TelemetryEventName.UPSELL_CLICKED, {
			upsellId: `usage-quota-${currentPercentage}`,
		})

		vscode.postMessage({
			type: "openExternal",
			url: "https://upgrade.example.com",
		})
	}

	if (!isVisible) {
		return null
	}

	return (
		<div
			className={`relative p-4 pr-12 border rounded text-sm leading-normal flex items-center justify-between gap-4 ${
				isAtLimit
					? "bg-vscode-errorBackground text-vscode-errorForeground border-vscode-errorForeground"
					: "bg-vscode-warningBackground text-vscode-warningForeground border-vscode-warningForeground"
			}`}>
			{/* Close button (X) */}
			<button
				onClick={handleDismiss}
				className="absolute top-1.5 right-2 bg-transparent border-none cursor-pointer text-2xl p-1 opacity-70 hover:opacity-100 transition-opacity duration-200 leading-none"
				aria-label={t("common:dismiss")}>
				×
			</button>

			{/* Content */}
			<div>
				<div className="font-semibold">{requestsUsed.toLocaleString()} / {requestsLimit.toLocaleString()} requests used</div>
				<div className="text-xs opacity-90 mt-1">{currentPercentage}% of quota</div>
			</div>

			{/* Upgrade button */}
			<div className={isAtLimit ? "flex-shrink-0" : ""}>
				<VSCodeButton onClick={handleUpgrade} appearance={isAtLimit ? "primary" : "secondary"} className="whitespace-nowrap">
					{t("common:upgrade") || "Upgrade"}
				</VSCodeButton>
			</div>
		</div>
	)
})

UsageQuotaBanner.displayName = "UsageQuotaBanner"

export default UsageQuotaBanner

