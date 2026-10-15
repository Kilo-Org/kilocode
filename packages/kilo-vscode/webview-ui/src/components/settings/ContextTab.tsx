import { Component, Show } from "solid-js"
import { Switch } from "@kilocode/kilo-ui/switch"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Card } from "@kilocode/kilo-ui/card"
import { Button } from "@kilocode/kilo-ui/button"

import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import { useMemory } from "../../context/memory"
import SettingsRow from "./SettingsRow"
import PatternList from "./PatternList"

const ContextTab: Component<{ onNavigateToModels?: () => void }> = (props) => {
  const { config, updateConfig } = useConfig()
  const memory = useMemory()
  const language = useLanguage()

  const patterns = () => config().watcher?.ignore ?? []
  const limit = () => {
    const value = config().compaction?.threshold_percent
    return value === null || value === undefined ? "" : String(value)
  }

  const saveLimit = (value: string) => {
    const raw = value.trim()
    if (!raw) {
      updateConfig({ compaction: { ...config().compaction, threshold_percent: null } })
      return
    }

    const percent = Number(raw)
    if (!Number.isFinite(percent)) return
    const next = Math.min(100, Math.max(1, percent))
    updateConfig({ compaction: { ...config().compaction, threshold_percent: next } })
  }

  const memoryStats = () => {
    const status = memory.status()
    if (!status) return language.t("settings.context.memory.status.notLoaded")
    if (!status.state.enabled) return language.t("settings.context.memory.status.disabled")
    if (status.index.estimatedTokens === 0) return language.t("chat.memory.project.empty")
    const tokens = status.index.estimatedTokens.toLocaleString(language.locale())
    return language.t("settings.context.memory.status.enabledTokens", { tokens })
  }

  return (
    <div>
      <h4 style={{ "margin-top": "0", "margin-bottom": "8px" }}>{language.t("settings.context.memory.title")}</h4>
      <Card>
        <SettingsRow title={language.t("settings.context.memory.project.title")} description={memoryStats()}>
          <Switch
            checked={memory.enabled()}
            onChange={(checked) => (checked ? memory.enable() : memory.disable())}
            hideLabel
            disabled={memory.pending()}
          >
            {language.t("settings.context.memory.project.title")}
          </Switch>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.context.memory.autoSave.title")}
          description={language.t("settings.context.memory.autoSave.description")}
        >
          <Switch
            checked={memory.status()?.state.autoConsolidate ?? true}
            onChange={(checked) => memory.auto(checked ? "on" : "off")}
            hideLabel
            disabled={memory.pending() || !memory.status()}
          >
            {language.t("settings.context.memory.autoSave.title")}
          </Switch>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.context.memory.storage.title")}
          description={
            memory.enabled()
              ? language.t("settings.context.memory.storage.path", { path: memory.status()!.root })
              : language.t("settings.context.memory.storage.enable")
          }
          last
        >
          <Button
            variant="secondary"
            size="small"
            icon="eye"
            disabled={memory.loading() || memory.pending() || !memory.enabled() || memory.totalTokens() === 0}
            onClick={() => memory.inspect()}
          >
            {language.t("settings.context.memory.inspect")}
          </Button>
        </SettingsRow>
        <Show when={memory.error()}>
          {(err) => (
            <div
              style={{
                padding: "8px 12px",
                color: "var(--vscode-errorForeground)",
                "font-size": "var(--kilo-font-size-12)",
              }}
            >
              {err()}
            </div>
          )}
        </Show>
      </Card>

      {/* Compaction settings */}
      <h4 style={{ "margin-top": "16px", "margin-bottom": "8px" }}>
        {language.t("settings.context.compaction.title")}
      </h4>
      <Card>
        <SettingsRow
          title={language.t("settings.context.autoCompaction.title")}
          description={language.t("settings.context.autoCompaction.description")}
        >
          <Switch
            checked={config().compaction?.auto ?? true}
            onChange={(checked) => updateConfig({ compaction: { ...config().compaction, auto: checked } })}
            hideLabel
          >
            {language.t("settings.context.autoCompaction.title")}
          </Switch>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.context.compactionLimit.title")}
          description={language.t("settings.context.compactionLimit.description")}
        >
          <div style={{ display: "flex", "align-items": "center", gap: "6px", width: "96px" }}>
            <TextField
              type="number"
              min="1"
              max="100"
              step="1"
              value={limit()}
              placeholder="80"
              onChange={saveLimit}
              hideLabel
              label={language.t("settings.context.compactionLimit.title")}
            />
            <span style={{ color: "var(--text-weak-base, var(--vscode-descriptionForeground))" }}>%</span>
          </div>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.context.prune.title")}
          description={language.t("settings.context.prune.description")}
          last
        >
          <Switch
            checked={config().compaction?.prune ?? true}
            onChange={(checked) => updateConfig({ compaction: { ...config().compaction, prune: checked } })}
            hideLabel
          >
            {language.t("settings.context.prune.title")}
          </Switch>
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
            props.onNavigateToModels?.()
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
        onChange={(ignore) => updateConfig({ watcher: { ignore } })}
      />
    </div>
  )
}

export default ContextTab
