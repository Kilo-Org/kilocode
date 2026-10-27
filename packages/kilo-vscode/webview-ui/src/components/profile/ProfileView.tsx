// Main's ProfileView. Only the data calls changed: the v1 webview messages are the v2 account binding
// (v2/profile.ts) and the relay's `open`.
import { Component, Show, createSignal, createMemo, createEffect, onMount } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { Select } from "@kilocode/kilo-ui/select"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useLanguage } from "../../context/language"
import { useV2 } from "../../v2/client"
import type { Profile } from "../../v2/profile"
import DeviceAuthCard from "./DeviceAuthCard"
import { ProviderUsageCards } from "./ProviderUsageCards"

export interface ProfileViewProps {
  profile: Profile
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
  const v2 = useV2()
  const language = useLanguage()
  const [target, setTarget] = createSignal<string | null>(null)
  const profileData = () => props.profile.data()

  const personal = createMemo(() => profileData()?.profile.hasPersonalAccount !== false)

  // Load current profile and usage when navigating to this view.
  onMount(() => {
    props.profile.refresh()
    props.profile.requestUsage()
  })

  // Reset pending target whenever profileData changes (success or failure both load a fresh profile)
  createEffect(() => {
    profileData() // track
    setTarget(null)
  })

  const orgOptions = createMemo<OrgOption[]>(() => {
    const orgs = profileData()?.profile.organizations ?? []
    if (orgs.length === 0) return []
    return [
      ...(personal() ? [{ value: PERSONAL, label: language.t("profile.personalAccount") }] : []),
      ...orgs.map((org) => ({ value: org.id, label: org.name, description: org.role })),
    ]
  })

  const currentId = createMemo(() => {
    return profileData()?.profile.organizationID ?? (personal() ? PERSONAL : orgOptions()[0]?.value)
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
    props.profile.setOrganization(option.value === PERSONAL ? null : option.value)
  }

  const handleLogin = () => {
    props.profile.login()
  }

  const handleLogout = () => {
    props.profile.logout()
  }

  const handleRefresh = () => {
    props.profile.refresh()
  }

  const handleDashboard = () => {
    v2.open("https://app.kilo.ai/profile")
  }

  const openExternal = (url: string) => {
    v2.open(url)
  }

  const handleTopUp = () => {
    v2.open("https://app.kilo.ai/credits")
  }

  const handleGetPass = () => {
    v2.open("https://kilo.ai/pricing/kilo-pass")
  }

  const handleCancelLogin = () => {
    props.profile.cancel()
  }

  const usage = () => (
    <ProviderUsageCards
      data={props.profile.usage()}
      loading={props.profile.usageLoading()}
      error={props.profile.usageError()}
      onRefresh={() => props.profile.refreshUsage()}
      onOpen={openExternal}
      kiloPass={profileData()?.kiloPass}
      showKiloPass={
        !!profileData() &&
        (profileData()?.profile.organizationID ?? null) === null &&
        profileData()?.profile.hasPersonalAccount !== false
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
          when={profileData()}
          fallback={
            <div style={{ display: "flex", "flex-direction": "column", gap: "12px" }}>
              <Show
                when={props.profile.auth().status !== "idle"}
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
                  status={props.profile.auth().status}
                  code={props.profile.auth().code}
                  verificationUrl={props.profile.auth().verificationUrl}
                  expiresIn={props.profile.auth().expiresIn}
                  error={props.profile.auth().error}
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

              {/* Balance */}
              <Show when={typeof data().balance?.balance === "number" && { amount: data().balance?.balance ?? 0 }}>
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
                          {formatBalance(balance().amount)}
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

              {usage()}
            </div>
          )}
        </Show>

        <Show when={!profileData()}>{usage()}</Show>
      </div>
    </div>
  )
}

export default ProfileView
