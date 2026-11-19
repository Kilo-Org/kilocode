import type { JSX } from "solid-js"
import { Show } from "solid-js"
import { TooltipKeybind } from "@kilocode/kilo-ui/tooltip"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { SidebarToggleButton } from "./SidebarToggleButton"
import { useLanguage } from "../src/context/language"

export function WorkspaceTabBar(props: {
  collapsed: boolean
  toggle: () => void
  add?: JSX.Element
  actions: JSX.Element
  children: JSX.Element
  release?: () => void
}) {
  return (
    <div class="am-tab-bar" onPointerLeave={props.release}>
      <div class="am-tab-leading">
        <SidebarToggleButton collapsed={props.collapsed} onClick={props.toggle} />
      </div>
      {props.children}
      <Show when={props.add}>
        {(add) => (
          <div class="am-tab-add-wrap">
            <div class="am-tab-add-separator" />
            {add()}
          </div>
        )}
      </Show>
      <div class="am-tab-actions">{props.actions}</div>
    </div>
  )
}

export function WorkspaceTerminalButton(props: { active: boolean; keybind: string; open: () => void }) {
  const { t } = useLanguage()
  return (
    <TooltipKeybind title={t("agentManager.tab.terminal")} keybind={props.keybind} placement="bottom" openDelay={0}>
      <IconButton
        icon="console"
        size="small"
        variant="ghost"
        aria-label={t("agentManager.tab.terminal")}
        aria-pressed={props.active}
        data-active={props.active ? "" : undefined}
        onClick={props.open}
      />
    </TooltipKeybind>
  )
}
