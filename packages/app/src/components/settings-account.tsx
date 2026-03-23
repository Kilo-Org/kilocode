import { type Component, Show, createMemo, createResource } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Card } from "@opencode-ai/ui/card"
import { Icon } from "@opencode-ai/ui/icon"
import { Select } from "@opencode-ai/ui/select"
import { Spinner } from "@opencode-ai/ui/spinner"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { showToast } from "@opencode-ai/ui/toast"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { usePlatform } from "@/context/platform"

type OrgOption = {
  value: string
  label: string
  description?: string
}

const PERSONAL = "personal"

const formatBalance = (amount: number): string => {
  return `$${amount.toFixed(2)}`
}

export const SettingsAccount: Component = () => {
  const globalSDK = useGlobalSDK()
  const platform = usePlatform()
  const language = useLanguage()

  const [profile, { refetch: refetchProfile }] = createResource(async () => {
    try {
      const result = await globalSDK.client.kilo.profile()
      if (result.error) {
        const status = (result.error as { data?: { status?: number } })?.data?.status
        if (status === 401) return null
        throw result.error
      }
      return result.data
    } catch (err) {
      const status = (err as { data?: { status?: number } })?.data?.status
      if (status === 401) return null
      throw err
    }
  })

  const orgOptions = createMemo<OrgOption[]>(() => {
    const orgs = profile()?.profile.organizations ?? []
    if (orgs.length === 0) return []
    return [
      { value: PERSONAL, label: language.t("profile.personalAccount") },
      ...orgs.map((org) => ({ value: org.id, label: org.name, description: org.role })),
    ]
  })

  const currentOrg = createMemo(() => {
    const id = profile()?.currentOrgId ?? PERSONAL
    return orgOptions().find((o) => o.value === id)
  })

  const switchOrg = async (option: OrgOption | undefined) => {
    if (!option) return
    const current = profile()?.currentOrgId ?? PERSONAL
    if (option.value === current) return
    try {
      await globalSDK.client.kilo.organization.set({
        organizationId: option.value === PERSONAL ? null : option.value,
      })
      await refetchProfile()
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
      })
    }
  }

  const handleLogin = async () => {
    try {
      const result = await globalSDK.client.provider.oauth.authorize(
        { providerID: "kilo", method: 0 },
        { throwOnError: true },
      )
      const auth = result.data
      if (!auth?.url) return
      platform.openLink(auth.url)
      const callbackResult = await globalSDK.client.provider.oauth
        .callback({ providerID: "kilo", method: 0 })
        .then((value) => (value.error ? { ok: false as const, error: value.error } : { ok: true as const }))
        .catch((error) => ({ ok: false as const, error }))
      if (!callbackResult.ok) {
        showToast({ variant: "error", title: language.t("common.requestFailed") })
        return
      }
      await globalSDK.client.global.dispose()
      await refetchProfile()
    } catch (err) {
      showToast({ variant: "error", title: language.t("common.requestFailed") })
    }
  }

  const handleLogout = async () => {
    try {
      await globalSDK.client.auth.remove({ providerID: "kilo" }, { throwOnError: true })
      await refetchProfile()
    } catch (err) {
      showToast({ variant: "error", title: language.t("common.requestFailed") })
    }
  }

  const handleRefresh = () => refetchProfile()

  const handleDashboard = () => {
    platform.openLink("https://app.kilo.ai/profile")
  }

  return (
    <div class="flex flex-col gap-6">
      <Show
        when={!profile.loading}
        fallback={
          <div class="flex items-center justify-center p-8">
            <Spinner />
          </div>
        }
      >
        <Show
          when={profile()}
          fallback={
            <div class="flex flex-col gap-4">
              <p class="text-14-regular text-text-base">{language.t("profile.notLoggedIn")}</p>
              <Button variant="primary" onClick={handleLogin}>
                {language.t("profile.action.login")}
              </Button>
            </div>
          }
        >
          {(data) => (
            <div class="flex flex-col gap-4">
              <Card>
                <div class="flex flex-col gap-1">
                  <p class="text-14-medium text-text-strong">{data().profile.name || data().profile.email}</p>
                  <p class="text-12-regular text-text-base">{data().profile.email}</p>
                </div>
              </Card>

              <Show when={orgOptions().length > 0}>
                <Card>
                  <div class="flex flex-col gap-3">
                    <p class="text-11-uppercase tracking-wide text-text-base">Account</p>
                    <Select
                      options={orgOptions()}
                      current={currentOrg()}
                      value={(o) => o.value}
                      label={(o) => o.label}
                      onSelect={switchOrg}
                      variant="secondary"
                      size="small"
                      triggerVariant="settings"
                    />
                  </div>
                </Card>
              </Show>

              <Show when={data().balance}>
                {(balance) => (
                  <Card class="flex items-center justify-between">
                    <div class="flex flex-col gap-1">
                      <p class="text-11-uppercase tracking-wide text-text-base">
                        {language.t("profile.balance.title")}
                      </p>
                      <p class="text-18-semibold text-text-strong">{formatBalance(balance().balance)}</p>
                    </div>
                    <Tooltip value={language.t("profile.balance.refresh")} placement="left">
                      <Button variant="ghost" size="small" onClick={handleRefresh}>
                        ↻ {language.t("common.refresh")}
                      </Button>
                    </Tooltip>
                  </Card>
                )}
              </Show>

              <div class="flex gap-3">
                <Button variant="secondary" onClick={handleDashboard} style={{ flex: "1" }}>
                  {language.t("profile.action.dashboard")}
                </Button>
                <Button
                  variant="ghost"
                  onClick={handleLogout}
                  style={{ flex: "1", color: "var(--icon-critical-base)" }}
                >
                  {language.t("profile.action.logout")}
                </Button>
              </div>
            </div>
          )}
        </Show>
      </Show>
    </div>
  )
}
