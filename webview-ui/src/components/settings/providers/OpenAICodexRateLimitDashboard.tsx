import React, { useCallback, useEffect, useState } from "react"
import type { OpenAiCodexRateLimitInfo } from "@roo-code/types"

import { vscode } from "@src/utils/vscode"

interface OpenAICodexRateLimitDashboardProps {
	isAuthenticated: boolean
}

function formatTimeRemainingMs(ms: number | undefined): string {
	if (!ms) return ""
	const totalSeconds = Math.max(0, Math.floor(ms / 1000))
	const days = Math.floor(totalSeconds / 86400)
	const hours = Math.floor((totalSeconds % 86400) / 3600)
	const minutes = Math.floor((totalSeconds % 3600) / 60)

	if (days > 0) return `${days}d ${hours}h`
	if (hours > 0) return `${hours}h ${minutes}m`
	return `${minutes}m`
}

function formatResetTimeMs(resetMs: number | undefined): string {
	if (!resetMs) return "N/A"
	const diffMs = resetMs - Date.now()
	if (diffMs <= 0) return "Now"

	const diffSec = Math.floor(diffMs / 1000)
	const hours = Math.floor(diffSec / 3600)
	const minutes = Math.floor((diffSec % 3600) / 60)
	if (hours > 24) {
		const days = Math.floor(hours / 24)
		const remainingHours = hours % 24
		return `${days}d ${remainingHours}h`
	}
	if (hours > 0) return `${hours}h ${minutes}m`
	return `${minutes}m`
}

function formatWindowLabel(windowMinutes: number | undefined): string | undefined {
	if (!windowMinutes) return undefined
	if (windowMinutes === 60) return "1h limit"
	if (windowMinutes === 24 * 60) return "Daily limit"
	if (windowMinutes === 7 * 24 * 60) return "Weekly limit"
	if (windowMinutes === 5 * 60) return "5h limit"
	if (windowMinutes % (24 * 60) === 0) return `${windowMinutes / (24 * 60)}d`
	if (windowMinutes % 60 === 0) return `${windowMinutes / 60}h`
	return `${windowMinutes}m`
}

function formatPlanLabel(planType: string | undefined): string {
	if (!planType) return "Codex"
	return `Codex (${planType})`
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
				<div className="text-sm text-vscode-descriptionForeground">Loading usage limits...</div>
			</div>
		)
	}

	if (error) {
		return (
			<div className="bg-vscode-editor-background border border-vscode-panel-border rounded-md p-3">
				<div className="flex items-center justify-between">
					<div className="text-sm text-vscode-errorForeground">Failed to load usage limits</div>
					<button
						onClick={fetchRateLimits}
						className="text-xs text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground cursor-pointer bg-transparent border-none">
						Retry
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

	const planLabel = formatPlanLabel(planType)

	const primaryWindowLabel = primary ? formatWindowLabel(primary.windowMinutes) : undefined
	const primaryTimeRemaining = primary?.resetsAt ? formatTimeRemainingMs(primary.resetsAt - Date.now()) : ""
	const primaryUsed = primary ? Math.round(primary.usedPercent) : undefined

	const secondaryWindowLabel = secondary ? formatWindowLabel(secondary.windowMinutes) : undefined
	const secondaryTimeRemaining = secondary?.resetsAt ? formatTimeRemainingMs(secondary.resetsAt - Date.now()) : ""
	const secondaryUsed = secondary ? Math.round(secondary.usedPercent) : undefined

	return (
		<div className="bg-vscode-editor-background border border-vscode-panel-border rounded-md p-3">
			<div className="mb-3">
				<div className="text-sm font-medium text-vscode-foreground">Usage Limits for {planLabel}</div>
			</div>

			<div className="space-y-3">
				{primary ? (
					<div className="space-y-1">
						<div className="flex items-center justify-between text-xs">
							<span className="text-vscode-foreground">{primaryWindowLabel ?? "Usage"}</span>
							<span className="text-vscode-descriptionForeground">
								{primaryUsed !== undefined ? `${primaryUsed}% used` : ""}
								{primaryTimeRemaining
									? ` • resets in ${primaryTimeRemaining}`
									: primary.resetsAt
										? ` • resets in ${formatResetTimeMs(primary.resetsAt)}`
										: ""}
							</span>
						</div>
						<UsageProgressBar usedPercent={primary.usedPercent} label={undefined} />
					</div>
				) : null}

				{secondary ? (
					<div className="space-y-1">
						<div className="flex items-center justify-between text-xs">
							<span className="text-vscode-foreground">{secondaryWindowLabel ?? "Usage"}</span>
							<span className="text-vscode-descriptionForeground">
								{secondaryUsed !== undefined ? `${secondaryUsed}% used` : ""}
								{secondaryTimeRemaining
									? ` • resets in ${secondaryTimeRemaining}`
									: secondary.resetsAt
										? ` • resets in ${formatResetTimeMs(secondary.resetsAt)}`
										: ""}
							</span>
						</div>
						<UsageProgressBar usedPercent={secondary.usedPercent} />
					</div>
				) : null}
			</div>
		</div>
	)
}
