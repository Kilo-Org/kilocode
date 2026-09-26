import { batch, For, Show, type Component } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Select } from "@kilocode/kilo-ui/select"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Card } from "@kilocode/kilo-ui/card"
import { Switch } from "@kilocode/kilo-ui/switch"
import { useConfig } from "../../context/config"
import { useDisplay } from "../../context/display"
import { useLanguage } from "../../context/language"
import type { CodeEditDisplay, McpToolDisplay, ReasoningDisplay, TerminalCommandDisplay } from "../../types/messages"
import SettingsRow from "./SettingsRow"
import SessionPreview from "./SessionPreview"
import { getDisplayPreset, WORK_STYLE_CHOICES, type WorkStyle } from "../../../../src/shared/work-style-presets"

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

const MCP_OPTIONS: LayoutOption[] = [
  { value: "expanded", labelKey: "settings.display.mcpTool.expanded" },
  { value: "collapsed", labelKey: "settings.display.mcpTool.collapsed" },
]

// Seeds the color picker when the user switches off "match theme"; also the input's fallback value.
const DEFAULT_INLINE_CODE_COLOR = "#00ceb9"

const DISPLAY_DEFAULTS = {
  terminal_command_display: "expanded",
  code_edit_display: "collapsed",
  mcp_tool_display: "collapsed",
  showAutoApprovalReason: true,
} as const

const REASONING_OPTIONS: LayoutOption[] = [
  { value: "expanded", labelKey: "settings.display.reasoningDisplay.expanded" },
  { value: "preview", labelKey: "settings.display.reasoningDisplay.preview" },
  { value: "headline", labelKey: "settings.display.reasoningDisplay.headline" },
]

const DisplayTab: Component = () => {
  const { config, updateConfig, settings, updateSetting } = useConfig()
  const display = useDisplay()
  const language = useLanguage()
  const selected = (style: WorkStyle) => {
    const preset = getDisplayPreset(style)
    return (
      display.reasoningDisplay() === preset.config.reasoning_display &&
      (config().terminal_command_display ?? DISPLAY_DEFAULTS.terminal_command_display) ===
        preset.config.terminal_command_display &&
      (config().code_edit_display ?? DISPLAY_DEFAULTS.code_edit_display) === preset.config.code_edit_display &&
      (config().mcp_tool_display ?? DISPLAY_DEFAULTS.mcp_tool_display) === preset.config.mcp_tool_display &&
      Boolean(settings().showAutoApprovalReason ?? DISPLAY_DEFAULTS.showAutoApprovalReason) ===
        preset.settings.showAutoApprovalReason
    )
  }
  const apply = (style: WorkStyle) => {
    const preset = getDisplayPreset(style)
    batch(() => {
      updateConfig(preset.config)
      updateSetting("showAutoApprovalReason", preset.settings.showAutoApprovalReason)
    })
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
          title={language.t("settings.display.inlineCodeBackground.title")}
          description={language.t("settings.display.inlineCodeBackground.description")}
        >
          <Switch
            checked={display.inlineCodeBackground()}
            onChange={(checked: boolean) => display.setInlineCodeBackground(checked)}
            hideLabel
          >
            {language.t("settings.display.inlineCodeBackground.title")}
          </Switch>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.display.inlineCodeColor.title")}
          description={language.t("settings.display.inlineCodeColor.description")}
        >
          <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
            <Switch
              checked={!display.inlineCodeColor()}
              onChange={(matchTheme: boolean) =>
                display.setInlineCodeColor(matchTheme ? undefined : DEFAULT_INLINE_CODE_COLOR)
              }
            >
              {language.t("settings.display.inlineCodeColor.matchTheme")}
            </Switch>
            <Show when={display.inlineCodeColor()}>
              <input
                type="color"
                value={display.inlineCodeColor() ?? DEFAULT_INLINE_CODE_COLOR}
                onInput={(event) => display.setInlineCodeColor(event.currentTarget.value)}
                aria-label={language.t("settings.display.inlineCodeColor.title")}
              />
            </Show>
          </div>
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
          title={language.t("settings.display.tokenThroughput.title")}
          description={language.t("settings.display.tokenThroughput.description")}
        >
          <Switch
            checked={Boolean(settings()["showTokenThroughput"] ?? true)}
            onChange={(checked: boolean) => updateSetting("showTokenThroughput", checked)}
            hideLabel
          >
            {language.t("settings.display.tokenThroughput.title")}
          </Switch>
        </SettingsRow>

        <div class="settings-display-presets" role="group" aria-label={language.t("settings.display.presets.title")}>
          <span class="settings-display-presets-title">{language.t("settings.display.presets.title")}</span>
          <div class="settings-display-presets-actions">
            <For each={WORK_STYLE_CHOICES}>
              {(style) => (
                <Button
                  size="small"
                  variant={selected(style) ? "primary" : "secondary"}
                  aria-pressed={selected(style)}
                  data-preset={style}
                  onClick={() => apply(style)}
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
            checked={Boolean(settings()["showAutoApprovalReason"] ?? DISPLAY_DEFAULTS.showAutoApprovalReason)}
            onChange={(checked: boolean) => updateSetting("showAutoApprovalReason", checked)}
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
            current={REASONING_OPTIONS.find((o) => o.value === display.reasoningDisplay())}
            value={(o) => o.value}
            label={(o) => language.t(o.labelKey)}
            onSelect={(o) => {
              if (!o) return
              const next = o.value as ReasoningDisplay
              if (next === display.reasoningDisplay()) return
              display.setReasoningDisplay(next)
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
            options={TERMINAL_OPTIONS}
            current={TERMINAL_OPTIONS.find(
              (o) => o.value === (config().terminal_command_display ?? DISPLAY_DEFAULTS.terminal_command_display),
            )}
            value={(o) => o.value}
            label={(o) => language.t(o.labelKey)}
            onSelect={(o) => {
              if (!o) return
              const next = o.value as TerminalCommandDisplay
              if (next === (config().terminal_command_display ?? DISPLAY_DEFAULTS.terminal_command_display)) return
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
        >
          <Select
            options={CODE_EDIT_OPTIONS}
            current={CODE_EDIT_OPTIONS.find(
              (o) => o.value === (config().code_edit_display ?? DISPLAY_DEFAULTS.code_edit_display),
            )}
            value={(o) => o.value}
            label={(o) => language.t(o.labelKey)}
            onSelect={(o) => {
              if (!o) return
              const next = o.value as CodeEditDisplay
              if (next === (config().code_edit_display ?? DISPLAY_DEFAULTS.code_edit_display)) return
              updateConfig({ code_edit_display: next })
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
            options={MCP_OPTIONS}
            current={MCP_OPTIONS.find(
              (o) => o.value === (config().mcp_tool_display ?? DISPLAY_DEFAULTS.mcp_tool_display),
            )}
            value={(o) => o.value}
            label={(o) => language.t(o.labelKey)}
            onSelect={(o) => {
              if (!o) return
              const next = o.value as McpToolDisplay
              if (next === (config().mcp_tool_display ?? DISPLAY_DEFAULTS.mcp_tool_display)) return
              updateConfig({ mcp_tool_display: next })
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
