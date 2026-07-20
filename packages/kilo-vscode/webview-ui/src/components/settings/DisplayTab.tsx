import { type Component } from "solid-js"
import { Select } from "@kilocode/kilo-ui/select"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Card } from "@kilocode/kilo-ui/card"
import { Switch } from "@kilocode/kilo-ui/switch"
import { useConfig } from "../../context/config"
import { useDisplay } from "../../context/display"
import { useLanguage } from "../../context/language"
import type { CodeEditDisplay, TerminalCommandDisplay } from "../../types/messages"
import SettingsRow from "./SettingsRow"

interface LayoutOption {
  value: string
  labelKey: string
}

const TERMINAL_OPTIONS: LayoutOption[] = [
  { value: "expanded", labelKey: "settings.display.terminalCommand.expanded" },
  { value: "collapsed", labelKey: "settings.display.terminalCommand.collapsed" },
]

const CODE_EDIT_OPTIONS: LayoutOption[] = [
  { value: "expanded", labelKey: "settings.display.codeEdit.expanded" },
  { value: "collapsed", labelKey: "settings.display.codeEdit.collapsed" },
]

const DisplayTab: Component = () => {
  const { config, updateConfig, settings, updateSetting } = useConfig()
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
          title={language.t("settings.display.fontSize.title")}
          description={language.t("settings.display.fontSize.description")}
        >
          <div class="settings-font-size-control">
            <input
              type="range"
              min="10"
              max="24"
              step="1"
              value={display.fontSize()}
              onInput={(event) => display.setFontSize(Number(event.currentTarget.value))}
              aria-label={language.t("settings.display.fontSize.title")}
            />
            <span>{display.fontSize()}px</span>
          </div>
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
          title={language.t("settings.display.shiftTabCycle.title")}
          description={language.t("settings.display.shiftTabCycle.description")}
        >
          <Switch
            checked={Boolean(settings()["chat.shiftTabCyclesVariant"] ?? true)}
            onChange={(checked: boolean) => updateSetting("chat.shiftTabCyclesVariant", checked)}
            hideLabel
          >
            {language.t("settings.display.shiftTabCycle.title")}
          </Switch>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.display.terminalCommand.title")}
          description={language.t("settings.display.terminalCommand.description")}
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

        <SettingsRow
          title={language.t("settings.display.codeEdit.title")}
          description={language.t("settings.display.codeEdit.description")}
          last
        >
          <Select
            options={CODE_EDIT_OPTIONS}
            current={CODE_EDIT_OPTIONS.find((o) => o.value === (config().code_edit_display ?? "collapsed"))}
            value={(o) => o.value}
            label={(o) => language.t(o.labelKey)}
            onSelect={(o) => {
              if (!o) return
              const next = o.value as CodeEditDisplay
              if (next === (config().code_edit_display ?? "collapsed")) return
              updateConfig({ code_edit_display: next })
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
