import { type Component } from "solid-js"
import { Select } from "@kilocode/kilo-ui/select"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Card } from "@kilocode/kilo-ui/card"
import { Switch } from "@kilocode/kilo-ui/switch"
import { useConfig } from "../../context/config"
import { useDisplay } from "../../context/display"
import { useLanguage } from "../../context/language"
import type { TerminalCommandDisplay } from "../../types/messages"
import SettingsRow from "./SettingsRow"

interface LayoutOption {
  value: string
  labelKey: string
}

const LAYOUT_OPTIONS: LayoutOption[] = [
  { value: "auto", labelKey: "settings.display.layout.auto" },
  { value: "stretch", labelKey: "settings.display.layout.stretch" },
]

const TERMINAL_OPTIONS: LayoutOption[] = [
  { value: "expanded", labelKey: "settings.display.terminalCommand.expanded" },
  { value: "collapsed", labelKey: "settings.display.terminalCommand.collapsed" },
]

const DisplayTab: Component = () => {
  const { config, updateConfig } = useConfig()
  const display = useDisplay()
  const language = useLanguage()

  return (
    <div>
      <Card>
        <SettingsRow
          title={language.t("settings.display.username.title")}
          description={language.t("settings.display.username.description")}
        >
          <div style={{ width: "160px" }}>
            <TextField
              value={config().username ?? ""}
              placeholder="User"
              onChange={(val) => updateConfig({ username: val.trim() || undefined })}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.display.layout.title")}
          description={language.t("settings.display.layout.description")}
        >
          <Select
            options={LAYOUT_OPTIONS}
            current={LAYOUT_OPTIONS.find((o) => o.value === (config().layout ?? "auto"))}
            value={(o) => o.value}
            label={(o) => language.t(o.labelKey)}
            onSelect={(o) => {
              if (!o) return
              const next = o.value as "auto" | "stretch"
              if (next === (config().layout ?? "auto")) return
              updateConfig({ layout: next })
            }}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.display.reasoningAutoCollapse.title")}
          description={language.t("settings.display.reasoningAutoCollapse.description")}
        >
          <Switch
            checked={display.reasoningAutoCollapse()}
            onChange={(checked: boolean) => {
              display.setReasoningAutoCollapse(checked)
            }}
            hideLabel
          >
            {language.t("settings.display.reasoningAutoCollapse.title")}
          </Switch>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.display.terminalCommand.title")}
          description={language.t("settings.display.terminalCommand.description")}
          last
        >
          <Select
            options={TERMINAL_OPTIONS}
            current={TERMINAL_OPTIONS.find((o) => o.value === (config().terminal_command_display ?? "expanded"))}
            value={(o) => o.value}
            label={(o) => language.t(o.labelKey)}
            onSelect={(o) => {
              if (!o) return
              const next = o.value as TerminalCommandDisplay
              if (next === (config().terminal_command_display ?? "expanded")) return
              updateConfig({ terminal_command_display: next })
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

export default DisplayTab
