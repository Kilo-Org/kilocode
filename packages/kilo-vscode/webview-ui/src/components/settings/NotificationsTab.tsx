// Notifications tab, ported from v1 (NotificationsTab.tsx on main). The four rows are `kilo-code.v2.attention.*` editor
// settings the extension host reads when a session finishes, fails or needs input; every one is off by default.
import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { Select } from "@kilocode/kilo-ui/select"
import { createSignal, onCleanup, Show, type Component } from "solid-js"
import type { ToHost, ToWebview } from "../../../../src/protocol"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import { useSettingsConfig, type KiloSettingKey } from "../../v2/settings-config"
import { osNotificationsAvailable, SOUND_OPTIONS, soundChoice } from "./notifications"
import SettingsRow from "./SettingsRow"
import Switch from "./Switch"

const NotificationsTab: Component = () => {
  const vscode = useVSCode()
  const language = useLanguage()
  const config = useSettingsConfig()
  const post = (message: ToHost) => vscode.postMessage(message as never)
  const [test, setTest] = createSignal<{ state: "idle" | "testing" | "success" | "error"; error?: string }>({
    state: "idle",
  })

  const enabled = (key: KiloSettingKey) => config.setting(key) === true
  const sound = () => soundChoice(config.setting("attention.sound"))

  onCleanup(
    vscode.onMessage((raw) => {
      const message = raw as unknown as ToWebview
      if (message.type !== "attentionTestOSResult") return
      setTest({ state: message.ok ? "success" : "error", error: message.error })
    }),
  )

  const status = () => {
    const current = test()
    if (current.state === "testing") return language.t("settings.notifications.testOS.testing")
    if (current.state === "success") return language.t("settings.notifications.testOS.success")
    const label = language.t("settings.notifications.testOS.error")
    return current.error ? `${label}: ${current.error}` : label
  }

  return (
    <Card>
      <SettingsRow
        title={language.t("settings.notifications.enable.title")}
        description={language.t("settings.notifications.enable.description")}
      >
        <Switch
          checked={enabled("attention.enabled")}
          onChange={(checked) => config.setSetting("attention.enabled", checked)}
          hideLabel
        >
          {language.t("settings.notifications.enable.title")}
        </Switch>
      </SettingsRow>
      <Show when={enabled("attention.enabled")}>
        <SettingsRow
          title={language.t("settings.notifications.sounds")}
          description={language.t("settings.notifications.sound.description")}
        >
          <div style={{ display: "flex", gap: "8px", "align-items": "center", "flex-wrap": "wrap" }}>
            <Select
              options={SOUND_OPTIONS}
              current={SOUND_OPTIONS.find((option) => option.value === sound())}
              value={(option) => option.value}
              label={(option) => language.t(option.labelKey)}
              onSelect={(option) => {
                if (!option || option.value === sound()) return
                config.setSetting("attention.sound", option.value)
              }}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
            <Button variant="ghost" size="small" onClick={() => post({ type: "attentionTestSound", sound: sound() })}>
              {language.t("settings.notifications.testSound")}
            </Button>
          </div>
        </SettingsRow>
      </Show>
      <Show when={osNotificationsAvailable()}>
        <SettingsRow
          title={language.t("settings.notifications.os.title")}
          description={language.t("settings.notifications.os.description")}
        >
          <div style={{ display: "flex", "flex-direction": "column", gap: "8px", "align-items": "flex-end" }}>
            <Switch
              checked={enabled("attention.OSNotifications")}
              onChange={(checked) => {
                if (!checked) setTest({ state: "idle" })
                config.setSetting("attention.OSNotifications", checked)
              }}
              hideLabel
            >
              {language.t("settings.notifications.os.title")}
            </Switch>
            <Show when={enabled("attention.OSNotifications")}>
              <Button
                variant="ghost"
                size="small"
                onClick={() => {
                  setTest({ state: "testing" })
                  post({ type: "attentionTestOS" })
                }}
              >
                {language.t("settings.notifications.testOS")}
              </Button>
              <Show when={test().state !== "idle"}>
                <div
                  data-slot="notifications-test-status"
                  style={{
                    "font-size": "var(--kilo-font-size-12)",
                    color:
                      test().state === "error"
                        ? "var(--vscode-errorForeground)"
                        : test().state === "success"
                          ? "var(--vscode-testing-iconPassed)"
                          : undefined,
                  }}
                >
                  {status()}
                </div>
              </Show>
            </Show>
          </div>
        </SettingsRow>
      </Show>
      <SettingsRow
        title={language.t("settings.notifications.workbench.title")}
        description={language.t("settings.notifications.workbench.description")}
        last
      >
        <Switch
          checked={enabled("attention.notifications")}
          onChange={(checked) => config.setSetting("attention.notifications", checked)}
          hideLabel
        >
          {language.t("settings.notifications.workbench.title")}
        </Switch>
      </SettingsRow>
    </Card>
  )
}

export default NotificationsTab
