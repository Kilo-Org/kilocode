import React, { useState, useEffect, useCallback } from "react"
import { VSCodeTextField, VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import type { ProviderSettings, OrganizationAllowList } from "@roo-code/types"
import { agenticaDefaultModelId, ORGANIZATION_ALLOW_ALL } from "@roo-code/types"
import { vscode } from "@/utils/vscode"
import { AgenticaClient } from "@/services/AgenticaClient"
import { securePasswordStorage } from "@/utils/passwordStorage"
import PlansView from "../PlansView"
import { ModelPicker } from "../ModelPicker"
import type { RouterModels } from "@roo/api"

type AgenticaProps = {
    apiConfiguration: ProviderSettings
    setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
    uriScheme?: string
    routerModels?: RouterModels
    organizationAllowList?: OrganizationAllowList
    modelValidationError?: string
    simplifySettings?: boolean
}

type DeviceAuthStatus = "idle" | "pending" | "success" | "error"

export const Agentica: React.FC<AgenticaProps> = ({
    apiConfiguration,
    setApiConfigurationField,
    uriScheme,
    routerModels,
    organizationAllowList = ORGANIZATION_ALLOW_ALL,
    modelValidationError,
    simplifySettings,
}) => {
    const [subscription, setSubscription] = useState<any>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [deviceAuthStatus, setDeviceAuthStatus] = useState<DeviceAuthStatus>("idle")
    const [deviceAuthCode, setDeviceAuthCode] = useState<string>()
    const [deviceAuthVerificationUrl, setDeviceAuthVerificationUrl] = useState<string>()
    const [deviceAuthTimeRemaining, setDeviceAuthTimeRemaining] = useState<number>()
    const [deviceAuthError, setDeviceAuthError] = useState<string>()
    const [showPlansView, setShowPlansView] = useState(false)

    // Load stored password on component mount
    useEffect(() => {
        const loadStoredPassword = async () => {
            try {
                const storedPassword = await securePasswordStorage.getPassword('agentica')
                if (storedPassword && !apiConfiguration.agenticaPassword) {
                    setApiConfigurationField("agenticaPassword", storedPassword)
                }
            } catch (error) {
                console.error('Failed to load stored password:', error)
            }
        }
        loadStoredPassword()
    }, [apiConfiguration.agenticaPassword, setApiConfigurationField])

    // Listen for device auth messages from extension
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data
            switch (message.type) {
                case "agenticaDeviceAuthStarted":
                    console.log("[Agentica] Device auth started", message)
                    setDeviceAuthStatus("pending")
                    setDeviceAuthCode(message.deviceAuthCode)
                    setDeviceAuthVerificationUrl(message.deviceAuthVerificationUrl)
                    setDeviceAuthTimeRemaining(message.deviceAuthExpiresIn * 1000)
                    setDeviceAuthError(undefined)
                    break
                case "agenticaDeviceAuthPolling":
                    // Update timer from polling check (every 5 seconds)
                    if (message.deviceAuthTimeRemaining !== undefined) {
                        setDeviceAuthTimeRemaining(message.deviceAuthTimeRemaining)
                    }
                    break
                case "agenticaDeviceAuthTick":
                    // Update timer from per-second tick for smooth countdown
                    if (message.deviceAuthTimeRemaining !== undefined) {
                        setDeviceAuthTimeRemaining(message.deviceAuthTimeRemaining)
                    }
                    break
                case "agenticaDeviceAuthComplete":
                    console.log("[Agentica] Device auth complete", message)
                    setDeviceAuthStatus("success")
                    setDeviceAuthError(undefined)
                    // Reset after a moment
                    setTimeout(() => {
                        setDeviceAuthStatus("idle")
                    }, 2000)
                    break
                case "agenticaDeviceAuthFailed":
                    console.error("[Agentica] Device auth failed", message)
                    setDeviceAuthStatus("error")
                    setDeviceAuthError(message.deviceAuthError || "Authentication failed")
                    // Clear the auth code and URL
                    setDeviceAuthCode(undefined)
                    setDeviceAuthVerificationUrl(undefined)
                    setDeviceAuthTimeRemaining(undefined)
                    break
            }
        }

        window.addEventListener("message", handleMessage)
        return () => window.removeEventListener("message", handleMessage)
    }, [])

    const fetchSubscription = async () => {
        if (!apiConfiguration.agenticaEmail || !apiConfiguration.agenticaPassword) return

        setLoading(true)
        setError(null)
        try {
            const client = new AgenticaClient(
                `${apiConfiguration.agenticaEmail}|${apiConfiguration.agenticaPassword}`,
                apiConfiguration.agenticaBaseUrl
            )
            const subscriptionData = await client.getSubscription()
            setSubscription(subscriptionData)
        } catch (err: any) {
            console.error("Failed to fetch subscription:", err)
            setError("Failed to fetch subscription status")
        } finally {
            setLoading(false)
        }
    }

    // Fetch subscription status when credentials are provided (API key or email/password)
    useEffect(() => {
        if (apiConfiguration.agenticaApiKey) {
            fetchSubscriptionWithApiKey()
        } else if (apiConfiguration.agenticaEmail && apiConfiguration.agenticaPassword) {
            fetchSubscription()
        }
    }, [apiConfiguration.agenticaApiKey, apiConfiguration.agenticaEmail, apiConfiguration.agenticaPassword])

    const handlePlansViewClose = useCallback(() => {
        setShowPlansView(false)
        // Refresh subscription data when closing the plans view
        fetchSubscription()
    }, [fetchSubscription])

    const fetchSubscriptionWithApiKey = async () => {
        if (!apiConfiguration.agenticaApiKey) return

        setLoading(true)
        setError(null)
        try {
            const client = new AgenticaClient(
                apiConfiguration.agenticaApiKey,
                apiConfiguration.agenticaBaseUrl
            )
            const subscriptionData = await client.getSubscription()
            setSubscription(subscriptionData)
        } catch (err: any) {
            console.error("Failed to fetch subscription:", err)
            setError("Failed to fetch subscription status")
        } finally {
            setLoading(false)
        }
    }


    const handleDeviceAuth = useCallback(() => {
        setDeviceAuthStatus("pending")
        setDeviceAuthError(undefined)
        vscode.postMessage({ type: "startAgenticaDeviceAuth" })
    }, [])

    const handleCancelDeviceAuth = useCallback(() => {
        vscode.postMessage({ type: "cancelAgenticaDeviceAuth" })
        // Reset state immediately for better UX
        setDeviceAuthStatus("idle")
        setDeviceAuthCode(undefined)
        setDeviceAuthVerificationUrl(undefined)
        setDeviceAuthTimeRemaining(undefined)
        setDeviceAuthError(undefined)
    }, [])

    const formatTimeRemaining = (ms: number) => {
        const seconds = Math.floor(ms / 1000)
        const minutes = Math.floor(seconds / 60)
        const remainingSeconds = seconds % 60
        return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`
    }

    const handleLogin = async () => {
        if (!apiConfiguration.agenticaEmail || !apiConfiguration.agenticaPassword) {
            setError("Please enter both email and password")
            return
        }

        try {
            // Store password securely
            await securePasswordStorage.storePassword('agentica', apiConfiguration.agenticaPassword)
        } catch (error) {
            console.error('Failed to store password securely:', error)
            // Continue with login even if password storage fails
        }

        await fetchSubscription()
    }

    return (
        <div
            style={{
                border: "1px solid var(--vscode-panel-border)",
                borderRadius: "8px",
                padding: "16px",
                backgroundColor: "var(--vscode-editor-background)",
                marginTop: "8px"
            }}>
            <div style={{ marginBottom: "16px" }}>
                <h3 style={{ margin: "0 0 8px 0", fontSize: "14px", fontWeight: "600", color: "var(--vscode-foreground)" }}>
                    Sign in with GenLabs
                </h3>
                {/* <p style={{ margin: "0 0 12px 0", fontSize: "12px", color: "var(--vscode-descriptionForeground)", lineHeight: "1.4" }}>
					Sign in with GitHub or enter your GenLabs account credentials to use Agentica's models.
				</p> */}
            </div>

            {/* GitHub Sign‑In Buttons */}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "16px" }}>
                <VSCodeButton
                    onClick={handleDeviceAuth}
                    disabled={deviceAuthStatus === "pending"}
                    style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                    <span className="codicon codicon-github" style={{ fontSize: "16px", flexShrink: 0 }} aria-hidden="true"></span>
                    <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {deviceAuthStatus === "pending" ? "Authenticating..." : "Continue with GitHub"}
                    </span>
                </VSCodeButton>

                {deviceAuthStatus === "pending" && deviceAuthCode && deviceAuthVerificationUrl && (
                    <div style={{
                        padding: "12px",
                        backgroundColor: "var(--vscode-editor-inactiveSelectionBackground)",
                        borderRadius: "6px",
                        border: "1px solid var(--vscode-panel-border)"
                    }}>
                        <div style={{ fontSize: "12px", fontWeight: "600", marginBottom: "8px", color: "var(--vscode-foreground)" }}>
                            Enter this code on GitHub:
                        </div>
                        <div style={{
                            fontSize: "24px",
                            fontWeight: "700",
                            letterSpacing: "4px",
                            textAlign: "center",
                            padding: "12px",
                            backgroundColor: "var(--vscode-editor-background)",
                            borderRadius: "4px",
                            marginBottom: "8px",
                            fontFamily: "monospace"
                        }}>
                            {deviceAuthCode}
                        </div>
                        <div style={{ fontSize: "11px", color: "var(--vscode-descriptionForeground)", marginBottom: "8px", textAlign: "center" }}>
                            Visit: <a href={deviceAuthVerificationUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--vscode-textLink-foreground)" }}>{deviceAuthVerificationUrl}</a>
                        </div>
                        {deviceAuthTimeRemaining !== undefined && deviceAuthTimeRemaining > 0 && (
                            <div style={{ fontSize: "11px", color: "var(--vscode-descriptionForeground)", textAlign: "center", marginBottom: "12px" }}>
                                <div style={{ marginBottom: "4px" }}>Time remaining: {formatTimeRemaining(deviceAuthTimeRemaining)}</div>
                            </div>
                        )}
                        {deviceAuthTimeRemaining !== undefined && deviceAuthTimeRemaining <= 0 && (
                            <div style={{ fontSize: "11px", color: "var(--vscode-descriptionForeground)", textAlign: "center", marginBottom: "12px" }}>
                                <div style={{ marginBottom: "4px" }}>Authorization confirmation pending...</div>
                                <div style={{ fontSize: "10px", opacity: 0.85 }}>This can take up to 30 seconds. Do not close this dialog.</div>
                            </div>
                        )}
                        <div style={{ fontSize: "10px", color: "var(--vscode-descriptionForeground)", backgroundColor: "var(--vscode-editor-background)", padding: "8px", borderRadius: "4px", marginBottom: "8px", lineHeight: "1.4" }}>
                            💡 After authorizing on GitHub, confirmation may take up to 30 seconds. This is normal. Keep this window open.
                        </div>
                        <VSCodeButton
                            onClick={handleCancelDeviceAuth}
                            appearance="secondary"
                            style={{ width: "100%" }}>
                            Cancel
                        </VSCodeButton>
                    </div>
                )}

                {deviceAuthStatus === "error" && deviceAuthError && (
                    <div style={{
                        padding: "12px",
                        backgroundColor: "var(--vscode-inputValidation-errorBackground)",
                        borderRadius: "6px",
                        border: "1px solid var(--vscode-inputValidation-errorBorder)",
                        color: "var(--vscode-errorForeground)",
                        fontSize: "12px"
                    }}>
                        {deviceAuthError}
                    </div>
                )}

                {deviceAuthStatus === "success" && (
                    <div style={{
                        padding: "12px",
                        backgroundColor: "var(--vscode-inputValidation-infoBackground)",
                        borderRadius: "6px",
                        border: "1px solid var(--vscode-inputValidation-infoBorder)",
                        color: "var(--vscode-foreground)",
                        fontSize: "12px",
                        textAlign: "center"
                    }}>
                        ✓ Successfully authenticated!
                    </div>
                )}
            </div>


            {/* Show API Key if authenticated via GitHub */}
            {apiConfiguration.agenticaApiKey && (
                <div style={{ marginBottom: "16px", padding: "12px", backgroundColor: "var(--vscode-editor-inactiveSelectionBackground)", borderRadius: "6px", border: "1px solid var(--vscode-panel-border)" }}>
                    <div style={{ fontSize: "12px", fontWeight: "600", marginBottom: "4px", color: "var(--vscode-foreground)" }}>
                        Authenticated via GitHub
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--vscode-descriptionForeground)", wordBreak: "break-all" }}>
                        API Key: {apiConfiguration.agenticaApiKey.substring(0, 20)}...
                    </div>
                    {apiConfiguration.agenticaEmail && (
                        <div style={{ fontSize: "11px", color: "var(--vscode-descriptionForeground)", marginTop: "4px" }}>
                            Email: {apiConfiguration.agenticaEmail}
                        </div>
                    )}
                </div>
            )}

            {/* Divider
			{!apiConfiguration.agenticaApiKey && (
				<div style={{ display: "flex", alignItems: "center", marginBottom: "16px" }}>
					<div style={{ flex: 1, height: "1px", backgroundColor: "var(--vscode-panel-border)" }}></div>
					<span style={{ margin: "0 12px", fontSize: "12px", color: "var(--vscode-descriptionForeground)" }}>OR</span>
					<div style={{ flex: 1, height: "1px", backgroundColor: "var(--vscode-panel-border)" }}></div>
				</div>
			)} */}

            {/* Email/Password Login (only show if not using API key) */}
            {!apiConfiguration.agenticaApiKey && (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    <VSCodeTextField
                        value={apiConfiguration.agenticaEmail || ""}
                        onChange={(e: any) => setApiConfigurationField("agenticaEmail", e.target.value)}
                        placeholder="your-email@example.com"
                        style={{ width: "100%" }}>
                        <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                            Email
                            <span style={{ opacity: 0.7, fontSize: "0.9em" }}>(required)</span>
                        </span>
                    </VSCodeTextField>

                    <VSCodeTextField
                        value={apiConfiguration.agenticaPassword || ""}
                        onChange={(e: any) => setApiConfigurationField("agenticaPassword", e.target.value)}
                        placeholder="Your GenLabs password"
                        type="password"
                        style={{ width: "100%" }}>
                        <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                            Password
                            <span style={{ opacity: 0.7, fontSize: "0.9em" }}>(required)</span>
                        </span>
                    </VSCodeTextField>

                    {/* Add Login Button */}
                    <VSCodeButton
                        onClick={handleLogin}
                        disabled={loading || !apiConfiguration.agenticaEmail || !apiConfiguration.agenticaPassword}
                        style={{ marginTop: "8px" }}>
                        {loading ? "Logging in..." : "Login"}
                    </VSCodeButton>

                    {error && (
                        <div style={{ color: "var(--vscode-errorForeground)", fontSize: "12px", marginTop: "4px" }}>
                            {error}
                        </div>
                    )}
                </div>
            )}

            {/* Model Selection */}
            <ModelPicker
                apiConfiguration={apiConfiguration}
                setApiConfigurationField={setApiConfigurationField}
                defaultModelId={agenticaDefaultModelId}
                models={routerModels?.agentica ?? {}}
                modelIdKey="agenticaModelId"
                serviceName="Agentica"
                serviceUrl="https://api.genlabs.dev/agentica/v1/models"
                organizationAllowList={organizationAllowList}
                errorMessage={modelValidationError}
                simplifySettings={simplifySettings}
            />

            {/* Display subscription status if available */}
            {subscription && (
                <div style={{
                    marginTop: "16px",
                    padding: "12px",
                    backgroundColor: "var(--vscode-editor-inactiveSelectionBackground)",
                    borderRadius: "6px",
                    border: "1px solid var(--vscode-panel-border)"
                }}>
                    <div style={{ fontSize: "14px", fontWeight: "600", marginBottom: "8px" }}>
                        Current Plan: {subscription.data.plan_tier.toUpperCase()}
                    </div>
                    <VSCodeButton
                        onClick={() => setShowPlansView(true)}
                        style={{ marginBottom: "8px", width: "100%" }}
                    >
                        Manage Plan
                    </VSCodeButton>
                    {showPlansView && (
                        <div style={{
                            position: 'fixed',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            backgroundColor: 'rgba(0, 0, 0, 0.5)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            zIndex: 1000
                        }}>
                            <PlansView onDone={handlePlansViewClose} />
                        </div>
                    )}
                    <div style={{ fontSize: "12px", color: "var(--vscode-descriptionForeground)" }}>
                        Daily Credits: ${subscription.data.daily_credits_remaining.toFixed(2)} / ${subscription.limits.daily_credits.toFixed(2)}
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--vscode-descriptionForeground)" }}>
                        Daily Requests: {subscription.limits.daily_requests} requests
                    </div>
                </div>
            )}

            <div style={{ marginTop: "16px", paddingTop: "12px", borderTop: "1px solid var(--vscode-panel-border)" }}>
                <div style={{ fontSize: "0.85em", color: "var(--vscode-descriptionForeground)", lineHeight: "1.4" }}>
                    New to GenLabs?{" "}
                    <a
                        href="https://genlabs.dev/signup"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "var(--vscode-textLink-foreground)", textDecoration: "underline" }}>
                        Create your free account
                    </a>
                    {" "}to get started with Agentica.
                </div>
            </div>
        </div>
    )
}
