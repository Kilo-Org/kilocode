import { Component, Show, createSignal, createMemo } from "solid-js"
import { Switch } from "@kilocode/kilo-ui/switch"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Card } from "@kilocode/kilo-ui/card"
import { Select } from "@kilocode/kilo-ui/select"
import { useConfig } from "../../context/config"
import { useLanguage, LOCALES, LOCALE_LABELS } from "../../context/language"
import type { Locale } from "../../context/language"
import SettingsRow from "./SettingsRow"

const SYNC = "sync"
const opts = [SYNC, ...LOCALES] as const
type Option = typeof SYNC | Locale

const CommitMessageTab: Component = () => {
  const { config, updateConfig, settings, updateSetting } = useConfig()
  const language = useLanguage()

  const langValue = () => settings().languageCommitMessage ?? SYNC

  const [expanded, setExpanded] = createSignal(Boolean(config().commit_message?.prompt))

  const toggle = (checked: boolean) => {
    setExpanded(checked)
    if (!checked) {
      updateConfig({ commit_message: { prompt: "" } })
    }
  }

  const label = (opt: Option) =>
    opt === SYNC ? language.t("settings.commitMessage.language.sync") : LOCALE_LABELS[opt]

  const value = (opt: Option) => opt

  const onSelect = (opt: Option | undefined) => {
    if (opt !== undefined) updateSetting("languageCommitMessage", opt)
  }

  const currentLabel = createMemo(() => label(langValue() as Option))

  return (
    <Card>
      <div style={{ padding: "16px" }}>
        <p style={{ "font-size": "var(--kilo-font-size-13)", "margin-bottom": "12px" }}>
          {language.t("settings.commitMessage.language.description")}
        </p>
        <Select
          options={[...opts]}
          current={langValue() as Option}
          label={label}
          value={value}
          onSelect={onSelect}
          variant="secondary"
          size="large"
        />
        <p
          style={{
            "font-size": "var(--kilo-font-size-12)",
            color: "var(--vscode-descriptionForeground)",
            "margin-top": "8px",
          }}
        >
          {language.t("settings.language.current")} {currentLabel()}
        </p>
      </div>

      <div style={{ "border-bottom": "1px solid var(--border-weak-base)" }} />

      <div style={{ padding: "16px" }}>
        <SettingsRow
          title={language.t("settings.commitMessage.override.title")}
          description={language.t("settings.commitMessage.override.description")}
          last={!expanded()}
        >
          <Switch checked={expanded()} onChange={toggle} hideLabel>
            {language.t("settings.commitMessage.override.title")}
          </Switch>
        </SettingsRow>

        <Show when={expanded()}>
          <div style={{ "padding-top": "8px" }}>
            <div data-slot="settings-row-label-title" style={{ "margin-bottom": "4px" }}>
              {language.t("settings.commitMessage.prompt.title")}
            </div>
            <div data-slot="settings-row-label-subtitle" style={{ "margin-bottom": "8px" }}>
              {language.t("settings.commitMessage.prompt.description")}
            </div>
            <div style={{ "max-height": "300px", overflow: "auto" }}>
              <TextField
                value={config().commit_message?.prompt ?? ""}
                placeholder={language.t("settings.commitMessage.prompt.placeholder")}
                multiline
                onChange={(val) => {
                  updateConfig({ commit_message: { prompt: val } })
                }}
              />
            </div>
          </div>
        </Show>
      </div>
    </Card>
  )
}

export default CommitMessageTab
