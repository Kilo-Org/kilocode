import React, { useEffect, useState, useCallback } from "react"
import type { ClaudeCodeRateLimitInfo } from "@roo-code/types"
import { vscode } from "@src/utils/vscode"

interface ClaudeCodeRateLimitDashboardProps {
	isAuthenticated: boolean
}

/**
 * Formats a Unix timestamp reset time into a human-readable duration
 */
function formatResetTime(resetTimestamp: number): string {
	if (!resetTimestamp) return "N/A"

	const now = Date.now() / 1000 // Current time in seconds
	const diff = resetTimestamp - now

	if (diff <= 0) return "Now"

	const hours = Math.floor(diff / 3600)
	const minutes = Math.floor((diff % 3600) / 60)

	if (hours > 24) {
		const days = Math.floor(hours / 24)
		const remainingHours = hours % 24
		return `${days}d ${remainingHours}h`
	}

	if (hours > 0) {
		return `${hours}h ${minutes}m`
	}

	return `${minutes}m`
}

/**
 * Formats utilization as a percentage
 */
function formatUtilization(utilization: number): string {
	return `${(utilization * 100).toFixed(1)}%`
}

/**
 * Progress bar component for displaying usage
 */
const UsageProgressBar: React.FC<{ utilization: number; label: string }> = ({ utilization, label }) => {
	const percentage = Math.min(utilization * 100, 100)
	const isWarning = percentage >= 70
	const isCritical = percentage >= 90

	return (
		<div className="w-full">
			<div className="text-xs text-vscode-descriptionForeground mb-1">{label}</div>
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

export const ClaudeCodeRateLimitDashboard: React.FC<ClaudeCodeRateLimitDashboardProps> = ({ isAuthenticated }) => {
	const [rateLimits, setRateLimits] = useState<ClaudeCodeRateLimitInfo | null>(null)
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
		vscode.postMessage({ type: "requestClaudeCodeRateLimits" })
	}, [isAuthenticated])

	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "claudeCodeRateLimits") {
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

	// Fetch rate limits when authenticated
	useEffect(() => {
		if (isAuthenticated) {
			fetchRateLimits()
		}
	}, [isAuthenticated, fetchRateLimits])

	if (!isAuthenticated) {
		return null
	}

	if (isLoading && !rateLimits) {
		return (
			<div className="bg-vscode-editor-background border border-vscode-panel-border rounded-md p-3">
				<div className="text-sm text-vscode-descriptionForeground">Loading rate limits...</div>
			</div>
		)
	}

	if (error) {
		return (
			<div className="bg-vscode-editor-background border border-vscode-panel-border rounded-md p-3">
				<div className="flex items-center justify-between">
					<div className="text-sm text-vscode-errorForeground">Failed to load rate limits</div>
					<button
						onClick={fetchRateLimits}
						className="text-xs text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground cursor-pointer bg-transparent border-none">
						Retry
					</button>
				</div>
			</div>
		)
	}

	if (!rateLimits) {
		return null
	}

	return (
		<div className="bg-vscode-editor-background border border-vscode-panel-border rounded-md p-3">
			<div className="mb-3">
				<div className="text-sm font-medium text-vscode-foreground">Usage Limits</div>
			</div>

			<div className="space-y-3">
				{/* 5-hour limit */}
				<div className="flex flex-col gap-1">
					<div className="flex items-center justify-between text-xs">
						<span className="text-vscode-foreground">
							Limit: {rateLimits.representativeClaim || "5-hour"}
						</span>
						<span className="text-vscode-descriptionForeground">
							{formatUtilization(rateLimits.fiveHour.utilization)} used • resets in{" "}
							{formatResetTime(rateLimits.fiveHour.resetTime)}
						</span>
					</div>
					<UsageProgressBar utilization={rateLimits.fiveHour.utilization} label="" />
				</div>

				{/* Weekly limit (if available) */}
				{rateLimits.weeklyUnified && rateLimits.weeklyUnified.utilization > 0 && (
					<div className="flex flex-col gap-1">
						<div className="flex items-center justify-between text-xs">
							<span className="text-vscode-foreground">Weekly</span>
							<span className="text-vscode-descriptionForeground">
								{formatUtilization(rateLimits.weeklyUnified.utilization)} used • resets in{" "}
								{formatResetTime(rateLimits.weeklyUnified.resetTime)}
							</span>
						</div>
						<UsageProgressBar utilization={rateLimits.weeklyUnified.utilization} label="" />
					</div>
				)}
			</div>
		</div>
	)
}
