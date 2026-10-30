import { Component } from "solid-js"
import Switch from "./Switch"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Card } from "@kilocode/kilo-ui/card"
import { useLanguage } from "../../context/language"
import { useSettingsConfig } from "../../v2/settings-config"
import SettingsRow from "./SettingsRow"
import PatternList from "./PatternList"
import { tokenEdit } from "./context-tokens"
import type { SettingsTabProps } from "./tabs"

const ContextTab: Component<SettingsTabProps> = (props) => {
  const config = useSettingsConfig()
  const language = useLanguage()

  const patterns = () => {
    const value = config.value(["watcher", "ignore"])
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
  }

  const write = (path: string[], value: unknown) => config.set(path, value, config.source(path) ?? "global")
  const clear = (path: string[]) => config.unset(path, config.source(path) ?? "global")

  const auto = () => config.value(["compaction", "auto"]) !== false

  const tokens = (path: string[]) => {
    const value = config.value(path)
    return typeof value === "number" && Number.isFinite(value) ? String(value) : ""
  }

  const saveTokens = (path: string[]) => (input: string) => {
    const edit = tokenEdit(input)
    if (!edit) return
    if (edit.type === "unset") clear(path)
    else write(path, edit.value)
  }

  return (
    <div>
      <h4 style={{ "margin-top": "0", "margin-bottom": "8px" }}>{language.t("settings.context.compaction.title")}</h4>
      <Card>
        <SettingsRow
          title={language.t("settings.context.autoCompaction.title")}
          description={language.t("settings.context.autoCompaction.description")}
        >
          <Switch checked={auto()} onChange={(checked) => write(["compaction", "auto"], checked)} hideLabel>
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
            props.onNavigate({ tab: "models", titleKey: "settings.context.compactionModel.title" })
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
        onChange={(ignore) => write(["watcher", "ignore"], ignore)}
      />
    </div>
  )
}

export default ContextTab
