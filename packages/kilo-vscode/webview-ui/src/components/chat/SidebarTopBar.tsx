/**
 * Renders New Task, History, Agent Manager, KiloClaw, Marketplace, Profile, and
 * Settings inside the webview, as a fallback for Cursor only (see isCursorHost()
 * in src/utils.ts). Cursor's Secondary Side Bar support is unreliable for
 * extension-contributed `view/title` toolbars, which render outside the webview
 * DOM with no API to detect or work around the failure. Real VS Code renders the
 * native toolbar fine everywhere, so it keeps using that instead of this bar.
 */

import { Component, For } from "solid-js"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useVSCode } from "../../context/vscode"
import { useLanguage } from "../../context/language"
import { TelemetryEventName } from "../../../../src/services/telemetry/types"

export interface SidebarTopBarProps {
  onNewTask: () => void
  onHistory: () => void
  /** Telemetry surface — distinguishes the sidebar from the "Open in Tab" panel, which shares this component. */
  surface: string
}

interface Action {
  key: string
  icon: "plus" | "history" | "organization" | "comment" | "extensions" | "user" | "settings-gear"
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

  const actions: Action[] = [
    { key: "newTask", icon: "plus", button: "new_task", run: () => props.onNewTask() },
    { key: "history", icon: "history", button: "history", run: () => props.onHistory() },
    { key: "agentManager", icon: "organization", button: "agent_manager", run: () => open("openAgentManager") },
    { key: "kiloClaw", icon: "comment", button: "kiloclaw", run: () => open("openKiloClaw") },
    { key: "marketplace", icon: "extensions", button: "marketplace", run: () => open("openMarketplacePanel") },
    { key: "profile", icon: "user", button: "profile", run: () => open("openProfilePanel") },
    { key: "settings", icon: "settings-gear", button: "settings", run: () => open("openSettingsPanel") },
  ]

  return (
    <div class="sidebar-top-bar" role="toolbar" aria-label={language.t("sidebar.topBar.label")}>
      <For each={actions}>
        {(action) => {
          const label = language.t(`sidebar.topBar.${action.key}`)
          return (
            <Tooltip value={label} placement="bottom">
              <IconButton
                icon={action.icon}
                variant="ghost"
                size="small"
                aria-label={label}
                onClick={() => {
                  track(action.button)
                  action.run()
                }}
              />
            </Tooltip>
          )
        }}
      </For>
    </div>
  )
}
