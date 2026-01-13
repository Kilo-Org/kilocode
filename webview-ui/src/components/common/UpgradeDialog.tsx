import React, { useState } from "react"
import { VSCodeButton, VSCodeDialog } from "@vscode/webview-ui-toolkit/react"
import { useAgentica } from "../../hooks/useAgentica"

interface UpgradeDialogProps {
    isOpen: boolean
    onClose: () => void
}

export const UpgradeDialog: React.FC<UpgradeDialogProps> = ({ isOpen, onClose }) => {
    const { upgrade, isLoading } = useAgentica()
    const [selectedPlan, setSelectedPlan] = useState("pro")

    const handleUpgrade = async () => {
        try {
            await upgrade({ plan: selectedPlan })
            onClose()
        } catch (error) {
            // Error is handled by the hook
            console.error("Upgrade failed:", error)
        }
    }

    return (
        <VSCodeDialog open={isOpen} onClose={onClose}>
            <div slot="header">Upgrade to Agentica Pro</div>
            <div slot="body">
                <p>Upgrade your Agentica account to unlock premium features:</p>
                <ul>
                    <li>Unlimited API calls</li>
                    <li>Priority support</li>
                    <li>Advanced analytics</li>
                    <li>Custom integrations</li>
                </ul>
                
                <div className="plan-selection">
                    <label>
                        <input
                            type="radio"
                            name="plan"
                            value="pro"
                            checked={selectedPlan === "pro"}
                            onChange={(e) => setSelectedPlan(e.target.value)}
                        />
                        Pro Plan - $29/month
                    </label>
                    <label>
                        <input
                            type="radio"
                            name="plan"
                            value="enterprise"
                            checked={selectedPlan === "enterprise"}
                            onChange={(e) => setSelectedPlan(e.target.value)}
                        />
                        Enterprise Plan - $99/month
                    </label>
                </div>
            </div>
            <div slot="footer">
                <VSCodeButton appearance="secondary" onClick={onClose}>
                    Cancel
                </VSCodeButton>
                <VSCodeButton onClick={handleUpgrade} disabled={isLoading}>
                    {isLoading ? "Processing..." : "Upgrade Now"}
                </VSCodeButton>
            </div>
        </VSCodeDialog>
    )
}