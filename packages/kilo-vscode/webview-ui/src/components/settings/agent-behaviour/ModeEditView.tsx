// The v2 contract of the Edit Mode view. A built-in agent keeps its base definition, so the view shows overrides
// only; a config-defined agent is edited in full and can be removed. Every control writes the v2 `agents.<id>` key.
import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Switch } from "../Switch"
import { TextField } from "@kilocode/kilo-ui/text-field"
import type { AgentInfo, PermissionRule } from "@opencode/client"
import { Component, For, Show, createEffect, createMemo, createSignal, on } from "solid-js"
import { useLanguage } from "../../../context/language"
import { useV2 } from "../../../v2/client"
import { useSettingsConfig } from "../../../v2/settings-config"
import ModelPicker, { type ModelPickerValue } from "../ModelPicker"
import PermissionEditor from "../PermissionEditor"
import SettingsRow from "../SettingsRow"
import { agentConfig, agentField, agentPath, modelSelection, parseModelSelection, permissionRows, permissionSummary, type AgentRow, type PermissionRow } from "./agents"
import { buildExport } from "./mode-io"

interface Props {
  row: AgentRow
  onBack: () => void
  onRemove: (row: AgentRow) => void
}

const ACTION_COLORS: Record<string, { bg: string; fg: string }> = {
  allow: { bg: "var(--vscode-terminal-ansiGreen, #3fb950)", fg: "var(--vscode-editor-background, #1e1e1e)" },
  ask: { bg: "var(--vscode-editorWarning-foreground, #cca700)", fg: "var(--vscode-editor-background, #1e1e1e)" },
  deny: { bg: "var(--vscode-errorForeground, #f85149)", fg: "var(--vscode-editor-background, #fff)" },
  unknown: { bg: "var(--vscode-descriptionForeground, #8b949e)", fg: "var(--vscode-editor-background, #1e1e1e)" },
}

const ModeEditView: Component<Props> = (props) => {
  const language = useLanguage()
  const v2 = useV2()
  const config = useSettingsConfig()
  const [expanded, setExpanded] = createSignal(false)
  const [rules, setRules] = createSignal<PermissionRule[]>()

  const info = () => v2.data.location.agent.list()?.find((agent: AgentInfo) => agent.id === props.row.id)
  const builtIn = () => props.row.builtIn
  const scope = () => config.source(agentPath(props.row.id)) ?? "global"

  // Config values read the staged edit at their own path, so an unsaved change shows immediately.
  const description = () => asString(config.value(agentField(props.row.id, "description")))
  const system = () => asString(config.value(agentField(props.row.id, "system")))
  const model = () => parseModelSelection(config.value(agentField(props.row.id, "model")))
  const temperature = () => asNumber(config.value(agentField(props.row.id, "request", "body", "temperature")))
  const topP = () => asNumber(config.value(agentField(props.row.id, "request", "body", "top_p")))
  const steps = () => asNumber(config.value(agentField(props.row.id, "steps")))
  const hidden = () => config.value(agentField(props.row.id, "hidden")) === true
  const disabled = () => config.value(agentField(props.row.id, "disabled")) === true

  // The calculated permissions come from `api.agent.get`; a config-only agent has none.
  createEffect(
    on(
      () => info()?.id,
      (id) => {
        if (!id) {
          setRules(undefined)
          return
        }
        void v2.api.agent
          .get({ agentID: id, location: { directory: v2.directory } })
          .then((response) => setRules(response.data.permissions))
          .catch(v2.report)
      },
    ),
  )

  const rows = createMemo<PermissionRow[]>(() => permissionRows(rules() ?? []))
  const summary = createMemo(() => permissionSummary(rows()))

  // A text field commits on blur; a select, picker or switch commits on change, as the v2 settings contract.
  const commitText = (path: string[]) => (value: string) => config.set(path, value.trim() ? value : undefined, scope())
  const commitNumber = (path: string[], parse: (value: string) => number) => (value: string) => {
    const parsed = parse(value)
    config.set(path, value.trim() === "" || Number.isNaN(parsed) ? undefined : parsed, scope())
  }
  const writeToggle = (key: "hidden" | "disabled") => (value: boolean) => {
    // Sequential writes so the second edit is not lost to a race with the first on the config file.
    void (async () => {
      await config.set(agentField(props.row.id, key), value, scope())
      if (value && config.value(["default_agent"]) === props.row.id)
        await config.unset(["default_agent"], config.source(["default_agent"]) ?? "global")
    })()
  }

  const exportMode = () => {
    const data = buildExport(props.row.id, agentConfig(config.value, props.row.id))
    const json = JSON.stringify(data, null, 2)
    const blob = new Blob([json], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `${props.row.id}.agent.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <div
        style={{ display: "flex", "align-items": "center", "justify-content": "space-between", "margin-bottom": "16px" }}
      >
        <div style={{ display: "flex", "align-items": "center" }}>
          <IconButton size="small" variant="ghost" icon="arrow-left" onClick={props.onBack} />
          <span style={{ "font-weight": "600", "font-size": "var(--kilo-font-size-14)", "margin-left": "8px" }}>
            {language.t("settings.agentBehaviour.editMode")} — {props.row.label}
          </span>
        </div>
        <Show when={!builtIn()}>
          <div style={{ display: "flex", gap: "4px" }}>
            <IconButton
              size="small"
              variant="ghost"
              icon="download"
              title={language.t("settings.agentBehaviour.exportMode")}
              onClick={exportMode}
            />
            <Show when={props.row.removable}>
              <IconButton size="small" variant="ghost" icon="close" onClick={() => props.onRemove(props.row)} />
            </Show>
          </div>
        </Show>
      </div>

      <Show when={builtIn()}>
        <Card style={{ "margin-bottom": "12px" }}>
          <div
            style={{
              "font-size": "var(--kilo-font-size-12)",
              color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
              padding: "4px 0",
            }}
          >
            {language.t("settings.agentBehaviour.editMode.native")}
          </div>
        </Card>
      </Show>

      <Show when={!builtIn()}>
        <Card style={{ "margin-bottom": "12px" }}>
          <div data-slot="settings-row-label-title" style={{ "margin-bottom": "8px" }}>
            {language.t("settings.agentBehaviour.editMode.description")}
          </div>
          <DraftField
            value={() => description() ?? ""}
            placeholder={language.t("settings.agentBehaviour.createMode.description.placeholder")}
            commit={commitText(agentField(props.row.id, "description"))}
          />
        </Card>
      </Show>

      <Card style={{ "margin-bottom": "12px" }}>
        <div data-slot="settings-row-label-title" style={{ "margin-bottom": "8px" }}>
          {builtIn()
            ? language.t("settings.agentBehaviour.editMode.promptOverride")
            : language.t("settings.agentBehaviour.editMode.prompt")}
        </div>
        <DraftField
          value={() => system() ?? ""}
          placeholder={language.t("settings.agentBehaviour.createMode.prompt.placeholder")}
          multiline
          commit={commitText(agentField(props.row.id, "system"))}
        />
      </Card>

      <Card data-variant="wide-input" style={{ "margin-bottom": "12px" }}>
        <SettingsRow
          title={language.t("settings.agentBehaviour.modelOverride.title")}
          description={language.t("settings.agentBehaviour.modelOverride.description")}
        >
          <ModelPicker
            value={model()}
            clearable
            clearLabel={language.t("settings.providers.notSet")}
            onChange={(value: ModelPickerValue | undefined) =>
              config.set(agentField(props.row.id, "model"), modelSelection(value), scope())
            }
          />
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.agentBehaviour.temperature.title")}
          description={language.t("settings.agentBehaviour.temperature.description")}
        >
          <DraftField
            value={() => (temperature() !== undefined ? String(temperature()) : "")}
            placeholder={language.t("common.default")}
            commit={commitNumber(agentField(props.row.id, "request", "body", "temperature"), parseFloat)}
          />
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.agentBehaviour.topP.title")}
          description={language.t("settings.agentBehaviour.topP.description")}
        >
          <DraftField
            value={() => (topP() !== undefined ? String(topP()) : "")}
            placeholder={language.t("common.default")}
            commit={commitNumber(agentField(props.row.id, "request", "body", "top_p"), parseFloat)}
          />
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.agentBehaviour.maxSteps.title")}
          description={language.t("settings.agentBehaviour.maxSteps.description")}
        >
          <DraftField
            value={() => (steps() !== undefined ? String(steps()) : "")}
            placeholder={language.t("common.default")}
            commit={commitNumber(agentField(props.row.id, "steps"), (value) => parseInt(value, 10))}
          />
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.agentBehaviour.hidden.title")}
          description={language.t("settings.agentBehaviour.hidden.description")}
        >
          <Switch checked={hidden()} onChange={writeToggle("hidden")} hideLabel>
            {language.t("settings.agentBehaviour.hidden.title")}
          </Switch>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.agentBehaviour.disable.title")}
          description={language.t("settings.agentBehaviour.disable.description")}
          last
        >
          <Switch checked={disabled()} onChange={writeToggle("disabled")} hideLabel>
            {language.t("settings.agentBehaviour.disable.title")}
          </Switch>
        </SettingsRow>
      </Card>

      <Show when={!builtIn()}>
        <Card style={{ "margin-bottom": "12px" }}>
          <PermissionEditor target={{ kind: "agent", name: props.row.id }} />
        </Card>
      </Show>

      <Show when={rules()} keyed>
        {(rules) => (
          <Ruleset
            agent={props.row.id}
            rules={rules}
            expanded={expanded()}
            onToggle={() => setExpanded((value) => !value)}
          />
        )}
      </Show>

      <div style={{ display: "flex", "justify-content": "flex-end" }}>
        <Button variant="ghost" onClick={props.onBack}>
          {language.t("settings.agentBehaviour.editMode.back")}
        </Button>
      </div>
    </div>
  )
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined
}

/** A text field with a local draft that commits on blur, so a config write happens once and not per keystroke. */
const DraftField: Component<{
  value: () => string
  placeholder: string
  multiline?: boolean
  commit: (value: string) => void
}> = (props) => {
  const [draft, setDraft] = createSignal(props.value())
  createEffect(on(props.value, (value) => setDraft(value), { defer: true }))

  return (
    <TextField
      value={draft()}
      placeholder={props.placeholder}
      multiline={props.multiline}
      onChange={setDraft}
      onBlur={() => {
        if (draft() !== props.value()) props.commit(draft())
      }}
    />
  )
}

const Ruleset: Component<{
  agent: string
  rules: PermissionRule[]
  expanded: boolean
  onToggle: () => void
}> = (props) => {
  const language = useLanguage()
  const [copied, setCopied] = createSignal(false)
  const rows = createMemo(() => permissionRows(props.rules))
  const summary = createMemo(() => permissionSummary(rows()))

  const copy = (event: MouseEvent) => {
    event.stopPropagation()
    void navigator.clipboard.writeText(JSON.stringify({ agent: props.agent, rules: props.rules }, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Card style={{ "margin-bottom": "12px" }}>
      <div
        style={{ display: "flex", "align-items": "center", cursor: "pointer", "user-select": "none" }}
        onClick={props.onToggle}
      >
        <IconButton
          size="small"
          variant="ghost"
          icon={props.expanded ? "chevron-down" : "chevron-right"}
          onClick={(event: MouseEvent) => {
            event.stopPropagation()
            props.onToggle()
          }}
        />
        <span data-slot="settings-row-label-title" style={{ "margin-left": "4px" }}>
          {language.t("settings.agentBehaviour.permissions.title")}
        </span>
        <span
          style={{
            "margin-left": "8px",
            "font-size": "var(--kilo-font-size-11)",
            color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
          }}
        >
          {language.t("settings.agentBehaviour.permissions.count", { count: String(props.rules.length) })}
        </span>
        <div style={{ "margin-left": "auto" }}>
          <IconButton
            size="small"
            variant="ghost"
            icon={copied() ? "check" : "copy"}
            title={language.t("settings.agentBehaviour.permissions.copy")}
            onClick={copy}
          />
        </div>
      </div>

      <Show when={props.expanded}>
        <Show when={summary().length > 0}>
          <div style={{ "margin-top": "8px", "margin-bottom": "8px" }}>
            <div
              style={{
                "font-size": "var(--kilo-font-size-11)",
                color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                "margin-bottom": "4px",
              }}
            >
              {language.t("settings.agentBehaviour.permissions.effective")}
            </div>
            <div style={{ display: "flex", "flex-wrap": "wrap", gap: "4px" }}>
              <For each={summary()}>
                {([tool, action]) => {
                  const colors = ACTION_COLORS[action] ?? ACTION_COLORS.unknown
                  return (
                    <span
                      style={{
                        "font-size": "var(--kilo-font-size-11)",
                        padding: "2px 6px",
                        "border-radius": "3px",
                        background: colors.bg,
                        color: colors.fg,
                        "font-family": "var(--vscode-editor-font-family, monospace)",
                      }}
                    >
                      {tool}: {action}
                    </span>
                  )
                }}
              </For>
            </div>
          </div>
        </Show>

        <div
          style={{
            "margin-top": "8px",
            "font-size": "var(--kilo-font-size-11)",
            "font-family": "var(--vscode-editor-font-family, monospace)",
            "max-height": "300px",
            "overflow-y": "auto",
            border: "1px solid var(--border-weak-base, var(--vscode-panel-border))",
            "border-radius": "4px",
          }}
        >
          <table style={{ width: "100%", "border-collapse": "collapse" }}>
            <thead>
              <tr style={{ background: "var(--bg-subtle-base, var(--vscode-editorWidget-background))", position: "sticky", top: "0" }}>
                <th style={{ padding: "4px 8px", "text-align": "left", "font-weight": "600" }}>
                  {language.t("settings.agentBehaviour.permissions.col.tool")}
                </th>
                <th style={{ padding: "4px 8px", "text-align": "left", "font-weight": "600" }}>
                  {language.t("settings.agentBehaviour.permissions.col.pattern")}
                </th>
                <th style={{ padding: "4px 8px", "text-align": "left", "font-weight": "600" }}>
                  {language.t("settings.agentBehaviour.permissions.col.action")}
                </th>
              </tr>
            </thead>
            <tbody>
              <For each={rows()}>
                {(rule, index) => {
                  const colors = ACTION_COLORS[rule.action] ?? ACTION_COLORS.unknown
                  return (
                    <tr
                      style={{
                        "border-top": index() > 0 ? "1px solid var(--border-weak-base, var(--vscode-panel-border))" : "none",
                      }}
                    >
                      <td style={{ padding: "3px 8px" }}>{rule.tool}</td>
                      <td style={{ padding: "3px 8px", color: "var(--text-weak-base)" }}>{rule.pattern}</td>
                      <td style={{ padding: "3px 8px" }}>
                        <span style={{ padding: "1px 4px", "border-radius": "2px", background: colors.bg, color: colors.fg }}>
                          {rule.action}
                        </span>
                      </td>
                    </tr>
                  )
                }}
              </For>
            </tbody>
          </table>
        </div>

        <div
          style={{
            "margin-top": "6px",
            "font-size": "var(--kilo-font-size-10)",
            color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
          }}
        >
          {language.t("settings.agentBehaviour.permissions.hint")}
        </div>
      </Show>
    </Card>
  )
}

export default ModeEditView
