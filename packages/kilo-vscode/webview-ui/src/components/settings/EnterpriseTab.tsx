import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { Component, Show, createSignal, onCleanup, onMount } from "solid-js"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import type { EnterpriseLicenseStatusMessage, ExtensionMessage } from "../../types/messages"
import SettingsRow from "./SettingsRow"

const EnterpriseTab: Component = () => {
  const language = useLanguage()
  const vscode = useVSCode()
  const [status, setStatus] = createSignal<EnterpriseLicenseStatusMessage | null>(null)

  const handler = (msg: ExtensionMessage) => {
    if (msg.type === "enterpriseLicenseStatus") setStatus(msg)
  }

  const refresh = () => vscode.postMessage({ type: "requestEnterpriseLicense" })

  onMount(() => {
    const unsub = vscode.onMessage(handler)
    refresh()
    onCleanup(unsub)
  })

  const licenseLabel = () => {
    const s = status()
    if (!s?.licenseEnabled) return language.t("settings.enterprise.license.disabled")
    if (s.licenseOk) return language.t("settings.enterprise.license.valid")
    return language.t("settings.enterprise.license.invalid")
  }

  return (
    <div>
      <Card>
        <SettingsRow
          title={language.t("settings.enterprise.license.title")}
          description={language.t("settings.enterprise.license.description")}
        >
          <div data-component="enterprise-license-status">
            <span data-slot="enterprise-license-status" data-ok={status()?.licenseOk ?? false}>
              {licenseLabel()}
            </span>
            <Show when={status()?.licenseReason}>
              {(reason) => <div data-slot="enterprise-license-reason">{reason()}</div>}
            </Show>
            <Button size="small" variant="secondary" onClick={refresh}>
              {language.t("settings.enterprise.refresh")}
            </Button>
            <Button
              size="small"
              variant="ghost"
              onClick={() => vscode.postMessage({ type: "openVSCodeSettings", query: "kilo-code.new.enterprise" })}
            >
              {language.t("settings.enterprise.openSettings")}
            </Button>
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.enterprise.engine.title")}
          description={language.t("settings.enterprise.engine.description")}
        >
          <div data-slot="enterprise-engine-info">
            <div>
              {language.t("settings.enterprise.engine.remote")}:{" "}
              {status()?.remoteEnabled
                ? language.t("settings.enterprise.engine.enabled")
                : language.t("settings.enterprise.engine.local")}
            </div>
            <Show when={status()?.engineUrl}>
              {(url) => <code data-slot="enterprise-engine-url">{url()}</code>}
            </Show>
            <Show when={status()?.gatewayUrl}>
              {(url) => (
                <div>
                  {language.t("settings.enterprise.engine.gateway")}: <code>{url()}</code>
                </div>
              )}
            </Show>
          </div>
        </SettingsRow>

        <SettingsRow title={language.t("settings.enterprise.about.title")} description="" last>
          <Button
            size="small"
            variant="secondary"
            onClick={() => vscode.postMessage({ type: "enterpriseShowAbout" })}
          >
            {language.t("settings.enterprise.about.action")}
          </Button>
        </SettingsRow>
      </Card>
    </div>
  )
}

export default EnterpriseTab
