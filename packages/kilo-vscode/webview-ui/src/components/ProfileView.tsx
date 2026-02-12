import { Component, Show } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useVSCode } from "../context/vscode"
import { useLanguage } from "../context/language"
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
  const language = useLanguage()

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
        {language.t("profile.title")}
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
                    {language.t("profile.notLoggedIn")}
                  </p>
                  <Button variant="primary" onClick={handleLogin}>
                    {language.t("profile.action.login")}
                  </Button>
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
            <Card>
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
            </Card>

            {/* Balance */}
            <Show when={data().balance}>
              {(balance) => (
                <Card
                  style={{
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
                      {language.t("profile.balance.title")}
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
                  <Tooltip value={language.t("profile.balance.refresh")} placement="left">
                    <Button variant="ghost" size="small" onClick={handleRefresh}>
                      ↻ {language.t("common.refresh")}
                    </Button>
                  </Tooltip>
                </Card>
              )}
            </Show>

            {/* Action buttons */}
            <div style={{ display: "flex", gap: "8px" }}>
              <Button variant="secondary" onClick={handleDashboard} style={{ flex: "1" }}>
                {language.t("profile.action.dashboard")}
              </Button>
              <Button
                variant="ghost"
                onClick={handleLogout}
                style={{ flex: "1", color: "var(--vscode-errorForeground)" }}
              >
                {language.t("profile.action.logout")}
              </Button>
            </div>
          </div>
        )}
      </Show>
    </div>
  )
}

export default ProfileView
