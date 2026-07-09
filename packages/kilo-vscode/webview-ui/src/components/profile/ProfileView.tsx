import { Component, Show, createSignal, createMemo, createEffect, onMount } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Select } from "@kilocode/kilo-ui/select"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useVSCode } from "../../context/vscode"
import { useLanguage } from "../../context/language"
import DeviceAuthCard from "./DeviceAuthCard"
import type { ProfileData, ProviderUsageData, DeviceAuthState } from "../../types/messages"
import { ProviderUsageCards } from "./ProviderUsageCards"

export type { ProfileData }

export interface ProfileViewProps {
  profileData: ProfileData | null | undefined
  deviceAuth: DeviceAuthState
  providerUsage?: ProviderUsageData
  providerUsageLoading?: boolean
  providerUsageError?: string
  onLogin: () => void
  onRequestProviderUsage?: () => void
  onRefreshProviderUsage?: () => void
}

const formatBalance = (amount: number): string => {
  return `$${amount.toFixed(2)}`
}

const PERSONAL = "personal"

interface OrgOption {
  value: string
  label: string
  description?: string
}

const ProfileView: Component<ProfileViewProps> = (props) => {
  const vscode = useVSCode()
  const language = useLanguage()
  const [target, setTarget] = createSignal<string | null>(null)

  const personal = createMemo(() => props.profileData?.profile.hasPersonalAccount !== false)

  // Always fetch fresh profile+balance when navigating to this view
  onMount(() => {
    vscode.postMessage({ type: "refreshProfile" })
    props.onRequestProviderUsage?.()
  })

  // Reset pending target whenever profileData changes (success or failure both send a fresh profile)
  createEffect(() => {
    props.profileData // track
    setTarget(null)
  })

  const orgOptions = createMemo<OrgOption[]>(() => {
    const orgs = props.profileData?.profile.organizations ?? []
    if (orgs.length === 0) return []
    return [
      ...(personal() ? [{ value: PERSONAL, label: language.t("profile.personalAccount") }] : []),
      ...orgs.map((org) => ({ value: org.id, label: org.name, description: org.role })),
    ]
  })

  const currentId = createMemo(() => {
    return props.profileData?.currentOrgId ?? (personal() ? PERSONAL : orgOptions()[0]?.value)
  })

  const switching = createMemo(() => {
    const t = target()
    if (t === null) return false
    return currentId() !== t
  })

  const currentOrg = createMemo(() => {
    return orgOptions().find((o) => o.value === currentId())
  })

  const selectOrg = (option: OrgOption | undefined) => {
    if (!option) return
    if (option.value === currentId()) return
    setTarget(option.value)
    vscode.postMessage({
      type: "setOrganization",
      organizationId: option.value === PERSONAL ? null : option.value,
    })
  }

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

  const openExternal = (url: string) => {
    vscode.postMessage({ type: "openExternal", url })
  }

  const handleTopUp = () => {
    vscode.postMessage({ type: "openExternal", url: "https://app.kilo.ai/credits" })
  }

  const handleGetPass = () => {
    vscode.postMessage({ type: "openExternal", url: "https://kilo.ai/pricing/kilo-pass" })
  }

  const handleCancelLogin = () => {
    vscode.postMessage({ type: "cancelLogin" })
  }

  const usage = () => (
    <ProviderUsageCards
      data={props.providerUsage}
      loading={props.providerUsageLoading ?? !props.providerUsage}
      error={props.providerUsageError}
      onRefresh={() => props.onRefreshProviderUsage?.()}
      onOpen={openExternal}
      kiloPass={props.profileData?.kiloPass}
      showKiloPass={
        !!props.profileData &&
        (props.profileData.currentOrgId ?? null) === null &&
        props.profileData.profile.hasPersonalAccount !== false
      }
      onGetKiloPass={handleGetPass}
    />
  )

  return (
    <div style={{ display: "flex", "flex-direction": "column", height: "100%", "min-height": 0, overflow: "hidden" }}>
      <div
        style={{
          padding: "12px 16px",
          "border-bottom": "1px solid var(--border-weak-base)",
          display: "flex",
          "align-items": "center",
          gap: "8px",
        }}
      >
        <h2 style={{ "font-size": "var(--kilo-font-size-16)", "font-weight": "600", margin: 0 }}>
          {language.t("profile.title")}
        </h2>
      </div>
      <div
        data-profile-scroll
        style={{
          flex: 1,
          "min-height": 0,
          "overflow-y": "auto",
          "overflow-x": "hidden",
          padding: "16px",
          "max-width": "480px",
          margin: "0 auto",
          width: "100%",
          "box-sizing": "border-box",
        }}
      >
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
                        "font-size": "var(--kilo-font-size-13)",
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
                    "font-size": "var(--kilo-font-size-14)",
                    "font-weight": "600",
                    color: "var(--vscode-foreground)",
                    margin: "0 0 4px 0",
                  }}
                >
                  {data().profile.name || data().profile.email}
                </p>
                <p
                  style={{
                    "font-size": "var(--kilo-font-size-12)",
                    color: "var(--vscode-descriptionForeground)",
                    margin: 0,
                  }}
                >
                  {data().profile.email}
                </p>
              </Card>

              {/* Organization selector */}
              <Show when={orgOptions().length > 0}>
                <Card>
                  <p
                    style={{
                      "font-size": "var(--kilo-font-size-11)",
                      "text-transform": "uppercase",
                      "letter-spacing": "0.5px",
                      color: "var(--vscode-descriptionForeground)",
                      margin: "0 0 8px 0",
                    }}
                  >
                    Account
                  </p>
                  <Select
                    options={orgOptions()}
                    current={currentOrg()}
                    value={(o) => o.value}
                    label={(o) => o.label}
                    onSelect={selectOrg}
                    variant="secondary"
                    size="small"
                    triggerVariant="settings"
                    disabled={switching()}
                  />
                </Card>
              </Show>

              {usage()}

              {/* Balance */}
              <Show when={data().balance}>
                {(balance) => (
                  <Card style={{ display: "flex", "flex-direction": "column", gap: "12px" }}>
                    <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between" }}>
                      <div>
                        <p
                          style={{
                            "font-size": "var(--kilo-font-size-11)",
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
                            "font-size": "var(--kilo-font-size-18)",
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
                    </div>
                  </Card>
                )}
              </Show>

              {/* Action buttons */}
              <div style={{ display: "flex", gap: "8px" }}>
                <Button variant="secondary" onClick={handleDashboard} style={{ flex: "1" }}>
                  {language.t("profile.action.dashboard")}
                </Button>
                <Button variant="secondary" onClick={handleTopUp} style={{ flex: "1" }}>
                  {language.t("profile.action.topUp")}
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

        <Show when={!props.profileData}>{usage()}</Show>
      </div>
    </div>
  )
}

export default ProfileView
