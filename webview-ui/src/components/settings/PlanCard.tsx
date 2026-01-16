import React from "react"
import { VSCodeButton, VSCodeTag } from "@vscode/webview-ui-toolkit/react"

interface PlanCardProps {
    planId: "free" | "plus" | "pro" | "max"
    currentPlanId: string
    price: string
    period: string
    features: string[]
    onUpgrade: (planId: string) => void
    onDowngrade: (planId: string) => void
    loading?: boolean
    scheduledDowngrade?: string
}

export const PlanCard: React.FC<PlanCardProps> = ({
    planId,
    currentPlanId,
    price,
    period,
    features,
    onUpgrade,
    onDowngrade,
    loading = false,
    scheduledDowngrade,
}) => {
    const isCurrent = planId === currentPlanId
    const isDowngrade = ["free", "plus", "pro", "max"].indexOf(planId) < ["free", "plus", "pro", "max"].indexOf(currentPlanId)
    const isScheduled = scheduledDowngrade === planId

    return (
        <div
            style={{
                border: isCurrent ? "1px solid var(--vscode-focusBorder)" : "1px solid var(--vscode-widget-border)",
                padding: "20px",
                borderRadius: "6px",
                display: "flex",
                flexDirection: "column",
                gap: "16px",
                position: "relative",
                background: isCurrent ? "var(--vscode-editor-inactiveSelectionBackground)" : "var(--vscode-editor-background)",
                boxShadow: isCurrent ? "0 0 8px rgba(0, 0, 0, 0.2)" : "none",
            }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h3 style={{ margin: 0, fontSize: "1.1em", fontWeight: "600", color: "var(--vscode-foreground)" }}>
                    {planId.charAt(0).toUpperCase() + planId.slice(1)}
                </h3>
                {isCurrent && <VSCodeTag>Current</VSCodeTag>}
                {isScheduled && <VSCodeTag>Scheduled</VSCodeTag>}
            </div>

            <div style={{ fontSize: "1.8em", fontWeight: "bold", color: "var(--vscode-foreground)" }}>
                {price} <span style={{ fontSize: "0.5em", fontWeight: "normal", color: "var(--vscode-descriptionForeground)" }}>/ {period}</span>
            </div>

            <ul style={{ paddingLeft: "0", listStyle: "none", margin: "0", color: "var(--vscode-foreground)", fontSize: "0.9em", lineHeight: "1.6" }}>
                {features.map((feature, i) => (
                    <li key={i} style={{ display: "flex", alignItems: "center", marginBottom: "6px" }}>
                        <span style={{ marginRight: "8px", color: "var(--vscode-charts-green)" }}>✓</span>
                        {feature}
                    </li>
                ))}
            </ul>

            <div style={{ marginTop: "auto" }}>
                {isCurrent ? (
                    <VSCodeButton disabled style={{ width: "100%", opacity: 0.6 }} appearance="secondary">
                        Active
                    </VSCodeButton>
                ) : (
                    <VSCodeButton
                        appearance={isDowngrade ? "secondary" : "primary"}
                        style={{ width: "100%" }}
                        disabled={loading}
                        onClick={() => (isDowngrade ? onDowngrade(planId) : onUpgrade(planId))}>
                        {isDowngrade ? "Downgrade" : "Upgrade"}
                    </VSCodeButton>
                )}
            </div>
        </div>
    )
}
