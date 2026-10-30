import { createSignal, type Component } from "solid-js"
import Switch from "./Switch"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Card } from "@kilocode/kilo-ui/card"
import { useLanguage } from "../../context/language"
import { useSettingsConfig } from "../../v2/settings-config"
import SettingsRow from "./SettingsRow"
import PatternList from "./PatternList"
import { tokenEdit } from "./context-tokens"

const ContextTab: Component = () => {
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

  const tokenField = (path: string[]) => {
    const [draft, setDraft] = createSignal<string>()
    const commit = () => {
      const input = draft()
      if (input === undefined) return
      setDraft(undefined)
      const edit = tokenEdit(input)
      if (!edit) return
      if (edit.type === "unset") {
        if (tokens(path)) clear(path)
        return
      }
      if (String(edit.value) !== tokens(path)) write(path, edit.value)
    }
    const keyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter") return
      event.preventDefault()
      commit()
    }
    return { value: () => draft() ?? tokens(path), setDraft, commit, keyDown }
  }
  const keep = tokenField(["compaction", "keep", "tokens"])
  const buffer = tokenField(["compaction", "buffer"])

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
        onChange={(ignore) => write(["watcher", "ignore"], ignore)}
      />
    </div>
  )
}

export default ContextTab
