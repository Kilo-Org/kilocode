import { Component, For, createSignal } from "solid-js"
import { Switch } from "@kilocode/kilo-ui/switch"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Card } from "@kilocode/kilo-ui/card"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"

import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import SettingsRow from "./SettingsRow"

const ContextTab: Component = () => {
  const { config, updateConfig } = useConfig()
  const language = useLanguage()
  const [newPattern, setNewPattern] = createSignal("")

  const patterns = () => config().watcher?.ignore ?? []

  const addPattern = () => {
    const value = newPattern().trim()
    if (!value) return
    const current = [...patterns()]
    if (!current.includes(value)) {
      current.push(value)
      updateConfig({ watcher: { ignore: current } })
    }
    setNewPattern("")
  }

  const removePattern = (index: number) => {
    const current = [...patterns()]
    current.splice(index, 1)
    updateConfig({ watcher: { ignore: current } })
  }

  return (
    <div>
      {/* Compaction settings */}
      <Card>
        <SettingsRow
          title={language.t("settings.context.autoCompaction.title")}
          description={language.t("settings.context.autoCompaction.description")}
        >
          <Switch
            checked={config().compaction?.auto ?? false}
            onChange={(checked) => updateConfig({ compaction: { ...config().compaction, auto: checked } })}
            hideLabel
          >
            {language.t("settings.context.autoCompaction.title")}
          </Switch>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.context.prune.title")}
          description={language.t("settings.context.prune.description")}
          last
        >
          <Switch
            checked={config().compaction?.prune ?? false}
            onChange={(checked) => updateConfig({ compaction: { ...config().compaction, prune: checked } })}
            hideLabel
          >
            {language.t("settings.context.prune.title")}
          </Switch>
        </SettingsRow>
      </Card>

      <h4 style={{ "margin-top": "16px", "margin-bottom": "8px" }}>{language.t("settings.context.watcherPatterns")}</h4>

      <Card>
        <div
          style={{
            "font-size": "11px",
            color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
            "padding-bottom": "8px",
            "border-bottom": patterns().length > 0 || newPattern() ? "1px solid var(--border-weak-base)" : "none",
          }}
        >
          {language.t("settings.context.watcherPatterns.description")}
        </div>

        {/* Add new pattern */}
        <div
          style={{
            display: "flex",
            gap: "8px",
            "align-items": "center",
            padding: "8px 0",
            "border-bottom": patterns().length > 0 ? "1px solid var(--border-weak-base)" : "none",
          }}
        >
          <div style={{ flex: 1 }}>
            <TextField
              value={newPattern()}
              placeholder="e.g. **/node_modules/**"
              onChange={(val) => setNewPattern(val)}
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === "Enter") addPattern()
              }}
            />
          </div>
          <Button size="small" onClick={addPattern}>
            {language.t("common.add")}
          </Button>
        </div>

        {/* Pattern list */}
        <For each={patterns()}>
          {(pattern, index) => (
            <div
              style={{
                display: "flex",
                "align-items": "center",
                "justify-content": "space-between",
                padding: "6px 0",
                "border-bottom": index() < patterns().length - 1 ? "1px solid var(--border-weak-base)" : "none",
              }}
            >
              <span
                style={{
                  "font-family": "var(--vscode-editor-font-family, monospace)",
                  "font-size": "12px",
                }}
              >
                {pattern}
              </span>
              <IconButton size="small" variant="ghost" icon="close" onClick={() => removePattern(index())} />
            </div>
          )}
        </For>
      </Card>
    </div>
  )
}

export default ContextTab
