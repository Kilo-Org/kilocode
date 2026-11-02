// Main's Commit Message tab on v2 data. The language is the `kilo-code.v2.languageCommitMessage` VS Code setting and
// the custom prompt is the Kilo `commit_message.prompt` config key. The server's config documents carry only the
// upstream keys, so the prompt is read from the raw target files, as the Models tab reads its Kilo key.
import { Card } from "@kilocode/kilo-ui/card"
import { Select } from "@kilocode/kilo-ui/select"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { createSignal, Show, type Component } from "solid-js"
import { LOCALE_LABELS, LOCALES, useLanguage, type Locale } from "../../context/language"
import { useSettingsConfig, type SettingsScope } from "../../v2/settings-config"
import SettingsRow from "./SettingsRow"
import Switch from "./Switch"

const SYNC = "sync"
const options = [SYNC, ...LOCALES] as const
type Option = typeof SYNC | Locale
const PROMPT = ["commit_message", "prompt"]

const CommitMessageTab: Component = () => {
  const config = useSettingsConfig()
  const language = useLanguage()

  const current = (): Option => {
    const value = config.setting("languageCommitMessage")
    return options.find((option) => option === value) ?? SYNC
  }
  const label = (option: Option) =>
    option === SYNC ? language.t("settings.commitMessage.language.sync") : LOCALE_LABELS[option]

  const raw = (scope: SettingsScope) => {
    const section = config.raw(scope)?.commit_message
    return typeof section === "object" && section !== null ? (section as Record<string, unknown>).prompt : undefined
  }
  const saved = () => {
    const pending = config.optimistic(PROMPT)
    const value = pending ? pending.value : (raw("project") ?? raw("global"))
    return typeof value === "string" ? value : ""
  }
  const scope = () => config.source(PROMPT) ?? "global"

  // The switch shows the editor; turning it off removes the prompt so the default prompt applies again.
  const [toggled, setToggled] = createSignal<boolean>()
  const expanded = () => toggled() ?? saved().length > 0
  const toggle = (checked: boolean) => {
    setToggled(checked)
    if (!checked && saved()) void config.unset(PROMPT, scope())
  }

  const [draft, setDraft] = createSignal<string>()
  const commit = () => {
    const value = draft()
    setDraft(undefined)
    if (value === undefined || value === saved()) return
    if (value.trim().length === 0) return void config.unset(PROMPT, scope())
    void config.set(PROMPT, value, scope())
  }

  return (
    <Card>
      <div data-search-label={language.t("settings.commitMessage.language.description")} style={{ padding: "16px" }}>
        <p style={{ "font-size": "var(--kilo-font-size-13)", "margin-bottom": "12px" }}>
          {language.t("settings.commitMessage.language.description")}
        </p>
        <Select
          options={[...options]}
          current={current()}
          label={label}
          value={(option: Option) => option}
          onSelect={(option) => {
            if (option !== undefined) config.setSetting("languageCommitMessage", option)
          }}
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
          {language.t("settings.language.current")} {label(current())}
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
          <div data-search-label={language.t("settings.commitMessage.prompt.title")} style={{ "padding-top": "8px" }}>
            <div data-slot="settings-row-label-title" style={{ "margin-bottom": "4px" }}>
              {language.t("settings.commitMessage.prompt.title")}
            </div>
            <div data-slot="settings-row-label-subtitle" style={{ "margin-bottom": "8px" }}>
              {language.t("settings.commitMessage.prompt.description")}
            </div>
            <div style={{ "max-height": "300px", overflow: "auto" }}>
              <TextField
                value={draft() ?? saved()}
                placeholder={language.t("settings.commitMessage.prompt.placeholder")}
                multiline
                onChange={setDraft}
                onBlur={commit}
                hideLabel
                label={language.t("settings.commitMessage.prompt.title")}
              />
            </div>
          </div>
        </Show>
      </div>
    </Card>
  )
}

export default CommitMessageTab
