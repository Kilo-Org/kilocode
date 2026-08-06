/**
 * Renders New Task, History, Agent Manager, KiloClaw, Marketplace, Profile, and
 * Settings inside the webview. VS Code's native `view/title` toolbar renders
 * outside the webview DOM and disappears in the Secondary Side Bar with no way
 * to detect or work around that — this bar guarantees the actions stay visible.
 */

import { Component, For } from "solid-js"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useVSCode } from "../../context/vscode"
import { useLanguage } from "../../context/language"
import { TelemetryEventName } from "../../../../src/services/telemetry/types"
import "@vscode/codicons/dist/codicon.css"

export interface SidebarTopBarProps {
  onNewTask: () => void
  onHistory: () => void
  /** Telemetry surface — distinguishes the sidebar from the "Open in Tab" panel, which shares this component. */
  surface: string
}

/** Codicon names used below. */
type Codicon = "add" | "history" | "organization" | "comment-discussion" | "extensions" | "account" | "settings-gear"

interface Action {
  key: string
  codicon: Codicon
  button: string
  run: () => void
}

export const SidebarTopBar: Component<SidebarTopBarProps> = (props) => {
  const vscode = useVSCode()
  const language = useLanguage()

  // Mirrors the telemetry the native toolbar buttons used to record, so analytics aren't lost.
  const track = (button: string) =>
    vscode.postMessage({
      type: "telemetry",
      event: TelemetryEventName.TITLE_BUTTON_CLICKED,
      properties: { button, surface: props.surface },
    })

  const open = (
    type: "openAgentManager" | "openKiloClaw" | "openMarketplacePanel" | "openProfilePanel" | "openSettingsPanel",
  ) => vscode.postMessage({ type })

  const actions: (Action | "spacer")[] = [
    { key: "newTask", codicon: "add", button: "new_task", run: () => props.onNewTask() },
    { key: "history", codicon: "history", button: "history", run: () => props.onHistory() },
    { key: "agentManager", codicon: "organization", button: "agent_manager", run: () => open("openAgentManager") },
    { key: "kiloClaw", codicon: "comment-discussion", button: "kiloclaw", run: () => open("openKiloClaw") },
    { key: "marketplace", codicon: "extensions", button: "marketplace", run: () => open("openMarketplacePanel") },
    "spacer",
    { key: "profile", codicon: "account", button: "profile", run: () => open("openProfilePanel") },
    { key: "settings", codicon: "settings-gear", button: "settings", run: () => open("openSettingsPanel") },
  ]

  return (
    <div class="sidebar-top-bar" role="toolbar" aria-label={language.t("sidebar.topBar.label")}>
      <For each={actions}>
        {(action) => {
          if (action === "spacer") return <div class="sidebar-top-bar-spacer" />
          const label = language.t(`sidebar.topBar.${action.key}`)
          return (
            <Tooltip value={label} placement="bottom">
              <button
                type="button"
                data-component="icon-button"
                data-variant="ghost"
                data-size="small"
                aria-label={label}
                onClick={() => {
                  track(action.button)
                  action.run()
                }}
              >
                <div data-component="icon" data-size="small">
                  <i class={`codicon codicon-${action.codicon}`} aria-hidden="true" />
                </div>
              </button>
            </Tooltip>
          )
        }}
      </For>
    </div>
  )
}
