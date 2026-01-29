import React, { useCallback, useEffect, useState } from "react"
import type { OpenAiCodexRateLimitInfo } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { vscode } from "@src/utils/vscode"

interface OpenAICodexRateLimitDashboardProps {
	isAuthenticated: boolean
}

type Translate = (key: string, options?: Record<string, any>) => string

function formatDurationSeconds(totalSeconds: number, t: Translate): string {
	const days = Math.floor(totalSeconds / 86400)
	const hours = Math.floor((totalSeconds % 86400) / 3600)
	const minutes = Math.floor((totalSeconds % 3600) / 60)

	if (days > 0) {
		return t("settings:providers.openAiCodexRateLimits.duration.daysHours", { days, hours })
	}
	if (hours > 0) {
		return t("settings:providers.openAiCodexRateLimits.duration.hoursMinutes", { hours, minutes })
	}
	return t("settings:providers.openAiCodexRateLimits.duration.minutes", { minutes })
}

function formatTimeRemainingMs(ms: number | undefined, t: Translate): string {
	if (ms === undefined) return ""
	if (ms <= 0) return t("settings:providers.openAiCodexRateLimits.time.now")
	const totalSeconds = Math.max(0, Math.floor(ms / 1000))
	return formatDurationSeconds(totalSeconds, t)
}

function formatResetTimeMs(resetMs: number | undefined, t: Translate): string {
	if (!resetMs) return t("settings:providers.openAiCodexRateLimits.time.notAvailable")
	const diffMs = resetMs - Date.now()
	if (diffMs <= 0) return t("settings:providers.openAiCodexRateLimits.time.now")

	const diffSec = Math.floor(diffMs / 1000)
	return formatDurationSeconds(diffSec, t)
}

function formatWindowLabel(windowMinutes: number | undefined, t: Translate): string | undefined {
	if (!windowMinutes) return undefined
	if (windowMinutes === 60) return t("settings:providers.openAiCodexRateLimits.window.oneHour")
	if (windowMinutes === 24 * 60) return t("settings:providers.openAiCodexRateLimits.window.daily")
	if (windowMinutes === 7 * 24 * 60) return t("settings:providers.openAiCodexRateLimits.window.weekly")
	if (windowMinutes === 5 * 60) return t("settings:providers.openAiCodexRateLimits.window.fiveHour")
	if (windowMinutes % (24 * 60) === 0) {
		return t("settings:providers.openAiCodexRateLimits.window.days", { days: windowMinutes / (24 * 60) })
	}
	if (windowMinutes % 60 === 0) {
		return t("settings:providers.openAiCodexRateLimits.window.hours", { hours: windowMinutes / 60 })
	}
	return t("settings:providers.openAiCodexRateLimits.window.minutes", { minutes: windowMinutes })
}

function formatPlanLabel(planType: string | undefined, t: Translate): string {
	if (!planType) return t("settings:providers.openAiCodexRateLimits.plan.default")
	return t("settings:providers.openAiCodexRateLimits.plan.withType", { planType })
}

const UsageProgressBar: React.FC<{ usedPercent: number; label?: string }> = ({ usedPercent, label }) => {
	const percentage = Math.max(0, Math.min(100, usedPercent))
	const isWarning = percentage >= 70
	const isCritical = percentage >= 90

	return (
		<div className="w-full">
			{label ? <div className="text-xs text-vscode-descriptionForeground mb-1">{label}</div> : null}
			<div className="w-full bg-vscode-input-background rounded-sm h-2 overflow-hidden">
				<div
					className={`h-full transition-all duration-300 ${
						isCritical
							? "bg-vscode-errorForeground"
							: isWarning
								? "bg-vscode-editorWarning-foreground"
								: "bg-vscode-button-background"
					}`}
					style={{ width: `${percentage}%` }}
				/>
			</div>
		</div>
	)
}

export const OpenAICodexRateLimitDashboard: React.FC<OpenAICodexRateLimitDashboardProps> = ({ isAuthenticated }) => {
	const { t } = useAppTranslation()
	const [rateLimits, setRateLimits] = useState<OpenAiCodexRateLimitInfo | null>(null)
	const [isLoading, setIsLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const fetchRateLimits = useCallback(() => {
		if (!isAuthenticated) {
			setRateLimits(null)
			setError(null)
			return
		}
		setIsLoading(true)
		setError(null)
		vscode.postMessage({ type: "requestOpenAiCodexRateLimits" })
	}, [isAuthenticated])

	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "openAiCodexRateLimits") {
				setIsLoading(false)
				if (message.error) {
					setError(message.error)
					setRateLimits(null)
				} else if (message.values) {
					setRateLimits(message.values)
					setError(null)
				}
			}
		}
		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [])

	useEffect(() => {
		if (isAuthenticated) {
			fetchRateLimits()
		}
	}, [isAuthenticated, fetchRateLimits])

	if (!isAuthenticated) return null

	if (isLoading && !rateLimits) {
		return (
			<div className="bg-vscode-editor-background border border-vscode-panel-border rounded-md p-3">
				<div className="text-sm text-vscode-descriptionForeground">
					{t("settings:providers.openAiCodexRateLimits.loading")}
				</div>
			</div>
		)
	}

	if (error) {
		return (
			<div className="bg-vscode-editor-background border border-vscode-panel-border rounded-md p-3">
				<div className="flex items-center justify-between">
					<div className="text-sm text-vscode-errorForeground">
						{t("settings:providers.openAiCodexRateLimits.loadError")}
					</div>
					<button
						onClick={fetchRateLimits}
						className="text-xs text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground cursor-pointer bg-transparent border-none">
						{t("settings:providers.openAiCodexRateLimits.retry")}
					</button>
				</div>
				<div className="mt-2 text-xs text-vscode-descriptionForeground break-words">{error}</div>
			</div>
		)
	}

	if (!rateLimits) return null

	const primary = rateLimits.primary
	const secondary = rateLimits.secondary
	const planType = rateLimits.planType

	const planLabel = formatPlanLabel(planType, t)

	const primaryWindowLabel = primary ? formatWindowLabel(primary.windowMinutes, t) : undefined
	const primaryTimeRemaining = primary?.resetsAt ? formatTimeRemainingMs(primary.resetsAt - Date.now(), t) : ""
	const primaryUsed = primary ? Math.round(primary.usedPercent) : undefined

	const secondaryWindowLabel = secondary ? formatWindowLabel(secondary.windowMinutes, t) : undefined
	const secondaryTimeRemaining = secondary?.resetsAt ? formatTimeRemainingMs(secondary.resetsAt - Date.now(), t) : ""
	const secondaryUsed = secondary ? Math.round(secondary.usedPercent) : undefined

	const getUsageStatusLabel = (used: number | undefined, timeRemaining: string, resetAt?: number) => {
		const usedLabel =
			used !== undefined ? t("settings:providers.openAiCodexRateLimits.usedPercent", { percent: used }) : ""
		const resetLabel = timeRemaining
			? t("settings:providers.openAiCodexRateLimits.resetsIn", { time: timeRemaining })
			: resetAt
				? t("settings:providers.openAiCodexRateLimits.resetsIn", {
						time: formatResetTimeMs(resetAt, t),
					})
				: ""

		if (usedLabel && resetLabel) return `${usedLabel} • ${resetLabel}`
		return usedLabel || resetLabel
	}

	return (
		<div className="bg-vscode-editor-background border border-vscode-panel-border rounded-md p-3">
			<div className="mb-3">
				<div className="text-sm font-medium text-vscode-foreground">
					{t("settings:providers.openAiCodexRateLimits.title", { planLabel })}
				</div>
			</div>

			<div className="space-y-3">
				{primary ? (
					<div className="space-y-1">
						<div className="flex items-center justify-between text-xs">
							<span className="text-vscode-foreground">
								{primaryWindowLabel ?? t("settings:providers.openAiCodexRateLimits.window.usage")}
							</span>
							<span className="text-vscode-descriptionForeground">
								{getUsageStatusLabel(primaryUsed, primaryTimeRemaining, primary.resetsAt)}
							</span>
						</div>
						<UsageProgressBar usedPercent={primary.usedPercent} label={undefined} />
					</div>
				) : null}

				{secondary ? (
					<div className="space-y-1">
						<div className="flex items-center justify-between text-xs">
							<span className="text-vscode-foreground">
								{secondaryWindowLabel ?? t("settings:providers.openAiCodexRateLimits.window.usage")}
							</span>
							<span className="text-vscode-descriptionForeground">
								{getUsageStatusLabel(secondaryUsed, secondaryTimeRemaining, secondary.resetsAt)}
							</span>
						</div>
						<UsageProgressBar usedPercent={secondary.usedPercent} />
					</div>
				) : null}
			</div>
		</div>
	)
}
