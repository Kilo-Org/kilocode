import { Component, createSignal, onCleanup, Show } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Switch } from "@kilocode/kilo-ui/switch"
import { Select } from "@kilocode/kilo-ui/select"
import { Card } from "@kilocode/kilo-ui/card"
import { useVSCode } from "../../context/vscode"
import { useLanguage } from "../../context/language"
import type { ExtensionMessage } from "../../types/messages"
import SettingsRow from "./SettingsRow"

interface SoundOption {
  value: string
  labelKey: string
}

const groups = [
  { value: "alert", key: "alert", count: 10 },
  { value: "bip-bop", key: "bipbop", count: 10 },
  { value: "staplebops", key: "staplebops", count: 7 },
  { value: "nope", key: "nope", count: 12 },
  { value: "yup", key: "yup", count: 6 },
]

const SOUND_OPTIONS: SoundOption[] = [
  { value: "default", labelKey: "settings.notifications.sound.default" },
  { value: "system", labelKey: "settings.notifications.sound.system" },
  ...groups.flatMap((group) =>
    Array.from({ length: group.count }, (_, index) => {
      const suffix = String(index + 1).padStart(2, "0")
      return {
        value: `${group.value}-${suffix}`,
        labelKey: `sound.option.${group.key}${suffix}`,
      }
    }),
  ),
]

const NotificationsTab: Component = () => {
  const vscode = useVSCode()
  const language = useLanguage()
  const [enabled, setEnabled] = createSignal(false)
  const [notifications, setNotifications] = createSignal(false)
  const [os, setOs] = createSignal(false)
  const [available, setAvailable] = createSignal(false)
  const [sound, setSound] = createSignal("default")
  const [testState, setTestState] = createSignal<"idle" | "testing" | "success" | "error">("idle")
  const [testError, setTestError] = createSignal<string>()

  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type === "notificationSettingsLoaded") {
      setEnabled(message.settings.attentionEnabled)
      setNotifications(message.settings.attentionNotifications)
      setOs(message.settings.attentionOSNotifications)
      setAvailable(message.settings.osNotificationsAvailable)
      setSound(
        SOUND_OPTIONS.some((option) => option.value === message.settings.attentionSound)
          ? message.settings.attentionSound
          : "default",
      )
      return
    }
    if (message.type === "osNotificationTestResult") {
      setTestState(message.ok ? "success" : "error")
      setTestError(message.error)
    }
  })

  onCleanup(unsubscribe)
  vscode.postMessage({ type: "requestNotificationSettings" })

  return (
    <Card>
      <SettingsRow
        title={language.t("settings.notifications.enable.title")}
        description={language.t("settings.notifications.enable.description")}
      >
        <Switch
          checked={enabled()}
          onChange={(checked) => {
            setEnabled(checked)
            vscode.postMessage({ type: "updateSetting", key: "attention.enabled", value: checked })
          }}
          hideLabel
        >
          {language.t("settings.notifications.enable.title")}
        </Switch>
      </SettingsRow>
      <Show when={enabled()}>
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
                if (!option) return
                setSound(option.value)
                vscode.postMessage({ type: "updateSetting", key: "attention.sound", value: option.value })
              }}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
            <Button
              variant="ghost"
              size="small"
              onClick={() => vscode.postMessage({ type: "testNotification", sound: sound() })}
            >
              {language.t("settings.notifications.testSound")}
            </Button>
          </div>
        </SettingsRow>
      </Show>
      <Show when={available()}>
        <SettingsRow
          title={language.t("settings.notifications.os.title")}
          description={language.t("settings.notifications.os.description")}
        >
          <div style={{ display: "flex", "flex-direction": "column", gap: "8px", "align-items": "flex-end" }}>
            <Switch
              checked={os()}
              onChange={(checked) => {
                setOs(checked)
                if (!checked) {
                  setTestState("idle")
                  setTestError(undefined)
                }
                vscode.postMessage({ type: "updateSetting", key: "attention.OSNotifications", value: checked })
              }}
              hideLabel
            >
              {language.t("settings.notifications.os.title")}
            </Switch>
            <Show when={os()}>
              <Button
                variant="ghost"
                size="small"
                onClick={() => {
                  setTestState("testing")
                  setTestError(undefined)
                  vscode.postMessage({ type: "testOSNotification" })
                }}
              >
                {language.t("settings.notifications.testOS")}
              </Button>
              <Show when={testState() !== "idle"}>
                <div
                  style={{
                    "font-size": "var(--kilo-font-size-12)",
                    color:
                      testState() === "error"
                        ? "var(--vscode-errorForeground)"
                        : testState() === "success"
                          ? "var(--vscode-testing-iconPassed, #89d185)"
                          : undefined,
                  }}
                >
                  {testState() === "testing"
                    ? language.t("settings.notifications.testOS.testing")
                    : testState() === "success"
                      ? language.t("settings.notifications.testOS.success")
                      : `${language.t("settings.notifications.testOS.error")}${testError() ? `: ${testError()}` : ""}`}
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
          checked={notifications()}
          onChange={(checked) => {
            setNotifications(checked)
            vscode.postMessage({ type: "updateSetting", key: "attention.notifications", value: checked })
          }}
          hideLabel
        >
          {language.t("settings.notifications.workbench.title")}
        </Switch>
      </SettingsRow>
    </Card>
  )
}

export default NotificationsTab
