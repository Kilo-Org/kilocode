import { createSignal, Show, type Component } from "solid-js"
import Switch from "./Switch"
import { Button } from "@kilocode/kilo-ui/button"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Card } from "@kilocode/kilo-ui/card"
import { useLanguage } from "../../context/language"
import { localeToBcp47 } from "../../context/language-utils"
import { MemoryProvider, useMemory } from "../../context/memory"
import { useSettingsConfig } from "../../v2/settings-config"
import SettingsRow from "./SettingsRow"
import PatternList from "./PatternList"
import { limitEdit, limitFromBuffer, tokenEdit } from "./context-tokens"
import type { SettingsTabProps } from "./tabs"

const ContextTabContent: Component<SettingsTabProps> = (props) => {
  const config = useSettingsConfig()
  const language = useLanguage()
  const memory = useMemory()!

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

  // A field commits on blur or Enter, never per keystroke. `read` supplies the stored value when nothing is drafted.
  const field = (read: () => string, apply: (input: string) => void) => {
    const [draft, setDraft] = createSignal<string>()
    const commit = () => {
      const input = draft()
      if (input === undefined) return
      setDraft(undefined)
      apply(input)
    }
    const keyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter") return
      event.preventDefault()
      commit()
    }
    return { value: () => draft() ?? read(), setDraft, commit, keyDown }
  }

  const applyTokens = (path: string[]) => (input: string) => {
    const edit = tokenEdit(input)
    if (!edit) return
    if (edit.type === "unset") {
      if (tokens(path)) clear(path)
      return
    }
    if (String(edit.value) !== tokens(path)) write(path, edit.value)
  }

  // The limit is the v1 setting users know: the share of the window at which compaction runs. v2 keeps its
  // complement as `compaction.buffer`, so the two fields are the percentage and token forms of one key.
  const applyLimit = (input: string) => {
    const edit = limitEdit(input)
    if (!edit) return
    if (edit.type === "unset") {
      if (limitFromBuffer(config.value(["compaction", "buffer"]))) clear(["compaction", "buffer"])
      return
    }
    if (edit.value !== config.value(["compaction", "buffer"])) write(["compaction", "buffer"], edit.value)
  }

  const limit = () => limitFromBuffer(config.value(["compaction", "buffer"]))
  const keep = field(() => tokens(["compaction", "keep", "tokens"]), applyTokens(["compaction", "keep", "tokens"]))
  const buffer = field(() => tokens(["compaction", "buffer"]), applyTokens(["compaction", "buffer"]))
  const limitField = field(limit, applyLimit)

  const memoryStats = () => {
    const status = memory.status()
    if (!status) return language.t("settings.context.memory.status.notLoaded")
    if (!status.state.enabled) return language.t("settings.context.memory.status.disabled")
    if (status.index.estimatedTokens === 0) return language.t("chat.memory.project.empty")
    const tokens = status.index.estimatedTokens.toLocaleString(localeToBcp47(language.locale()))
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
              data-slot="context-memory-error"
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

      <h4 style={{ "margin-top": "16px", "margin-bottom": "8px" }}>
        {language.t("settings.context.compaction.title")}
      </h4>
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
          title={language.t("settings.context.compactionLimit.title")}
          description={language.t("settings.context.compactionLimit.description")}
        >
          <div style={{ display: "flex", "align-items": "center", gap: "6px", width: "160px" }}>
            <TextField
              type="number"
              inputMode="decimal"
              min="0.001"
              max="100"
              step="any"
              value={limitField.value()}
              placeholder="80"
              onChange={(value) => limitField.setDraft(value)}
              onBlur={limitField.commit}
              onKeyDown={limitField.keyDown}
              hideLabel
              label={language.t("settings.context.compactionLimit.title")}
            />
            <span style={{ color: "var(--text-weak-base, var(--vscode-descriptionForeground))" }}>%</span>
          </div>
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
              value={keep.value()}
              placeholder="15000"
              onChange={(value) => keep.setDraft(value)}
              onBlur={keep.commit}
              onKeyDown={keep.keyDown}
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
              value={buffer.value()}
              placeholder="16000"
              onChange={(value) => buffer.setDraft(value)}
              onBlur={buffer.commit}
              onKeyDown={buffer.keyDown}
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

// Only this tab reads the project memory state, so the Settings shell does not mount it.
const ContextTab: Component<SettingsTabProps> = (props) => (
  <MemoryProvider>
    <ContextTabContent {...props} />
  </MemoryProvider>
)

export default ContextTab
