import { Card } from "@kilocode/kilo-ui/card"
import { Select } from "@kilocode/kilo-ui/select"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { createEffect, createSignal, type Component } from "solid-js"
import { DISPLAY_DEFAULTS, type ToolDisplayLayout } from "../../../../src/protocol"
import { useLanguage } from "../../context/language"
import { applyFontSize, clampFontSize, fallbackFontSize } from "../../v2/kilo-settings"
import { useSettingsConfig, type SettingsScope } from "../../v2/settings-config"
import SettingsRow from "./SettingsRow"
import Switch from "./Switch"

type LayoutKey = "terminal_command_display" | "code_edit_display" | "mcp_tool_display"

const LAYOUT_OPTIONS: { value: ToolDisplayLayout; labelKey: string }[] = [
  { value: "expanded", labelKey: "expanded" },
  { value: "collapsed", labelKey: "collapsed" },
]

const LAYOUT_DEFAULTS: Record<LayoutKey, ToolDisplayLayout> = {
  terminal_command_display: DISPLAY_DEFAULTS.terminalCommandDisplay,
  code_edit_display: DISPLAY_DEFAULTS.codeEditDisplay,
  mcp_tool_display: DISPLAY_DEFAULTS.mcpToolDisplay,
}

const DisplayTab: Component = () => {
  const config = useSettingsConfig()
  const language = useLanguage()
  // The username commits on blur or Enter, so typing does not rewrite the config file on every keystroke.
  const [draft, setDraft] = createSignal<string>()

  const fontSize = () => clampFontSize(config.setting("fontSize")) ?? fallbackFontSize()

  // The three layout keys are Kilo-only, so the config API drops them. Read them from the raw target files, as the
  // Commit Message tab reads its prompt, and write them back through the same file edit.
  const raw = (scope: SettingsScope, key: LayoutKey) => {
    const value = config.raw(scope)?.[key]
    return value === "expanded" || value === "collapsed" ? value : undefined
  }
  const layout = (key: LayoutKey) => {
    const pending = config.optimistic([key])?.value
    if (pending === "expanded" || pending === "collapsed") return pending
    return raw("project", key) ?? raw("global", key) ?? LAYOUT_DEFAULTS[key]
  }
  const setLayout = (key: LayoutKey, value: ToolDisplayLayout) =>
    void config.set([key], value, config.source([key]) ?? "global")

  createEffect(() => applyFontSize(fontSize()))

  const storedUsername = () => {
    const value = config.value(["username"])
    return typeof value === "string" ? value : ""
  }
  const username = () => draft() ?? storedUsername()
  const commitUsername = () => {
    const next = username().trim()
    setDraft(undefined)
    // A blur without an edit should not cost a config write and round trip.
    if (next === storedUsername()) return
    if (next) void config.set(["username"], next)
    else void config.unset(["username"])
  }

  return (
    <div class="settings-display">
      <Card class="settings-display-controls">
        <SettingsRow
          title={language.t("settings.display.username.title")}
          description={language.t("settings.display.username.description")}
        >
          <div style={{ width: "160px" }}>
            <TextField
              value={username()}
              placeholder="User"
              onChange={(value) => setDraft(value)}
              onBlur={commitUsername}
              onKeyDown={(event: KeyboardEvent) => {
                if (event.key !== "Enter") return
                event.preventDefault()
                commitUsername()
              }}
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
              value={fontSize()}
              onInput={(event) => config.setSetting("fontSize", Number(event.currentTarget.value))}
              aria-label={language.t("settings.display.fontSize.title")}
            />
            <span>{fontSize()}px</span>
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.display.shiftTabCycle.title")}
          description={language.t("settings.display.shiftTabCycle.description")}
        >
          <Switch
            checked={config.setting("chat.shiftTabCyclesVariant") !== false}
            onChange={(checked) => config.setSetting("chat.shiftTabCyclesVariant", checked)}
            hideLabel
          >
            {language.t("settings.display.shiftTabCycle.title")}
          </Switch>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.display.shortcutHints.title")}
          description={language.t("settings.display.shortcutHints.description")}
        >
          <Switch
            checked={config.setting("showShortcutHints") !== false}
            onChange={(checked) => config.setSetting("showShortcutHints", checked)}
            hideLabel
          >
            {language.t("settings.display.shortcutHints.title")}
          </Switch>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.display.terminalCommand.title")}
          description={language.t("settings.display.terminalCommand.description")}
        >
          <Select
            options={LAYOUT_OPTIONS}
            current={LAYOUT_OPTIONS.find((option) => option.value === layout("terminal_command_display"))}
            value={(option) => option.value}
            label={(option) => language.t(`settings.display.terminalCommand.${option.labelKey}`)}
            onSelect={(option) => {
              if (!option || option.value === layout("terminal_command_display")) return
              setLayout("terminal_command_display", option.value)
            }}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.display.codeEdit.title")}
          description={language.t("settings.display.codeEdit.description")}
        >
          <Select
            options={LAYOUT_OPTIONS}
            current={LAYOUT_OPTIONS.find((option) => option.value === layout("code_edit_display"))}
            value={(option) => option.value}
            label={(option) => language.t(`settings.display.codeEdit.${option.labelKey}`)}
            onSelect={(option) => {
              if (!option || option.value === layout("code_edit_display")) return
              setLayout("code_edit_display", option.value)
            }}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.display.mcpTool.title")}
          description={language.t("settings.display.mcpTool.description")}
        >
          <Select
            options={LAYOUT_OPTIONS}
            current={LAYOUT_OPTIONS.find((option) => option.value === layout("mcp_tool_display"))}
            value={(option) => option.value}
            label={(option) => language.t(`settings.display.mcpTool.${option.labelKey}`)}
            onSelect={(option) => {
              if (!option || option.value === layout("mcp_tool_display")) return
              setLayout("mcp_tool_display", option.value)
            }}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.display.tokenThroughput.title")}
          description={language.t("settings.display.tokenThroughput.description")}
          last
        >
          <Switch
            checked={config.setting("showTokenThroughput") !== false}
            onChange={(checked) => config.setSetting("showTokenThroughput", checked)}
            hideLabel
          >
            {language.t("settings.display.tokenThroughput.title")}
          </Switch>
        </SettingsRow>
      </Card>
    </div>
  )
}

export default DisplayTab
