import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { Select } from "@kilocode/kilo-ui/select"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { createEffect, createSignal, For, onMount, type Component } from "solid-js"
import { DISPLAY_DEFAULTS, type ReasoningDisplay, type ToolDisplayLayout } from "../../../../src/protocol"
import { getWorkStylePreset, WORK_STYLE_CHOICES, type WorkStyle } from "../../../../src/shared/work-style-presets"
import { useLanguage } from "../../context/language"
import { useDisplaySettings } from "../../v2/display-settings"
import { applyFontSize, clampFontSize, fallbackFontSize } from "../../v2/kilo-settings"
import { resolveReasoningDisplay } from "../../v2/reasoning-display"
import { useSettingsConfig, type SettingsScope } from "../../v2/settings-config"
import SessionPreview from "./SessionPreview"
import SettingsRow from "./SettingsRow"
import Switch from "./Switch"

type LayoutKey = "terminal_command_display" | "code_edit_display" | "mcp_tool_display" | "code_mode_display"

const LAYOUT_OPTIONS: { value: ToolDisplayLayout; labelKey: string }[] = [
  { value: "expanded", labelKey: "expanded" },
  { value: "collapsed", labelKey: "collapsed" },
]

const LAYOUT_DEFAULTS: Record<LayoutKey, ToolDisplayLayout> = {
  terminal_command_display: DISPLAY_DEFAULTS.terminalCommandDisplay,
  code_edit_display: DISPLAY_DEFAULTS.codeEditDisplay,
  mcp_tool_display: DISPLAY_DEFAULTS.mcpToolDisplay,
  code_mode_display: DISPLAY_DEFAULTS.codeModeDisplay,
}

const REASONING_OPTIONS: { value: ReasoningDisplay; labelKey: string }[] = [
  { value: "expanded", labelKey: "expanded" },
  { value: "preview", labelKey: "preview" },
  { value: "headline", labelKey: "headline" },
]

const DisplayTab: Component = () => {
  const config = useSettingsConfig()
  const display = useDisplaySettings()
  const language = useLanguage()
  // The username commits on blur or Enter, so typing does not rewrite the config file on every keystroke.
  const [draft, setDraft] = createSignal<string>()

  const fontSize = () => clampFontSize(config.setting("fontSize")) ?? fallbackFontSize()

  // The display keys are Kilo-only, so the config API drops them. Read them from the raw target files, as the
  // Commit Message tab reads its prompt, and write them back through the same file edit.
  const raw = (scope: SettingsScope, key: LayoutKey | "reasoning_display") => config.raw(scope)?.[key]
  const explicit = (key: LayoutKey): ToolDisplayLayout | undefined => {
    const pending = config.optimistic([key])?.value
    if (pending === "expanded" || pending === "collapsed") return pending
    const project = raw("project", key)
    const global = raw("global", key)
    if (project === "expanded" || project === "collapsed") return project
    if (global === "expanded" || global === "collapsed") return global
    return undefined
  }
  const layout = (key: LayoutKey) => explicit(key) ?? LAYOUT_DEFAULTS[key]
  const reasoning = (): ReasoningDisplay => {
    const pending = config.optimistic(["reasoning_display"])?.value
    if (pending === "expanded" || pending === "preview" || pending === "headline") return pending
    return resolveReasoningDisplay(config.raw("project"), config.raw("global"))
  }
  // The chat reads the same effective values from the host, so ask for them again after each write.
  const applyLayout = async (key: LayoutKey, value: ToolDisplayLayout) => {
    const ok = await config.set([key], value, config.source([key]) ?? "global")
    if (ok) display.request()
  }
  const applyReasoning = async (value: ReasoningDisplay) => {
    const ok = await config.set(["reasoning_display"], value, config.source(["reasoning_display"]) ?? "global")
    if (ok) display.request()
  }
  const presetSelected = (style: WorkStyle) => {
    const preset = getWorkStylePreset(style)
    return (
      reasoning() === preset.display.reasoning_display &&
      layout("terminal_command_display") === preset.display.terminal_command_display &&
      layout("code_edit_display") === preset.display.code_edit_display &&
      layout("mcp_tool_display") === preset.display.mcp_tool_display &&
      // A preset applied before this key existed never wrote it, so an unset key still matches the preset.
      (explicit("code_mode_display") ?? preset.display.code_mode_display) === preset.display.code_mode_display &&
      (config.setting("showAutoApprovalReason") !== false) === preset.settings.showAutoApprovalReason
    )
  }
  const applyPreset = async (style: WorkStyle) => {
    const preset = getWorkStylePreset(style)
    const source = (key: string) => config.source([key]) ?? "global"
    const results = await Promise.all([
      config.set(
        ["terminal_command_display"],
        preset.display.terminal_command_display,
        source("terminal_command_display"),
      ),
      config.set(["code_edit_display"], preset.display.code_edit_display, source("code_edit_display")),
      config.set(["mcp_tool_display"], preset.display.mcp_tool_display, source("mcp_tool_display")),
      config.set(["code_mode_display"], preset.display.code_mode_display, source("code_mode_display")),
      config.set(["reasoning_display"], preset.display.reasoning_display, source("reasoning_display")),
    ])
    // A failed write already shows its own error toast; do not apply the rest of a half-written preset.
    if (results.some((ok) => !ok)) return
    config.setSetting("showAutoApprovalReason", preset.settings.showAutoApprovalReason)
    display.request()
  }

  onMount(() => display.request())
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
          title={language.t("settings.display.tokenThroughput.title")}
          description={language.t("settings.display.tokenThroughput.description")}
        >
          <Switch
            checked={config.setting("showTokenThroughput") !== false}
            onChange={(checked) => config.setSetting("showTokenThroughput", checked)}
            hideLabel
          >
            {language.t("settings.display.tokenThroughput.title")}
          </Switch>
        </SettingsRow>

        <div
          class="settings-display-presets"
          role="group"
          aria-label={language.t("settings.display.presets.title")}
          data-search-label={language.t("settings.display.presets.title")}
        >
          <span class="settings-display-presets-title">{language.t("settings.display.presets.title")}</span>
          <div class="settings-display-presets-actions">
            <For each={WORK_STYLE_CHOICES}>
              {(style) => (
                <Button
                  size="small"
                  variant={presetSelected(style) ? "primary" : "secondary"}
                  aria-pressed={presetSelected(style)}
                  data-preset={style}
                  onClick={() => void applyPreset(style)}
                >
                  {language.t(`workStyle.choice.${style}.title`)}
                </Button>
              )}
            </For>
          </div>
          <span class="settings-display-presets-description">{language.t("settings.display.presets.description")}</span>
        </div>

        <SettingsRow
          title={language.t("settings.display.autoApprovalReason.title")}
          description={language.t("settings.display.autoApprovalReason.description")}
        >
          <Switch
            checked={config.setting("showAutoApprovalReason") !== false}
            onChange={(checked) => config.setSetting("showAutoApprovalReason", checked)}
            hideLabel
          >
            {language.t("settings.display.autoApprovalReason.title")}
          </Switch>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.display.reasoningDisplay.title")}
          description={language.t("settings.display.reasoningDisplay.description")}
        >
          <Select
            options={REASONING_OPTIONS}
            current={REASONING_OPTIONS.find((option) => option.value === reasoning())}
            value={(option) => option.value}
            label={(option) => language.t(`settings.display.reasoningDisplay.${option.labelKey}`)}
            onSelect={(option) => {
              if (!option || option.value === reasoning()) return
              void applyReasoning(option.value)
            }}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
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
              void applyLayout("terminal_command_display", option.value)
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
              void applyLayout("code_edit_display", option.value)
            }}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.display.codeMode.title")}
          description={language.t("settings.display.codeMode.description")}
        >
          <Select
            options={LAYOUT_OPTIONS}
            current={LAYOUT_OPTIONS.find((option) => option.value === layout("code_mode_display"))}
            value={(option) => option.value}
            label={(option) => language.t(`settings.display.codeMode.${option.labelKey}`)}
            onSelect={(option) => {
              if (!option || option.value === layout("code_mode_display")) return
              void applyLayout("code_mode_display", option.value)
            }}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.display.mcpTool.title")}
          description={language.t("settings.display.mcpTool.description")}
          last
        >
          <Select
            options={LAYOUT_OPTIONS}
            current={LAYOUT_OPTIONS.find((option) => option.value === layout("mcp_tool_display"))}
            value={(option) => option.value}
            label={(option) => language.t(`settings.display.mcpTool.${option.labelKey}`)}
            onSelect={(option) => {
              if (!option || option.value === layout("mcp_tool_display")) return
              void applyLayout("mcp_tool_display", option.value)
            }}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </SettingsRow>
      </Card>
      <SessionPreview />
    </div>
  )
}

export default DisplayTab
