import { Component } from "solid-js"
import { Switch } from "@opencode-ai/ui/switch"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Card } from "@kilocode/kilo-ui/card"
import { useLanguage } from "../../context/language"
import { useSettingsConfig } from "../../v2/settings-config"
import SettingsRow from "./SettingsRow"
import PatternList from "./PatternList"

const ContextTab: Component = () => {
  const config = useSettingsConfig()
  const language = useLanguage()

  const patterns = () => {
    const value = config.value(["watcher", "ignore"])
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
  }

  const auto = () => config.value(["compaction", "auto"]) !== false

  const tokens = (path: string[]) => {
    const value = config.value(path)
    return typeof value === "number" && Number.isFinite(value) ? String(value) : ""
  }

  const saveTokens = (path: string[]) => (input: string) => {
    const raw = input.trim()
    if (!raw) {
      config.unset(path)
      return
    }
    if (!/^\d+$/.test(raw)) return
    config.set(path, Number(raw))
  }

  // The Models rail entry is a sibling of this tab, so the link activates it through the same Tabs trigger a
  // pointer uses. The Settings view owns the active tab, and a tab component receives no navigation callback.
  const openModels = () => {
    const trigger = document.querySelector<HTMLElement>(
      '[data-slot="tabs-trigger-wrapper"][data-value="models"] [data-slot="tabs-trigger"]',
    )
    trigger?.click()
  }

  return (
    <div>
      <h4 style={{ "margin-top": "0", "margin-bottom": "8px" }}>{language.t("settings.context.compaction.title")}</h4>
      <Card>
        <SettingsRow
          title={language.t("settings.context.autoCompaction.title")}
          description={language.t("settings.context.autoCompaction.description")}
        >
          <Switch checked={auto()} onChange={(checked) => config.set(["compaction", "auto"], checked)} hideLabel>
            {language.t("settings.context.autoCompaction.title")}
          </Switch>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.context.compactionKeep.title")}
          description={language.t("settings.context.compactionKeep.description")}
        >
          <div style={{ width: "160px" }}>
            <TextField
              type="number"
              inputMode="numeric"
              min="0"
              step="1"
              value={tokens(["compaction", "keep", "tokens"])}
              placeholder="15000"
              onChange={saveTokens(["compaction", "keep", "tokens"])}
              hideLabel
              label={language.t("settings.context.compactionKeep.title")}
            />
          </div>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.context.compactionBuffer.title")}
          description={language.t("settings.context.compactionBuffer.description")}
          last
        >
          <div style={{ width: "160px" }}>
            <TextField
              type="number"
              inputMode="numeric"
              min="0"
              step="1"
              value={tokens(["compaction", "buffer"])}
              placeholder="16000"
              onChange={saveTokens(["compaction", "buffer"])}
              hideLabel
              label={language.t("settings.context.compactionBuffer.title")}
            />
          </div>
        </SettingsRow>
      </Card>
      <p
        data-slot="context-models-hint"
        style={{
          "margin-top": "8px",
          "font-size": "var(--kilo-font-size-12)",
          "text-align": "right",
          color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
        }}
      >
        <a
          href="#"
          style={{
            color: "var(--vscode-textLink-foreground)",
            "text-decoration": "none",
            cursor: "pointer",
          }}
          onClick={(e) => {
            e.preventDefault()
            openModels()
          }}
        >
          {language.t("settings.context.compactionModel.hint")}
        </a>
      </p>

      <h4 style={{ "margin-top": "16px", "margin-bottom": "8px" }}>{language.t("settings.context.watcherPatterns")}</h4>

      <PatternList
        patterns={patterns()}
        description={language.t("settings.context.watcherPatterns.description")}
        placeholder="e.g. **/node_modules/**"
        onChange={(ignore) => config.set(["watcher", "ignore"], ignore)}
      />
    </div>
  )
}

export default ContextTab
