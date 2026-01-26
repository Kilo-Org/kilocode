import React, { useState, useEffect } from "react"
import { VSCodeButton, VSCodeProgressRing, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { AgenticaClient, UpgradeResponse } from "@/services/AgenticaClient"
import { useExtensionState } from "@/context/ExtensionStateContext"

interface UpgradeModalProps {
    isOpen: boolean
    onClose: () => void
    planId: string
    isDowngrade: boolean
    client: AgenticaClient
    onSuccess: (data: UpgradeResponse) => void
}

export const UpgradeModal: React.FC<UpgradeModalProps> = ({ isOpen, onClose, planId, isDowngrade, client, onSuccess }) => {
    const { apiConfiguration } = useExtensionState()
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [userCredits, setUserCredits] = useState<number | null>(null)
    const [creditsLoading, setCreditsLoading] = useState(false)
    const [showConfetti, setShowConfetti] = useState(false)

    const planCost =
        planId === "plus" ? 20000 : planId === "pro" ? 50000 : planId === "max" ? 200000 : 0
    const planCostDollars = planCost / 1000 // Simplistic conversion based on 20k=$20

    useEffect(() => {
        if (isOpen) {
            setCreditsLoading(true)
            client
                .getUserCredits()
                .then((data) => setUserCredits(data.credits))
                //.catch((err) => console.error("Failed to fetch credits", err))
                // Catching here might swallow errors important for debugging, will log but optional
                .finally(() => setCreditsLoading(false))
            setShowConfetti(false)
            setError(null)
        }
    }, [isOpen, client])

    if (!isOpen) return null

    const handleConfirm = async () => {
        setLoading(true)
        setError(null)
        try {
            const result = await client.upgradeSubscription(planId)
            // Only show confetti for upgrades, not downgrades
            if (!isDowngrade) {
                setShowConfetti(true)
            }
            // Show confetti for 3 seconds before closing (only for upgrades)
            const delay = isDowngrade ? 0 : 3000
            setTimeout(() => {
                onSuccess(result)
                onClose()
            }, delay)
        } catch (err: any) {
            console.error("Upgrade failed", err)
            setError(err.response?.data?.message || err.message || "Failed to upgrade subscription")
        } finally {
            setLoading(false)
        }
    }

    const hasInsufficientCredits = userCredits !== null && userCredits < planCost

    // If downgrading, we don't need to check credits
    const canConfirm = isDowngrade || (!hasInsufficientCredits && !creditsLoading)

    return (
        <div
            style={{
                position: "fixed",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: "rgba(0, 0, 0, 0.2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 1000,
            }}>
            <div
                style={{
                    background: "var(--vscode-editor-background)",
                    border: "1px solid var(--vscode-widget-border)",
                    borderRadius: "8px",
                    padding: "24px",
                    width: "450px",
                    maxWidth: "90%",
                    maxHeight: "90vh",
                    overflow: "auto",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "16px",
                }}>
                <h2 style={{ margin: 0, fontSize: "1.5em", fontWeight: "600" }}>
                    {isDowngrade ? "Confirm Downgrade" : `Upgrade to ${planId.charAt(0).toUpperCase() + planId.slice(1)}`}
                </h2>

                {isDowngrade ? (
                    <div style={{ color: "var(--vscode-foreground)", lineHeight: "1.4" }}>
                        <p>
                            Your plan will switch to <strong style={{ color: "var(--vscode-textLink-foreground)" }}>{planId}</strong> at the end of your current billing cycle.
                        </p>
                        <div
                            style={{
                                marginTop: "12px",
                                padding: "8px 12px",
                                background: "var(--vscode-editor-inactiveSelectionBackground)",
                                borderLeft: "3px solid var(--vscode-charts-yellow)",
                                fontSize: "0.9em"
                            }}>
                            <strong>Note:</strong> No pro-rated refund will be given for the remaining time on your current plan.
                        </div>
                    </div>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "12px", fontSize: "0.95em" }}>
                        <p style={{ margin: 0 }}>
                            <strong style={{ color: "var(--vscode-textLink-foreground)" }}>{planCost} credits</strong> (${planCostDollars}) will be deducted from your GenLabs Account,{" "}
                            <span style={{ fontFamily: "monospace", opacity: 0.8 }}>{apiConfiguration?.agenticaEmail}</span>.
                        </p>

                        <div style={{
                            padding: "12px",
                            background: "var(--vscode-textBlockQuote-background)",
                            borderLeft: "4px solid var(--vscode-textBlockQuote-border)",
                            borderRadius: "2px"
                        }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                {creditsLoading ? (
                                    <span>Loading credits...</span>
                                ) : (
                                    <span>
                                        You currently have <strong>{userCredits !== null ? userCredits : '---'}</strong> credits.
                                    </span>
                                )}
                                <VSCodeButton 
                                    appearance="icon" 
                                    onClick={() => {
                                        setCreditsLoading(true)
                                        client.getUserCredits()
                                            .then((data) => setUserCredits(data.credits))
                                            .catch((err) => console.error("Failed to refresh credits", err))
                                            .finally(() => setCreditsLoading(false))
                                    }}
                                    disabled={creditsLoading}
                                    title="Refresh credits"
                                >
                                    <span className={`codicon codicon-refresh ${creditsLoading ? 'rotating' : ''}`} />
                                </VSCodeButton>
                            </div>
                            {hasInsufficientCredits && (
                                <div style={{ marginTop: "8px" }}>
                                    <VSCodeLink href="https://app.genlabs.dev/profile" target="_blank">
                                        Buy more by signing into your GenLabs account
                                    </VSCodeLink>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {error && (
                    <div
                        style={{
                            color: "var(--vscode-errorForeground)",
                            background: "rgba(255, 0, 0, 0.1)",
                            padding: "8px",
                            borderRadius: "4px",
                            fontSize: "0.9em"
                        }}>
                        {error}
                    </div>
                )}

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", marginTop: "8px" }}>
                    <VSCodeButton appearance="secondary" onClick={onClose} disabled={loading}>
                        Cancel
                    </VSCodeButton>
                    <VSCodeButton
                        onClick={handleConfirm}
                        disabled={loading || !canConfirm}
                        appearance="primary"
                    >
                        {loading ? <VSCodeProgressRing style={{ height: "16px" }} /> : "Confirm"}
                    </VSCodeButton>
                </div>

                {/* Confetti Animation */}
                {showConfetti && (
                    <div style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        pointerEvents: "none",
                        overflow: "hidden"
                    }}>
                        {/* Simple confetti effect using CSS animations */}
                        {[...Array(20)].map((_, i) => (
                            <div
                                key={i}
                                style={{
                                    position: "absolute",
                                    width: "10px",
                                    height: "10px",
                                    backgroundColor: ["#ff6b6b", "#4ecdc4", "#45b7d1", "#96ceb4", "#feca57"][i % 5],
                                    top: "-10px",
                                    left: `${Math.random() * 100}%`,
                                    animation: `confetti-fall 3s linear ${i * 0.1}s`,
                                    transform: `rotate(${Math.random() * 360}deg)`
                                }}
                            />
                        ))}
                        <style>{`
                            @keyframes confetti-fall {
                                0% {
                                    transform: translateY(-100vh) rotate(0deg);
                                    opacity: 1;
                                }
                                100% {
                                    transform: translateY(100vh) rotate(720deg);
                                    opacity: 0;
                                }
                            }
                        `}</style>
                    </div>
                )}
            </div>
        </div>
    )
}
