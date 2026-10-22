/**
 * Renders New Task, History, and Profile inside the webview,
 * as a fallback for Cursor only (see isCursorHost()
 * in src/utils.ts). Cursor's Secondary Side Bar support is unreliable for
 * extension-contributed `view/title` toolbars, which render outside the webview
 * DOM with no API to detect or work around the failure. Real VS Code renders the
 * native toolbar fine everywhere, so it keeps using that instead of this bar.
 */

import { Component, For } from "solid-js"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useLanguage } from "../../context/language"

export interface SidebarTopBarProps {
  onNewTask: () => void
  onHistory: () => void
}

interface Action {
  key: string
  icon: "plus" | "history" | "user"
  run: () => void
}

export const SidebarTopBar: Component<SidebarTopBarProps> = (props) => {
  const language = useLanguage()

  const actions: Action[] = [
    { key: "newTask", icon: "plus", run: () => props.onNewTask() },
    { key: "history", icon: "history", run: () => props.onHistory() },
    {
      key: "profile",
      icon: "user",
      run: () => window.postMessage({ type: "navigate", view: "profile" }, window.origin),
    },
  ]

  return (
    <div class="sidebar-top-bar" role="toolbar" aria-label={language.t("sidebar.topBar.label")}>
      <For each={actions}>
        {(action) => {
          const label = language.t(`sidebar.topBar.${action.key}`)
          return (
            <Tooltip value={label} placement="bottom">
              <IconButton icon={action.icon} variant="ghost" size="small" aria-label={label} onClick={action.run} />
            </Tooltip>
          )
        }}
      </For>
    </div>
  )
}
