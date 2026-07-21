import { Component, For, Show, createSignal } from "solid-js"
import { Switch } from "@kilocode/kilo-ui/switch"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Card } from "@kilocode/kilo-ui/card"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"

import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import { useMemory } from "../../context/memory"
import SettingsRow from "./SettingsRow"

const ContextTab: Component = () => {
  const { config, updateConfig } = useConfig()
  const memory = useMemory()
  const language = useLanguage()
  const [newPattern, setNewPattern] = createSignal("")

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

  const memoryStats = () => {
    const status = memory.status()
    if (!status) return language.t("settings.context.memory.status.notLoaded")
    if (!status.state.enabled) return language.t("settings.context.memory.status.disabled")
    const tokens = status.index.estimatedTokens.toLocaleString(language.locale())
    const session = memory.sessionTokens().toLocaleString(language.locale())
    const ops = status.state.stats.lastOperationCount.toLocaleString(language.locale())
    return language.t("settings.context.memory.status.enabledTokensOps", { session, tokens, ops })
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
          title={language.t("settings.context.memory.index.title")}
          description={
            memory.enabled()
              ? language.t("settings.context.memory.index.path", { path: memory.status()!.root })
              : language.t("settings.context.memory.index.enable")
          }
          last
        >
          <div style={{ display: "flex", gap: "6px", "align-items": "center" }}>
            <Button variant="secondary" size="small" icon="eye" onClick={() => memory.showMemory()}>
              {language.t("settings.context.memory.inspect")}
            </Button>
            <IconButton
              size="small"
              variant="ghost"
              icon="reset"
              disabled={memory.pending()}
              onClick={() => memory.rebuild()}
              aria-label={language.t("settings.context.memory.rebuild")}
            />
          </div>
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

      <h4 style={{ "margin-top": "16px", "margin-bottom": "8px" }}>{language.t("settings.context.watcherPatterns")}</h4>

      <Card>
        <div
          style={{
            "font-size": "var(--kilo-font-size-12)",
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
          <Button variant="secondary" onClick={addPattern}>
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
                  "font-size": "var(--kilo-font-size-12)",
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
