import { Component, createSignal, onCleanup } from "solid-js"
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
  const [sound, setSound] = createSignal("default")

  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "notificationSettingsLoaded") return
    setEnabled(message.settings.attentionEnabled)
    setSound(
      SOUND_OPTIONS.some((option) => option.value === message.settings.attentionSound)
        ? message.settings.attentionSound
        : "default",
    )
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
      <SettingsRow
        title={language.t("settings.notifications.sounds")}
        description={language.t("settings.notifications.sound.description")}
        last
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
            disabled={!enabled()}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
          <Button
            variant="ghost"
            size="small"
            disabled={!enabled()}
            onClick={() => vscode.postMessage({ type: "testNotification", sound: sound() })}
          >
            {language.t("settings.notifications.testSound")}
          </Button>
        </div>
      </SettingsRow>
    </Card>
  )
}

export default NotificationsTab
