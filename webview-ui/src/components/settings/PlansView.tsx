import React, { useEffect, useState } from "react"
import { VSCodeButton, VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react"
import { AgenticaClient, SubscriptionResponse, UpgradeResponse } from "@/services/AgenticaClient"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { PlanCard } from "./PlanCard"
import { UsageStats } from "./UsageStats"
import { UpgradeModal } from "./UpgradeModal"

interface PlansViewProps {
    onDone: () => void
}

const PlansView: React.FC<PlansViewProps> = ({ onDone }) => {
    const { apiConfiguration } = useExtensionState()
    const [loading, setLoading] = useState(true)
    const [subscription, setSubscription] = useState<SubscriptionResponse | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [upgradeModalOpen, setUpgradeModalOpen] = useState(false)
    const [selectedPlanId, setSelectedPlanId] = useState<string>("")
    const [isDowngrade, setIsDowngrade] = useState(false)
    // In a real scenario, this should come from a wallet/balance endpoint or context
    const [userCredits, setUserCredits] = useState(0)

    const client = new AgenticaClient(
        apiConfiguration?.agenticaApiKey || `${apiConfiguration?.agenticaEmail || ""}|${apiConfiguration?.agenticaPassword || ""}`,
        apiConfiguration?.agenticaBaseUrl,
    )

    const fetchSubscription = async () => {
        setLoading(true)
        setError(null)
        try {
            const data = await client.getSubscription()
            setSubscription(data)

            // Fetch actual user credits
            const creditsData = await client.getUserCredits()
            setUserCredits(creditsData.credits)
        } catch (err: any) {
            console.error("Failed to fetch subscription", err)
            setError("Failed to load subscription data. Please check your network or login status.")
        } finally {
            setLoading(false)
        }
    }

    const handleRefresh = () => {
        fetchSubscription()
    }

    useEffect(() => {
        fetchSubscription()
    }, [])

    const handleUpgradeClick = (planId: string) => {
        setSelectedPlanId(planId)
        setIsDowngrade(false)
        setUpgradeModalOpen(true)
    }

    const handleDowngradeClick = (planId: string) => {
        setSelectedPlanId(planId)
        setIsDowngrade(true)
        setUpgradeModalOpen(true)
    }

    const handleUpgradeSuccess = (data: UpgradeResponse) => {
        fetchSubscription()
        // Logic to show toast/notification could go here
    }

    if (loading && !subscription) {
        return (
            <div style={{ display: "flex", justifyContent: "center", padding: "20px" }}>
                <VSCodeProgressRing />
            </div>
        )
    }

    if (error) {
        return (
            <div style={{ padding: "20px", color: "var(--vscode-errorForeground)" }}>
                {error}
                <br />
                <VSCodeButton onClick={fetchSubscription} style={{ marginTop: "10px" }}>
                    Retry
                </VSCodeButton>
            </div>
        )
    }

    if (!subscription) return null

    const currentPlanId = subscription.data.plan_tier

    const plans = [
        { id: "free", price: "$0", period: "month", cost: 0, features: ["Basic Models", "300 req/day"] },
        { id: "plus", price: "$20", period: "month", cost: 20000, features: ["Bonus Models", "$30/month Credits (refills daily)"] },
        { id: "pro", price: "$50", period: "month", cost: 50000, features: ["Bonus Models", "$90/month Credits (refills daily)"] },
        { id: "max", price: "$200", period: "month", cost: 200000, features: ["Bonus Models", "$360/month Credits (refills daily)"] },
    ]

    const selectedPlan = plans.find(p => p.id === selectedPlanId)

    return (
        <div
            style={{
                position: "fixed",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                padding: "10px 0px 0px 20px",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
            }}>
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    paddingRight: "17px",
                    marginBottom: "20px",
                }}>
                <h2 style={{ margin: 0 }}>Plans & Subscription</h2>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <VSCodeButton appearance="icon" onClick={handleRefresh} title="Refresh">
                        <span className="codicon codicon-refresh" />
                    </VSCodeButton>
                    <VSCodeButton appearance="icon" onClick={onDone}>
                        <span className="codicon codicon-close" />
                    </VSCodeButton>
                </div>
            </div>

            <div style={{ flex: 1, overflowY: "auto", paddingRight: "20px", paddingBottom: "20px" }}>
                {/* Pending Downgrade Banner */}
                {subscription.data.scheduled_downgrade_plan && (
                    <div style={{
                        marginTop: "16px",
                        padding: "12px",
                        backgroundColor: "var(--vscode-editor-inactiveSelectionBackground)",
                        borderRadius: "6px",
                        border: "1px solid var(--vscode-panel-border)"
                    }}>
                        <div style={{ fontSize: "14px", fontWeight: "600", marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span>Current Plan: {subscription.data.plan_tier.toUpperCase()}</span>
                            <VSCodeButton 
                                onClick={() => setUpgradeModalOpen(true)}
                                appearance="secondary"
                                style={{ fontSize: "11px", padding: "2px 10px", marginTop: "4px" }}
                            >
                                Manage Plan
                            </VSCodeButton>
                        </div>
                        <span className="codicon codicon-info" style={{
                            color: "var(--vscode-charts-yellow)",
                            fontSize: "20px",
                            flexShrink: 0
                        }}></span>
                        <div style={{ flex: 1 }}>
                            <strong style={{ color: "var(--vscode-foreground)", display: "block", marginBottom: "4px" }}>
                                Downgrade Scheduled
                            </strong>
                            <p style={{
                                margin: 0,
                                color: "var(--vscode-descriptionForeground)",
                                fontSize: "0.9em"
                            }}>
                                You'll be downgraded to <strong>{subscription.data.scheduled_downgrade_plan}</strong> on{" "}
                                {subscription.data.renewal_date
                                    ? new Date(subscription.data.renewal_date).toLocaleDateString()
                                    : "your next billing date"}
                            </p>
                        </div>
                    </div>
                )}

                <div style={{ marginBottom: "24px" }}>
                    <h3 style={{ marginBottom: "12px" }}>Usage & Limits</h3>
                    <UsageStats
                        dailyCreditsRemaining={subscription.data.daily_credits_remaining}
                        dailyLimit={subscription.limits.daily_credits}
                        dailyRequests={(subscription.data as any).daily_requests_used || 0}
                        dailyRequestsLimit={subscription.limits.daily_requests}
                        monthlyCostCredits={subscription.limits.monthly_cost_credits}
                        currentPlan={subscription.data.plan_tier}
                    />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
                    {plans.map((plan) => (
                        <PlanCard
                            key={plan.id}
                            planId={plan.id as any}
                            currentPlanId={currentPlanId}
                            price={plan.price}
                            period={plan.period}
                            features={plan.features}
                            onUpgrade={handleUpgradeClick}
                            onDowngrade={handleDowngradeClick}
                            scheduledDowngrade={subscription.data.scheduled_downgrade_plan}
                        />
                    ))}
                </div>

                <div style={{ marginTop: "20px", fontSize: "0.9em", color: "var(--vscode-descriptionForeground)" }}>
                    <p>Subscription costs are deducted from your GenLabs Credits balance.</p>
                    {subscription.data.renewal_date && currentPlanId !== "free" && (
                        <p>Current plan renews on: {new Date(subscription.data.renewal_date).toLocaleDateString()}</p>
                    )}
                </div>
            </div>

            <UpgradeModal
                isOpen={upgradeModalOpen}
                onClose={() => setUpgradeModalOpen(false)}
                planId={selectedPlanId}
                isDowngrade={isDowngrade}
                client={client}
                onSuccess={handleUpgradeSuccess}
            />
        </div>
    )
}

export default PlansView
