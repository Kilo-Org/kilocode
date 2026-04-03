import { Component, createSignal, onCleanup } from "solid-js"
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

const SOUND_OPTIONS: SoundOption[] = [
  { value: "default", labelKey: "settings.notifications.sound.default" },
  { value: "none", labelKey: "settings.notifications.sound.none" },
  { value: "alert-01", labelKey: "sound.option.alert01" },
  { value: "alert-02", labelKey: "sound.option.alert02" },
  { value: "alert-03", labelKey: "sound.option.alert03" },
  { value: "alert-04", labelKey: "sound.option.alert04" },
  { value: "alert-05", labelKey: "sound.option.alert05" },
  { value: "alert-06", labelKey: "sound.option.alert06" },
  { value: "alert-07", labelKey: "sound.option.alert07" },
  { value: "alert-08", labelKey: "sound.option.alert08" },
  { value: "alert-09", labelKey: "sound.option.alert09" },
  { value: "alert-10", labelKey: "sound.option.alert10" },
  { value: "bip-bop-01", labelKey: "sound.option.bipbop01" },
  { value: "bip-bop-02", labelKey: "sound.option.bipbop02" },
  { value: "bip-bop-03", labelKey: "sound.option.bipbop03" },
  { value: "bip-bop-04", labelKey: "sound.option.bipbop04" },
  { value: "bip-bop-05", labelKey: "sound.option.bipbop05" },
  { value: "bip-bop-06", labelKey: "sound.option.bipbop06" },
  { value: "bip-bop-07", labelKey: "sound.option.bipbop07" },
  { value: "bip-bop-08", labelKey: "sound.option.bipbop08" },
  { value: "bip-bop-09", labelKey: "sound.option.bipbop09" },
  { value: "bip-bop-10", labelKey: "sound.option.bipbop10" },
  { value: "staplebops-01", labelKey: "sound.option.staplebops01" },
  { value: "staplebops-02", labelKey: "sound.option.staplebops02" },
  { value: "staplebops-03", labelKey: "sound.option.staplebops03" },
  { value: "staplebops-04", labelKey: "sound.option.staplebops04" },
  { value: "staplebops-05", labelKey: "sound.option.staplebops05" },
  { value: "staplebops-06", labelKey: "sound.option.staplebops06" },
  { value: "staplebops-07", labelKey: "sound.option.staplebops07" },
  { value: "nope-01", labelKey: "sound.option.nope01" },
  { value: "nope-02", labelKey: "sound.option.nope02" },
  { value: "nope-03", labelKey: "sound.option.nope03" },
  { value: "nope-04", labelKey: "sound.option.nope04" },
  { value: "nope-05", labelKey: "sound.option.nope05" },
  { value: "nope-06", labelKey: "sound.option.nope06" },
  { value: "nope-07", labelKey: "sound.option.nope07" },
  { value: "nope-08", labelKey: "sound.option.nope08" },
  { value: "nope-09", labelKey: "sound.option.nope09" },
  { value: "nope-10", labelKey: "sound.option.nope10" },
  { value: "nope-11", labelKey: "sound.option.nope11" },
  { value: "nope-12", labelKey: "sound.option.nope12" },
  { value: "yup-01", labelKey: "sound.option.yup01" },
  { value: "yup-02", labelKey: "sound.option.yup02" },
  { value: "yup-03", labelKey: "sound.option.yup03" },
  { value: "yup-04", labelKey: "sound.option.yup04" },
  { value: "yup-05", labelKey: "sound.option.yup05" },
  { value: "yup-06", labelKey: "sound.option.yup06" },
]

const NotificationsTab: Component = () => {
  const vscode = useVSCode()
  const language = useLanguage()

  const [agentNotify, setAgentNotify] = createSignal(true)
  const [permNotify, setPermNotify] = createSignal(true)
  const [errorNotify, setErrorNotify] = createSignal(true)
  const [agentSound, setAgentSound] = createSignal("default")
  const [permSound, setPermSound] = createSignal("default")
  const [errorSound, setErrorSound] = createSignal("default")

  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "notificationSettingsLoaded") {
      return
    }
    const s = message.settings
    setAgentNotify(s.notifyAgent)
    setPermNotify(s.notifyPermissions)
    setErrorNotify(s.notifyErrors)
    setAgentSound(s.soundAgent)
    setPermSound(s.soundPermissions)
    setErrorSound(s.soundErrors)
  })

  onCleanup(unsubscribe)
  vscode.postMessage({ type: "requestNotificationSettings" })

  const save = (key: string, value: unknown) => {
    vscode.postMessage({ type: "updateSetting", key, value })
  }

  return (
    <div>
      <Card>
        <SettingsRow
          title={language.t("settings.notifications.agent.title")}
          description={language.t("settings.notifications.agent.description")}
        >
          <Switch
            checked={agentNotify()}
            onChange={(checked) => {
              setAgentNotify(checked)
              save("notifications.agent", checked)
            }}
            hideLabel
          >
            {language.t("settings.notifications.agent.title")}
          </Switch>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.notifications.permissions.title")}
          description={language.t("settings.notifications.permissions.description")}
        >
          <Switch
            checked={permNotify()}
            onChange={(checked) => {
              setPermNotify(checked)
              save("notifications.permissions", checked)
            }}
            hideLabel
          >
            {language.t("settings.notifications.permissions.title")}
          </Switch>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.notifications.errors.title")}
          description={language.t("settings.notifications.errors.description")}
          last
        >
          <Switch
            checked={errorNotify()}
            onChange={(checked) => {
              setErrorNotify(checked)
              save("notifications.errors", checked)
            }}
            hideLabel
          >
            {language.t("settings.notifications.errors.title")}
          </Switch>
        </SettingsRow>
      </Card>

      <h4 style={{ "margin-top": "16px", "margin-bottom": "8px" }}>{language.t("settings.notifications.sounds")}</h4>
      <Card>
        <SettingsRow
          title={language.t("settings.notifications.agentSound.title")}
          description={language.t("settings.notifications.agentSound.description")}
        >
          <Select
            options={SOUND_OPTIONS}
            current={SOUND_OPTIONS.find((o) => o.value === agentSound())}
            value={(o) => o.value}
            label={(o) => language.t(o.labelKey)}
            onSelect={(o) => {
              if (o) {
                setAgentSound(o.value)
                save("sounds.agent", o.value)
              }
            }}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.notifications.permSound.title")}
          description={language.t("settings.notifications.permSound.description")}
        >
          <Select
            options={SOUND_OPTIONS}
            current={SOUND_OPTIONS.find((o) => o.value === permSound())}
            value={(o) => o.value}
            label={(o) => language.t(o.labelKey)}
            onSelect={(o) => {
              if (o) {
                setPermSound(o.value)
                save("sounds.permissions", o.value)
              }
            }}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.notifications.errorSound.title")}
          description={language.t("settings.notifications.errorSound.description")}
          last
        >
          <Select
            options={SOUND_OPTIONS}
            current={SOUND_OPTIONS.find((o) => o.value === errorSound())}
            value={(o) => o.value}
            label={(o) => language.t(o.labelKey)}
            onSelect={(o) => {
              if (o) {
                setErrorSound(o.value)
                save("sounds.errors", o.value)
              }
            }}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </SettingsRow>
      </Card>
    </div>
  )
}

export default NotificationsTab
