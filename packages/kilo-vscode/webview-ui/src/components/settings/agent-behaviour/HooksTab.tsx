import { Component, For, Show, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tag } from "@kilocode/kilo-ui/tag"

import { useConfig } from "../../../context/config"
import { useLanguage } from "../../../context/language"
import { useVSCode } from "../../../context/vscode"
import type { ExtensionMessage, HookEvent, HooksConfig, HooksInfoLoadedMessage } from "../../../types/messages"
import { configMessage } from "../../../utils/open-config"
import {
  GROUP_LABELS,
  HOOK_INFO,
  blocking,
  entries,
  inherited,
  matcherKind,
  patch,
  remove,
  save,
  sections,
  skipped,
  unknown,
  type HookEntry,
} from "../hooks-config"
import HookEditView from "./HookEditView"

interface Props {
  /** The Claude Code compatibility setting, which decides whether ~/.claude/settings.json hooks run. */
  claude: boolean
}

const weak = {
  "font-size": "var(--kilo-font-size-12)",
  color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
  "line-height": "1.5",
}
const warning = {
  "font-size": "var(--kilo-font-size-12)",
  color: "var(--vscode-editorWarning-foreground, #cca700)",
  "margin-top": "2px",
}
const mono = { "font-family": "var(--vscode-editor-font-family, monospace)", "font-size": "var(--kilo-font-size-12)" }

const HooksTab: Component<Props> = (props) => {
  const language = useLanguage()
  const vscode = useVSCode()
  const dialog = useDialog()
  const { config, globalConfig, savedGlobalConfig, updateGlobalConfig } = useConfig()
  const [editing, setEditing] = createSignal<{ entry?: HookEntry; event: HookEvent }>()
  const [info, setInfo] = createSignal<HooksInfoLoadedMessage>()
  const claude = () => info()?.claude

  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type === "hooksInfoLoaded") setInfo(message)
    // Refresh after config changes, and once the backend connects if the first request found none.
    if (message.type === "agentBehaviourInvalidated") vscode.postMessage({ type: "requestHooksInfo" })
    if (message.type === "connectionState" && message.state === "connected" && !info())
      vscode.postMessage({ type: "requestHooksInfo" })
  })
  onCleanup(unsubscribe)
  vscode.postMessage({ type: "requestHooksInfo" })

  const own = () => globalConfig().hooks
  // The editor targets a hook by position; if the hooks change under it (Discard, a reload), close it.
  createEffect(
    on(
      () => JSON.stringify(own() ?? {}),
      () => setEditing(undefined),
      { defer: true },
    ),
  )
  const mine = createMemo(() => sections(own()))
  const others = createMemo(() => inherited(config().hooks, savedGlobalConfig().hooks))
  const imported = createMemo(() => sections(claude()?.hooks))
  const ignored = createMemo(() => skipped(claude()?.skipped))
  const claudeStatus = () => {
    const data = claude()
    if (!data) return undefined
    if (data.enabled) return language.t("settings.agentBehaviour.hooks.claude.active", { path: data.path })
    if (props.claude) return language.t("settings.agentBehaviour.hooks.claude.restart")
    return language.t("settings.agentBehaviour.hooks.claude.off")
  }

  const confirmRemove = (entry: HookEntry) => {
    dialog.show(() => (
      <Dialog title={language.t("settings.agentBehaviour.hooks.remove.heading")} fit>
        <div class="dialog-confirm-body">
          <span>{language.t("settings.agentBehaviour.hooks.remove.confirm", { command: entry.handler.command })}</span>
          <div class="dialog-confirm-actions">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="large"
              onClick={() => {
                dialog.close()
                setTimeout(() => {
                  updateGlobalConfig(patch(own(), remove(own(), entry)))
                  setEditing(undefined)
                }, 150)
              }}
            >
              {language.t("settings.agentBehaviour.hooks.remove.button")}
            </Button>
          </div>
        </div>
      </Dialog>
    ))
  }

  const row = (entry: HookEntry, last: boolean, edit?: () => void) => {
    const kind = matcherKind(entry.matcher, entry.event).kind
    const line = [entry.handler.command, ...(entry.handler.args ?? [])].join(" ")
    return (
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          padding: "8px 0",
          "border-bottom": last ? "none" : "1px solid var(--border-weak-base)",
          cursor: edit ? "pointer" : "default",
        }}
        onClick={() => edit?.()}
      >
        <div style={{ flex: 1, "min-width": 0 }}>
          <div style={{ display: "flex", "align-items": "center", gap: "6px", "min-width": 0 }}>
            <Show when={kind === "all"}>
              <Tag>{language.t("settings.agentBehaviour.hooks.allTools")}</Tag>
            </Show>
            <Show when={kind !== "all" && kind !== "none" && kind !== "dynamic"}>
              <span
                title={entry.matcher}
                style={{
                  ...mono,
                  "font-weight": "600",
                  overflow: "hidden",
                  "text-overflow": "ellipsis",
                  "white-space": "nowrap",
                  "max-width": "40%",
                  "flex-shrink": 0,
                }}
              >
                {entry.matcher}
              </span>
            </Show>
            <span
              title={line}
              style={{ ...mono, overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}
            >
              {line}
            </span>
          </div>
          <Show when={kind === "dynamic"}>
            <div style={weak}>{language.t("settings.agentBehaviour.hooks.matcher.filesNone")}</div>
          </Show>
          <Show when={unknown(entry.matcher, info()?.tools, entry.event).join(", ")}>
            {(names) => (
              <div style={warning}>{language.t("settings.agentBehaviour.hooks.unmatched", { names: names() })}</div>
            )}
          </Show>
          <Show
            when={
              entry.handler.timeout ||
              blocking(entry) ||
              entry.handler.args ||
              entry.handler.async ||
              entry.handler.if ||
              entry.handler.shell
            }
          >
            <div style={{ ...weak, display: "flex", gap: "8px", "flex-wrap": "wrap", "margin-top": "2px" }}>
              <Show when={entry.handler.timeout}>
                {(seconds) => (
                  <span>{language.t("settings.agentBehaviour.hooks.badge.timeout", { seconds: seconds() })}</span>
                )}
              </Show>
              {/* Only where the CLI honors it: an event that allows it, not in the background. */}
              <Show when={blocking(entry)}>
                <span>{language.t("settings.agentBehaviour.hooks.badge.block")}</span>
              </Show>
              <Show when={entry.handler.async}>
                <span>{language.t("settings.agentBehaviour.hooks.badge.async")}</span>
              </Show>
              <Show when={entry.handler.args}>
                <span>{language.t("settings.agentBehaviour.hooks.badge.exec")}</span>
              </Show>
              {/* Raw config values: the condition and shell the CLI applies, shown as written. */}
              <Show when={entry.handler.if}>{(rule) => <span style={mono}>if: {rule()}</span>}</Show>
              <Show when={entry.handler.shell}>{(shell) => <span style={mono}>shell: {shell()}</span>}</Show>
            </div>
          </Show>
        </div>
        <Show when={edit}>
          <IconButton
            size="small"
            variant="ghost"
            icon="close"
            onClick={(e: MouseEvent) => {
              e.stopPropagation()
              confirmRemove(entry)
            }}
          />
          <IconButton
            size="small"
            variant="ghost"
            icon="chevron-right"
            onClick={(e: MouseEvent) => {
              e.stopPropagation()
              edit?.()
            }}
          />
        </Show>
      </div>
    )
  }

  // One event: its raw id (the config key), a "Kilo only" badge, its help line, then its hooks.
  const segment = (hooks: HooksConfig | null | undefined, event: HookEvent, editable: boolean) => {
    const items = entries(hooks, event)
    const list = () => (
      <For each={items}>
        {(entry, index) =>
          row(
            entry,
            index() === items.length - 1,
            editable ? () => setEditing({ entry, event: entry.event }) : undefined,
          )
        }
      </For>
    )
    return (
      <div style={{ "margin-bottom": editable ? "12px" : "4px" }}>
        <div style={{ display: "flex", "align-items": "center", gap: "6px", "margin-top": editable ? "0" : "6px" }}>
          <span style={{ ...mono, "font-weight": "600" }}>{event}</span>
          <Show when={HOOK_INFO[event].kilo}>
            <Tag>{language.t("settings.agentBehaviour.hooks.kiloOnly")}</Tag>
          </Show>
        </div>
        <Show when={editable}>
          <div style={{ ...weak, "margin-bottom": "6px" }}>{language.t(HOOK_INFO[event].help)}</div>
        </Show>
        <Show when={editable} fallback={list()}>
          <Card>{list()}</Card>
        </Show>
      </div>
    )
  }

  const grouped = (hooks: HooksConfig | null | undefined, editable: boolean) => (
    <For each={sections(hooks)}>
      {(section) => (
        <div style={{ "margin-bottom": editable ? "8px" : "0" }}>
          <Show
            when={editable}
            fallback={
              <div style={{ ...weak, "font-weight": "500", "margin-top": "4px" }}>
                {language.t(GROUP_LABELS[section.group])}
              </div>
            }
          >
            <h4 style={{ margin: "0 0 8px" }}>{language.t(GROUP_LABELS[section.group])}</h4>
          </Show>
          <For each={section.events}>{(event) => segment(hooks, event, editable)}</For>
        </div>
      )}
    </For>
  )

  const list = () => (
    <div>
      <div style={{ ...weak, "margin-bottom": "12px" }}>{language.t("settings.agentBehaviour.hooks.description")}</div>

      <Card style={{ "margin-bottom": "12px" }}>
        <div
          style={{
            "font-size": "var(--kilo-font-size-12)",
            "line-height": "1.5",
            "border-left": "3px solid var(--vscode-editorWarning-foreground, #cca700)",
            "padding-left": "8px",
            "margin-bottom": "8px",
          }}
        >
          {language.t("settings.agentBehaviour.hooks.warning")}
        </div>
        <div
          style={{
            display: "flex",
            "flex-wrap": "wrap",
            "align-items": "center",
            "justify-content": "space-between",
            gap: "4px 8px",
          }}
        >
          <span style={weak}>{language.t("settings.agentBehaviour.hooks.scope")}</span>
          <div style={{ display: "flex", gap: "4px", "margin-left": "auto" }}>
            <Button
              variant="secondary"
              size="small"
              onClick={() => vscode.postMessage(configMessage("global", language.t))}
            >
              {language.t("settings.agentBehaviour.hooks.openConfig")}
            </Button>
          </div>
        </div>
      </Card>

      <div style={{ display: "flex", "justify-content": "flex-end", "margin-bottom": "12px" }}>
        <Button variant="secondary" size="small" icon="plus-small" onClick={() => setEditing({ event: "PreToolUse" })}>
          {language.t("settings.agentBehaviour.hooks.add")}
        </Button>
      </div>

      <Show
        when={mine().length > 0}
        fallback={
          <Card style={{ "margin-bottom": "16px" }}>
            <div style={weak}>{language.t("settings.agentBehaviour.hooks.empty")}</div>
          </Card>
        }
      >
        <div style={{ "margin-bottom": "8px" }}>{grouped(own(), true)}</div>
      </Show>

      <Show when={sections(others()).length > 0}>
        <div style={{ "margin-bottom": "16px" }}>
          <h4 style={{ margin: "0 0 4px" }}>{language.t("settings.agentBehaviour.hooks.inherited")}</h4>
          <div style={{ ...weak, "margin-bottom": "8px" }}>
            {language.t("settings.agentBehaviour.hooks.inherited.help")}
          </div>
          <Card>{grouped(others(), false)}</Card>
        </div>
      </Show>

      <Show when={imported().length > 0 || ignored().length > 0}>
        <div style={{ "margin-bottom": "16px" }}>
          <div
            style={{
              display: "flex",
              "align-items": "center",
              "justify-content": "space-between",
              "margin-bottom": "4px",
            }}
          >
            <h4 style={{ margin: 0 }}>{language.t("settings.agentBehaviour.hooks.claude")}</h4>
            <Button
              variant="ghost"
              size="small"
              onClick={() => {
                const path = claude()?.path
                if (path) vscode.postMessage({ type: "openFile", filePath: path })
              }}
            >
              {language.t("settings.agentBehaviour.hooks.claude.open")}
            </Button>
          </div>
          <div style={{ ...weak, "margin-bottom": "8px" }}>{claudeStatus()}</div>
          <Show when={imported().length > 0}>
            <Card>{grouped(claude()?.hooks, false)}</Card>
          </Show>
          <Show when={ignored().length > 0}>
            <div style={{ ...weak, "margin-top": "8px" }}>
              {language.t("settings.agentBehaviour.hooks.claude.skipped", { items: ignored().join(", ") })}
            </div>
          </Show>
        </div>
      </Show>
    </div>
  )

  return (
    <Show when={editing()} fallback={list()}>
      {(state) => {
        const entry = state().entry
        return (
          <HookEditView
            tools={info()?.tools}
            entry={entry}
            event={state().event}
            onBack={() => setEditing(undefined)}
            onApply={(input) => {
              updateGlobalConfig(patch(own(), save(own(), entry, input)))
              setEditing(undefined)
            }}
            onRemove={entry ? () => confirmRemove(entry) : undefined}
          />
        )
      }}
    </Show>
  )
}

export default HooksTab
