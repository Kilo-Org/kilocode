import React, { useState, useEffect } from "react"
import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useAgentica } from "../../../hooks/useAgentica"

export const Agentica: React.FC = () => {
    const { login, upgrade, status, isLoading } = useAgentica()
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [error, setError] = useState<string | null>(null)
    const [isLoggedIn, setIsLoggedIn] = useState(false)

    useEffect(() => {
        if (status) {
            setIsLoggedIn(status.isLoggedIn)
        }
    }, [status])

    const handleLogin = async () => {
        setError(null)
        try {
            await login({ email, password })
            setIsLoggedIn(true)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Login failed")
        }
    }

    const handleUpgrade = async () => {
        setError(null)
        try {
            await upgrade({ plan: "pro" })
        } catch (err) {
            setError(err instanceof Error ? err.message : "Upgrade failed")
        }
    }

    return (
        <div className="agentica-provider">
            <h3>Agentica Provider</h3>
            
            {!isLoggedIn ? (
                <div className="login-form">
                    <VSCodeTextField
                        placeholder="Email"
                        value={email}
                        onChange={(e) => setEmail((e.target as HTMLInputElement).value)}
                    />
                    <VSCodeTextField
                        type="password"
                        placeholder="Password"
                        value={password}
                        onChange={(e) => setPassword((e.target as HTMLInputElement).value)}
                    />
                    <VSCodeButton onClick={handleLogin} disabled={isLoading}>
                        {isLoading ? "Logging in..." : "Login"}
                    </VSCodeButton>
                </div>
            ) : (
                <div className="upgrade-section">
                    <p>Logged in as {status?.user?.email}</p>
                    <VSCodeButton onClick={handleUpgrade} disabled={isLoading}>
                        {isLoading ? "Processing..." : "Upgrade to Pro"}
                    </VSCodeButton>
                </div>
            )}
            
            {error && <div className="error-message">{error}</div>}
        </div>
    )
}