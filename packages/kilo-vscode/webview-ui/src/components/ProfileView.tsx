import { Component, Show } from "solid-js"
import { useVSCode } from "../context/vscode"
import DeviceAuthCard from "./DeviceAuthCard"
import type { ProfileData, DeviceAuthState } from "../types/messages"

export type { ProfileData }

export interface ProfileViewProps {
  profileData: ProfileData | null | undefined
  deviceAuth: DeviceAuthState
  onLogin: () => void
}

const formatBalance = (amount: number): string => {
  return `$${amount.toFixed(2)}`
}

const ProfileView: Component<ProfileViewProps> = (props) => {
  const vscode = useVSCode()

  const handleLogin = () => {
    props.onLogin()
  }

  const handleLogout = () => {
    vscode.postMessage({ type: "logout" })
  }

  const handleRefresh = () => {
    vscode.postMessage({ type: "refreshProfile" })
  }

  const handleDashboard = () => {
    vscode.postMessage({ type: "openExternal", url: "https://app.kilo.ai/profile" })
  }

  const handleCancelLogin = () => {
    vscode.postMessage({ type: "cancelLogin" })
  }

  return (
    <div style={{ padding: "16px" }}>
      <h2
        style={{
          "font-size": "16px",
          "font-weight": "600",
          "margin-top": "0",
          "margin-bottom": "12px",
          color: "var(--vscode-foreground)",
        }}
      >
        Profile
      </h2>

      <div
        style={{
          height: "1px",
          background: "var(--vscode-panel-border)",
          "margin-bottom": "16px",
        }}
      />

      <Show
        when={props.profileData}
        fallback={
          <div style={{ display: "flex", "flex-direction": "column", gap: "12px" }}>
            <Show
              when={props.deviceAuth.status !== "idle"}
              fallback={
                <>
                  <p
                    style={{
                      "font-size": "13px",
                      color: "var(--vscode-descriptionForeground)",
                      margin: "0 0 8px 0",
                    }}
                  >
                    Not logged in
                  </p>
                  <button
                    onClick={handleLogin}
                    style={{
                      background: "var(--vscode-button-background)",
                      color: "var(--vscode-button-foreground)",
                      border: "none",
                      "border-radius": "4px",
                      padding: "10px 16px",
                      cursor: "pointer",
                      "font-size": "13px",
                      "font-weight": "600",
                    }}
                  >
                    Login with Kilo Code
                  </button>
                </>
              }
            >
              <DeviceAuthCard
                status={props.deviceAuth.status}
                code={props.deviceAuth.code}
                verificationUrl={props.deviceAuth.verificationUrl}
                expiresIn={props.deviceAuth.expiresIn}
                error={props.deviceAuth.error}
                onCancel={handleCancelLogin}
                onRetry={handleLogin}
              />
            </Show>
          </div>
        }
      >
        {(data) => (
          <div style={{ display: "flex", "flex-direction": "column", gap: "12px" }}>
            {/* User header */}
            <div
              style={{
                background: "var(--vscode-editor-background)",
                border: "1px solid var(--vscode-panel-border)",
                "border-radius": "4px",
                padding: "16px",
              }}
            >
              <p
                style={{
                  "font-size": "14px",
                  "font-weight": "600",
                  color: "var(--vscode-foreground)",
                  margin: "0 0 4px 0",
                }}
              >
                {data().profile.name || data().profile.email}
              </p>
              <p
                style={{
                  "font-size": "12px",
                  color: "var(--vscode-descriptionForeground)",
                  margin: 0,
                }}
              >
                {data().profile.email}
              </p>
            </div>

            {/* Balance */}
            <Show when={data().balance}>
              {(balance) => (
                <div
                  style={{
                    background: "var(--vscode-editor-background)",
                    border: "1px solid var(--vscode-panel-border)",
                    "border-radius": "4px",
                    padding: "12px 16px",
                    display: "flex",
                    "align-items": "center",
                    "justify-content": "space-between",
                  }}
                >
                  <div>
                    <p
                      style={{
                        "font-size": "11px",
                        "text-transform": "uppercase",
                        "letter-spacing": "0.5px",
                        color: "var(--vscode-descriptionForeground)",
                        margin: "0 0 4px 0",
                      }}
                    >
                      Balance
                    </p>
                    <p
                      style={{
                        "font-size": "18px",
                        "font-weight": "600",
                        color: "var(--vscode-foreground)",
                        margin: 0,
                      }}
                    >
                      {formatBalance(balance().balance)}
                    </p>
                  </div>
                  <button
                    onClick={handleRefresh}
                    style={{
                      background: "none",
                      border: "1px solid var(--vscode-button-secondaryBackground, var(--vscode-panel-border))",
                      "border-radius": "4px",
                      color: "var(--vscode-foreground)",
                      cursor: "pointer",
                      padding: "4px 8px",
                      "font-size": "12px",
                    }}
                  >
                    ↻ Refresh
                  </button>
                </div>
              )}
            </Show>

            {/* Action buttons */}
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={handleDashboard}
                style={{
                  flex: "1",
                  background: "var(--vscode-button-secondaryBackground)",
                  color: "var(--vscode-button-secondaryForeground)",
                  border: "none",
                  "border-radius": "4px",
                  padding: "8px 12px",
                  cursor: "pointer",
                  "font-size": "13px",
                }}
              >
                Dashboard
              </button>
              <button
                onClick={handleLogout}
                style={{
                  flex: "1",
                  background: "none",
                  color: "var(--vscode-errorForeground)",
                  border: "1px solid var(--vscode-panel-border)",
                  "border-radius": "4px",
                  padding: "8px 12px",
                  cursor: "pointer",
                  "font-size": "13px",
                }}
              >
                Log Out
              </button>
            </div>
          </div>
        )}
      </Show>
    </div>
  )
}

export default ProfileView
