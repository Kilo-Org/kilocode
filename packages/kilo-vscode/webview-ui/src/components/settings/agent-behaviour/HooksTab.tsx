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
import type { ClaudeHooksLoadedMessage, ExtensionMessage, HookEvent, HooksConfig } from "../../../types/messages"
import { configMessage } from "../../../utils/open-config"
import {
  EVENT_LABELS,
  HOOK_EVENTS,
  entries,
  inherited,
  matcherKind,
  patch,
  remove,
  save,
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
const mono = { "font-family": "var(--vscode-editor-font-family, monospace)", "font-size": "var(--kilo-font-size-12)" }

const HooksTab: Component<Props> = (props) => {
  const language = useLanguage()
  const vscode = useVSCode()
  const dialog = useDialog()
  const { config, globalConfig, savedGlobalConfig, updateGlobalConfig } = useConfig()
  const [editing, setEditing] = createSignal<{ entry?: HookEntry; event: HookEvent }>()
  const [claude, setClaude] = createSignal<ClaudeHooksLoadedMessage>()

  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type === "claudeHooksLoaded") setClaude(message)
    // Refresh after config changes, and once the backend connects if the first request found none.
    if (message.type === "agentBehaviourInvalidated") vscode.postMessage({ type: "requestClaudeHooks" })
    if (message.type === "connectionState" && message.state === "connected" && !claude())
      vscode.postMessage({ type: "requestClaudeHooks" })
  })
  onCleanup(unsubscribe)
  vscode.postMessage({ type: "requestClaudeHooks" })

  const own = () => globalConfig().hooks
  // The editor targets a hook by position; if the hooks change under it (Discard, a reload), close it.
  createEffect(
    on(
      () => JSON.stringify(own() ?? {}),
      () => setEditing(undefined),
      { defer: true },
    ),
  )
  const others = createMemo(() => inherited(config().hooks, savedGlobalConfig().hooks))
  const claudeStatus = () => {
    const info = claude()
    if (!info) return undefined
    if (info.enabled) return language.t("settings.agentBehaviour.hooks.claude.active", { path: info.path })
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

  const row = (entry: HookEntry, last: boolean, edit?: () => void) => (
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
          <Show
            when={matcherKind(entry.matcher).kind !== "all"}
            fallback={<Tag>{language.t("settings.agentBehaviour.hooks.allTools")}</Tag>}
          >
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
            title={[entry.handler.command, ...(entry.handler.args ?? [])].join(" ")}
            style={{ ...mono, overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}
          >
            {[entry.handler.command, ...(entry.handler.args ?? [])].join(" ")}
          </span>
        </div>
        <Show when={entry.handler.timeout || entry.handler.onFailure || entry.handler.args}>
          <div style={{ ...weak, display: "flex", gap: "8px", "flex-wrap": "wrap", "margin-top": "2px" }}>
            <Show when={entry.handler.timeout}>
              {(seconds) => (
                <span>{language.t("settings.agentBehaviour.hooks.badge.timeout", { seconds: seconds() })}</span>
              )}
            </Show>
            <Show when={entry.handler.onFailure === "block"}>
              <span>{language.t("settings.agentBehaviour.hooks.badge.block")}</span>
            </Show>
            <Show when={entry.handler.args}>
              <span>{language.t("settings.agentBehaviour.hooks.badge.exec")}</span>
            </Show>
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

  const readonly = (hooks: HooksConfig | undefined) => (
    <For each={HOOK_EVENTS.filter((event) => entries(hooks, event).length > 0)}>
      {(event) => (
        <div style={{ "margin-bottom": "4px" }}>
          <div style={{ ...weak, "font-weight": "500", "margin-top": "4px" }}>
            {language.t(EVENT_LABELS[event].label)}
          </div>
          <For each={entries(hooks, event)}>
            {(entry, index) => row(entry, index() === entries(hooks, event).length - 1)}
          </For>
        </div>
      )}
    </For>
  )

  const list = () => (
    <div>
      <div style={{ ...weak, "margin-bottom": "12px" }}>{language.t("settings.agentBehaviour.hooks.description")}</div>

      <Card style={{ "margin-bottom": "16px" }}>
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
              variant="ghost"
              size="small"
              onClick={() => vscode.postMessage({ type: "openExternal", url: "https://kilo.ai/docs/customize/hooks" })}
            >
              {language.t("settings.agentBehaviour.hooks.docs")}
            </Button>
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

      <For each={HOOK_EVENTS}>
        {(event) => {
          const items = createMemo(() => entries(own(), event))
          return (
            <div style={{ "margin-bottom": "16px" }}>
              <div
                style={{
                  display: "flex",
                  "align-items": "center",
                  "justify-content": "space-between",
                  "margin-bottom": "4px",
                }}
              >
                <h4 style={{ margin: 0 }}>{language.t(EVENT_LABELS[event].label)}</h4>
                <Button variant="ghost" size="small" icon="plus-small" onClick={() => setEditing({ event })}>
                  {language.t("settings.agentBehaviour.hooks.add")}
                </Button>
              </div>
              <div style={{ ...weak, "margin-bottom": "8px" }}>{language.t(EVENT_LABELS[event].help)}</div>
              <Card>
                <Show
                  when={items().length > 0}
                  fallback={<div style={weak}>{language.t("settings.agentBehaviour.hooks.empty")}</div>}
                >
                  <For each={items()}>
                    {(entry, index) =>
                      row(entry, index() === items().length - 1, () => setEditing({ entry, event: entry.event }))
                    }
                  </For>
                </Show>
              </Card>
            </div>
          )
        }}
      </For>

      <Show when={HOOK_EVENTS.some((event) => entries(others(), event).length > 0)}>
        <div style={{ "margin-bottom": "16px" }}>
          <h4 style={{ margin: "0 0 4px" }}>{language.t("settings.agentBehaviour.hooks.inherited")}</h4>
          <div style={{ ...weak, "margin-bottom": "8px" }}>
            {language.t("settings.agentBehaviour.hooks.inherited.help")}
          </div>
          <Card>{readonly(others())}</Card>
        </div>
      </Show>

      <Show when={claude()?.hooks && HOOK_EVENTS.some((event) => entries(claude()?.hooks, event).length > 0)}>
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
          <Card>{readonly(claude()?.hooks)}</Card>
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
