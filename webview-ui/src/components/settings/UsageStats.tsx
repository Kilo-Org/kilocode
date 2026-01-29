import React from "react"
import { VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react"

interface UsageStatsProps {
    dailyCreditsRemaining: number
    dailyLimit: number
    dailyRequests: number
    dailyRequestsLimit: number
    monthlyCostCredits: number
    currentPlan?: string
}

export const UsageStats: React.FC<UsageStatsProps> = ({
    dailyCreditsRemaining,
    dailyLimit,
    dailyRequests,
    dailyRequestsLimit,
    monthlyCostCredits,
    currentPlan,
}) => {
    const creditsPercentage = Math.min(100, Math.max(0, (dailyCreditsRemaining / dailyLimit) * 100))
    // Example: 200 requests / 200 limit
    // If limit is 999999, it's basically unlimited
    const isUnlimitedRequests = dailyRequestsLimit > 10000
    const isFreePlan = currentPlan === "free"

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {/* Only show Daily Credits section for non-free plans */}
            {!isFreePlan && (
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "8px",
                        padding: "12px",
                        background: "var(--vscode-editor-inactiveSelectionBackground)",
                        borderRadius: "6px",
                    }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontWeight: "bold" }}>Daily Credits</span>
                        <span style={{ fontFamily: "monospace" }}>
                            ${dailyCreditsRemaining.toFixed(2)} / ${dailyLimit.toFixed(2)}
                        </span>
                    </div>
                    <div
                        style={{
                            height: "8px",
                            width: "100%",
                            background: "var(--vscode-progressBar-background)",
                            borderRadius: "4px",
                            overflow: "hidden",
                        }}>
                        <div
                            style={{
                                height: "100%",
                                width: `${creditsPercentage}%`,
                                background: creditsPercentage < 20 ? "var(--vscode-errorForeground)" : "var(--vscode-charts-green)",
                                transition: "width 0.3s ease",
                            }}
                        />
                    </div>
                    <div style={{ fontSize: "0.85em", color: "var(--vscode-descriptionForeground)" }}>
                        Resets every 24 hours. Used for premium models.
                    </div>
                </div>
            )}

            {!isUnlimitedRequests && (
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "8px",
                        padding: "12px",
                        background: "var(--vscode-editor-inactiveSelectionBackground)",
                        borderRadius: "6px",
                    }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontWeight: "bold" }}>Daily Requests</span>
                        <span style={{ fontFamily: "monospace" }}>
                            {dailyRequests} / {dailyRequestsLimit}
                        </span>
                    </div>
                    {isFreePlan && (
                        <div style={{ fontSize: "0.85em", color: "var(--vscode-descriptionForeground)" }}>
                            Resets every 24 hours. Upgrade to get more requests.
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
