import { Component, Show, createSignal } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Select } from "@kilocode/kilo-ui/select"
import { Switch } from "@kilocode/kilo-ui/switch"
import { Tag } from "@kilocode/kilo-ui/tag"
import { TextField } from "@kilocode/kilo-ui/text-field"

import { useLanguage } from "../../../context/language"
import type { HookEvent } from "../../../types/messages"
import {
  GROUP_LABELS,
  HOOK_EVENTS,
  HOOK_INFO,
  draft,
  matcher,
  matcherKind,
  timeout,
  unknown,
  validate,
  type HookDraft,
  type HookEntry,
  type HookErrors,
} from "../hooks-config"

interface Props {
  entry?: HookEntry
  event: HookEvent
  onBack: () => void
  onApply: (input: HookDraft) => void
  onRemove?: () => void
  /** Tool names matchers can use, to warn about names no tool answers to. */
  tools?: readonly string[]
}

const error = { color: "var(--vscode-errorForeground)", "font-size": "var(--kilo-font-size-11)", "margin-top": "4px" }
const warning = {
  "font-size": "var(--kilo-font-size-11)",
  color: "var(--vscode-editorWarning-foreground, #cca700)",
  "margin-top": "4px",
}
const hint = {
  "font-size": "var(--kilo-font-size-11)",
  color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
  "margin-top": "4px",
}
const mono = { "font-family": "var(--vscode-editor-font-family, monospace)" }

const HookEditView: Component<Props> = (props) => {
  const language = useLanguage()
  const [form, setForm] = createSignal(draft(props.entry, props.event))
  const [errors, setErrors] = createSignal<HookErrors>({})
  const set = (partial: Partial<HookDraft>) => setForm((prev) => ({ ...prev, ...partial }))

  const info = () => HOOK_INFO[form().event]
  const field = () => matcher(form().event)
  const kind = () => matcherKind(form().matcher, form().event)
  const summary = () => {
    const value = kind()
    if (value.kind === "all") return language.t("settings.agentBehaviour.hooks.matcher.all")
    if (value.kind === "names")
      return language.t("settings.agentBehaviour.hooks.matcher.names", { names: value.names.join(", ") })
    if (value.kind === "files")
      return language.t("settings.agentBehaviour.hooks.matcher.files", { names: value.names.join(", ") })
    if (value.kind === "dynamic") return language.t("settings.agentBehaviour.hooks.matcher.filesNone")
    if (value.kind === "regex") return language.t("settings.agentBehaviour.hooks.matcher.regex")
    return undefined
  }
  const help = () => {
    const value = field()
    if (!value) return undefined
    if ("values" in value) return language.t(value.help, { field: value.field, values: value.values })
    return language.t(value.help, { field: value.field ?? "" })
  }

  const apply = () => {
    const next = validate(form())
    setErrors(next)
    if (Object.keys(next).length > 0) return
    props.onApply(form())
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          "align-items": "center",
          "justify-content": "space-between",
          "margin-bottom": "16px",
        }}
      >
        <div style={{ display: "flex", "align-items": "center" }}>
          <IconButton size="small" variant="ghost" icon="arrow-left" onClick={props.onBack} />
          <span style={{ "font-weight": "600", "font-size": "var(--kilo-font-size-14)", "margin-left": "8px" }}>
            {props.entry
              ? language.t("settings.agentBehaviour.hooks.edit")
              : language.t("settings.agentBehaviour.hooks.new")}
          </span>
        </div>
        <Show when={props.onRemove}>
          {(remove) => <IconButton size="small" variant="ghost" icon="close" onClick={() => remove()()} />}
        </Show>
      </div>

      <Card style={{ "margin-bottom": "12px" }}>
        <div data-slot="settings-row-label-title" style={{ "margin-bottom": "8px" }}>
          {language.t("settings.agentBehaviour.hooks.event")}
        </div>
        <Select
          options={HOOK_EVENTS}
          current={form().event}
          value={(event: HookEvent) => event}
          label={(event: HookEvent) => event}
          groupBy={(event: HookEvent) => language.t(GROUP_LABELS[HOOK_INFO[event].group])}
          onSelect={(event: HookEvent | undefined) => event && set({ event })}
        >
          {(event: HookEvent | undefined) => (
            <Show when={event}>
              {(value) => (
                <span style={{ display: "inline-flex", "align-items": "center", gap: "6px" }}>
                  <span style={mono}>{value()}</span>
                  <Show when={HOOK_INFO[value()].kilo}>
                    <Tag>{language.t("settings.agentBehaviour.hooks.kiloOnly")}</Tag>
                  </Show>
                </span>
              )}
            </Show>
          )}
        </Select>
        <div style={{ display: "flex", "align-items": "center", gap: "6px", "margin-top": "6px" }}>
          <Show when={info().kilo}>
            <Tag>{language.t("settings.agentBehaviour.hooks.kiloOnly")}</Tag>
          </Show>
          <div style={{ ...hint, "margin-top": "0" }}>{language.t(info().help)}</div>
        </div>
        <Show when={!field()}>
          <div style={hint}>{language.t("settings.agentBehaviour.hooks.matcher.none")}</div>
        </Show>
      </Card>

      <Show when={field()}>
        {(value) => (
          <Card style={{ "margin-bottom": "12px" }}>
            <div data-slot="settings-row-label-title" style={{ "margin-bottom": "4px" }}>
              {language.t("settings.agentBehaviour.hooks.matcher")}
            </div>
            <div data-slot="settings-row-label-subtitle" style={{ "margin-bottom": "8px" }}>
              {help()}
            </div>
            <TextField
              value={form().matcher}
              placeholder={value().placeholder}
              onChange={(next) => set({ matcher: next })}
            />
            <Show
              when={kind().kind !== "invalid"}
              fallback={<div style={error}>{language.t("settings.agentBehaviour.hooks.matcher.invalid")}</div>}
            >
              <div style={hint}>{summary()}</div>
              <Show when={unknown(form().matcher, props.tools, form().event).join(", ")}>
                {(names) => (
                  <div style={warning}>{language.t("settings.agentBehaviour.hooks.unmatched", { names: names() })}</div>
                )}
              </Show>
            </Show>
          </Card>
        )}
      </Show>

      <Card style={{ "margin-bottom": "12px" }}>
        <div data-slot="settings-row-label-title" style={{ "margin-bottom": "4px" }}>
          {language.t("settings.agentBehaviour.hooks.command")}
        </div>
        <div data-slot="settings-row-label-subtitle" style={{ "margin-bottom": "8px" }}>
          {language.t("settings.agentBehaviour.hooks.command.help")}
        </div>
        <TextField
          value={form().command}
          placeholder="~/.config/kilo/hooks/lint.sh"
          onChange={(command) => set({ command })}
        />
        <Show when={errors().command}>{(key) => <div style={error}>{language.t(key())}</div>}</Show>
        <div
          style={{
            display: "flex",
            "align-items": "center",
            "justify-content": "space-between",
            gap: "12px",
            "margin-top": "12px",
          }}
        >
          <div>
            <div data-slot="settings-row-label-title">{language.t("settings.agentBehaviour.hooks.exec")}</div>
            <div data-slot="settings-row-label-subtitle">{language.t("settings.agentBehaviour.hooks.exec.help")}</div>
          </div>
          <Switch checked={form().exec} onChange={(exec: boolean) => set({ exec })} hideLabel>
            {language.t("settings.agentBehaviour.hooks.exec")}
          </Switch>
        </div>
        <Show when={form().exec}>
          <div style={{ "margin-top": "8px" }}>
            <TextField
              value={form().args}
              placeholder={language.t("settings.agentBehaviour.hooks.args.placeholder")}
              multiline
              onChange={(args) => set({ args })}
            />
          </div>
        </Show>
      </Card>

      <Card style={{ "margin-bottom": "12px" }}>
        <div data-slot="settings-row-label-title" style={{ "margin-bottom": "4px" }}>
          {language.t("settings.agentBehaviour.hooks.timeout")}
        </div>
        <div data-slot="settings-row-label-subtitle" style={{ "margin-bottom": "8px" }}>
          {language.t("settings.agentBehaviour.hooks.timeout.help", { seconds: timeout(form().event) })}
        </div>
        <TextField
          value={form().timeout}
          placeholder={String(timeout(form().event))}
          onChange={(seconds) => set({ timeout: seconds })}
        />
        <Show when={errors().timeout}>{(key) => <div style={error}>{language.t(key())}</div>}</Show>
      </Card>

      <Card style={{ "margin-bottom": "12px" }}>
        <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", gap: "12px" }}>
          <div>
            <div data-slot="settings-row-label-title">{language.t("settings.agentBehaviour.hooks.async")}</div>
            <div data-slot="settings-row-label-subtitle">{language.t("settings.agentBehaviour.hooks.async.help")}</div>
          </div>
          <Switch checked={form().async} onChange={(async: boolean) => set({ async })} hideLabel>
            {language.t("settings.agentBehaviour.hooks.async")}
          </Switch>
        </div>
        <Show when={form().async && info().decides}>
          <div style={hint}>{language.t("settings.agentBehaviour.hooks.async.noBlock")}</div>
        </Show>
      </Card>

      <Show when={info().failure && !form().async}>
        <Card style={{ "margin-bottom": "12px" }}>
          <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", gap: "12px" }}>
            <div>
              <div data-slot="settings-row-label-title">{language.t("settings.agentBehaviour.hooks.block")}</div>
              <div data-slot="settings-row-label-subtitle">
                {language.t("settings.agentBehaviour.hooks.block.help")}
              </div>
            </div>
            <Switch checked={form().block} onChange={(block: boolean) => set({ block })} hideLabel>
              {language.t("settings.agentBehaviour.hooks.block")}
            </Switch>
          </div>
        </Card>
      </Show>

      <div style={{ display: "flex", "justify-content": "flex-end", gap: "8px" }}>
        <Button variant="ghost" onClick={props.onBack}>
          {language.t("common.cancel")}
        </Button>
        <Button variant="primary" onClick={apply}>
          {language.t("settings.agentBehaviour.hooks.apply")}
        </Button>
      </div>
    </div>
  )
}

export default HookEditView
