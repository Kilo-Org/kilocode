/**
 * SidebarTopBar component
 *
 * Renders the primary navigation actions (New Task, History, Agent Manager,
 * KiloClaw, Marketplace, Profile, Settings) inside the webview itself.
 *
 * VS Code contributes a native `view/title` toolbar for webview views, but
 * that toolbar is rendered by the VS Code shell outside the webview's DOM —
 * when the sidebar is moved into the Secondary Side Bar (or otherwise
 * docked somewhere VS Code decides not to show title actions), the toolbar
 * disappears entirely and there is no API to detect or work around that
 * from inside the webview. Rendering these actions here instead guarantees
 * they are always available no matter where the view is docked.
 */

import { Component, For } from "solid-js"
import { IconButton, IconButtonProps } from "@kilocode/kilo-ui/icon-button"
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
  icon: IconButtonProps["icon"]
  button: string
  run: () => void
}

export const SidebarTopBar: Component<SidebarTopBarProps> = (props) => {
  const vscode = useVSCode()
  const language = useLanguage()

  // Mirrors the telemetry the native `view/title` toolbar buttons used to
  // record before this bar replaced them (see kilo-code.new.sidebarTitle.*
  // history in extension.ts), so button-usage analytics aren't silently lost.
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
    { key: "newTask", icon: "plus", button: "new_task", run: props.onNewTask },
    { key: "history", icon: "history", button: "history", run: props.onHistory },
    { key: "agentManager", icon: "layers", button: "agent_manager", run: () => open("openAgentManager") },
    { key: "kiloClaw", icon: "comment", button: "kiloclaw", run: () => open("openKiloClaw") },
    { key: "marketplace", icon: "providers", button: "marketplace", run: () => open("openMarketplacePanel") },
    "spacer",
    { key: "profile", icon: "status", button: "profile", run: () => open("openProfilePanel") },
    { key: "settings", icon: "settings-gear", button: "settings", run: () => open("openSettingsPanel") },
  ]

  return (
    <div class="sidebar-top-bar" role="toolbar" aria-label={language.t("sidebar.topBar.label")}>
      <For each={actions}>
        {(action) => {
          if (action === "spacer") return <div class="sidebar-top-bar-spacer" />
          const label = language.t(`sidebar.topBar.${action.key}`)
          return (
            <Tooltip value={label} placement="bottom">
              <IconButton
                variant="ghost"
                size="small"
                icon={action.icon}
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
