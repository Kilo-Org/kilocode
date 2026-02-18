import { Component, For, Show, createMemo } from "solid-js"
import { Switch } from "@kilocode/kilo-ui/switch"
import { Select } from "@kilocode/kilo-ui/select"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Card } from "@kilocode/kilo-ui/card"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import SettingsRow from "./SettingsRow"

interface ShareOption {
  value: string
  labelKey: string
}

const SHARE_OPTIONS: ShareOption[] = [
  { value: "manual", labelKey: "settings.experimental.share.manual" },
  { value: "auto", labelKey: "settings.experimental.share.auto" },
  { value: "disabled", labelKey: "settings.experimental.share.disabled" },
]

const ExperimentalTab: Component = () => {
  const { config, updateConfig } = useConfig()
  const language = useLanguage()

  const experimental = createMemo(() => config().experimental ?? {})

  const updateExperimental = (key: string, value: unknown) => {
    updateConfig({
      experimental: { ...experimental(), [key]: value },
    })
  }

  return (
    <div>
      <Card>
        {/* Share mode */}
        <SettingsRow
          title={language.t("settings.experimental.share.title")}
          description={language.t("settings.experimental.share.description")}
        >
          <Select
            options={SHARE_OPTIONS}
            current={SHARE_OPTIONS.find((o) => o.value === (config().share ?? "manual"))}
            value={(o) => o.value}
            label={(o) => language.t(o.labelKey)}
            onSelect={(o) => o && updateConfig({ share: o.value as "manual" | "auto" | "disabled" })}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.experimental.formatter.title")}
          description={language.t("settings.experimental.formatter.description")}
        >
          <Switch
            checked={config().formatter !== false}
            onChange={(checked) => updateConfig({ formatter: checked ? {} : false })}
            hideLabel
          >
            {language.t("settings.experimental.formatter.title")}
          </Switch>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.experimental.lsp.title")}
          description={language.t("settings.experimental.lsp.description")}
        >
          <Switch
            checked={config().lsp !== false}
            onChange={(checked) => updateConfig({ lsp: checked ? {} : false })}
            hideLabel
          >
            {language.t("settings.experimental.lsp.title")}
          </Switch>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.experimental.pasteSummary.title")}
          description={language.t("settings.experimental.pasteSummary.description")}
        >
          <Switch
            checked={experimental().disable_paste_summary ?? false}
            onChange={(checked) => updateExperimental("disable_paste_summary", checked)}
            hideLabel
          >
            {language.t("settings.experimental.pasteSummary.title")}
          </Switch>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.experimental.batch.title")}
          description={language.t("settings.experimental.batch.description")}
        >
          <Switch
            checked={experimental().batch_tool ?? false}
            onChange={(checked) => updateExperimental("batch_tool", checked)}
            hideLabel
          >
            {language.t("settings.experimental.batch.title")}
          </Switch>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.experimental.continueOnDeny.title")}
          description={language.t("settings.experimental.continueOnDeny.description")}
        >
          <Switch
            checked={experimental().continue_loop_on_deny ?? false}
            onChange={(checked) => updateExperimental("continue_loop_on_deny", checked)}
            hideLabel
          >
            {language.t("settings.experimental.continueOnDeny.title")}
          </Switch>
        </SettingsRow>

        {/* MCP timeout */}
        <SettingsRow
          title={language.t("settings.experimental.mcpTimeout.title")}
          description={language.t("settings.experimental.mcpTimeout.description")}
          last
        >
          <TextField
            value={String(experimental().mcp_timeout ?? 60000)}
            onChange={(val) => {
              const num = parseInt(val, 10)
              if (!isNaN(num) && num > 0) {
                updateExperimental("mcp_timeout", num)
              }
            }}
          />
        </SettingsRow>
      </Card>

      {/* Tool toggles */}
      <Show when={config().tools && Object.keys(config().tools ?? {}).length > 0}>
        <h4 style={{ "margin-top": "16px", "margin-bottom": "8px" }}>
          {language.t("settings.experimental.toolToggles")}
        </h4>
        <Card>
          <For each={Object.entries(config().tools ?? {})}>
            {([name, enabled], index) => (
              <SettingsRow title={name} description="" last={index() >= Object.keys(config().tools ?? {}).length - 1}>
                <Switch
                  checked={enabled}
                  onChange={(checked) => updateConfig({ tools: { ...config().tools, [name]: checked } })}
                  hideLabel
                >
                  {name}
                </Switch>
              </SettingsRow>
            )}
          </For>
        </Card>
      </Show>
    </div>
  )
}

export default ExperimentalTab
