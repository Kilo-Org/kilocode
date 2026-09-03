/** @jsxImportSource solid-js */

import type { Accessor, Component } from "solid-js"
import { Show } from "solid-js"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip, TooltipKeybind } from "@kilocode/kilo-ui/tooltip"
import { WorktreeCreate, type WorktreeCreateProps } from "./ProjectActions"
import { SidebarSearchMenu, type SidebarSearchMenuRef } from "./SidebarSearchMenu"
import type { SidebarSearchItem } from "./sidebar-search"
import { label } from "../src/utils/session-activity"

interface WorktreeSectionActionsProps extends WorktreeCreateProps {
  items: Accessor<SidebarSearchItem[]>
  current: Accessor<SidebarSearchItem | undefined>
  git: boolean
  onRef: (ref: SidebarSearchMenuRef) => void
  onSelect: (item: SidebarSearchItem) => void
  onShortcuts: () => void
  onSettings: () => void
  onHistory: () => void
  onHelp: () => void
}

export const WorktreeSectionActions: Component<WorktreeSectionActionsProps> = (props) => (
  <div class="am-section-actions">
    <SidebarSearchMenu
      ref={props.onRef}
      items={props.items}
      current={props.current}
      keybind={props.bindings.search ?? ""}
      labels={{
        search: props.t("agentManager.sidebarSearch.label"),
        scope: props.t("agentManager.sidebarSearch.scope"),
        sessions: props.t("agentManager.section.sessions"),
        contexts: props.t("agentManager.sidebarSearch.contexts"),
        state: (value) => props.t(label(value)),
      }}
      onSelect={props.onSelect}
    />
    <Show when={props.git}>
      <WorktreeCreate {...props} />
      <TooltipKeybind
        title={props.t("agentManager.shortcuts.title")}
        keybind={props.bindings.showShortcuts ?? ""}
        placement="bottom"
      >
        <IconButton
          icon="keyboard"
          size="small"
          variant="ghost"
          label={props.t("agentManager.shortcuts.title")}
          onClick={props.onShortcuts}
        />
      </TooltipKeybind>
      <Tooltip value={props.t("session.showHistory")} placement="bottom">
        <IconButton
          icon="history"
          size="small"
          variant="ghost"
          aria-label={props.t("session.showHistory")}
          onClick={props.onHistory}
        />
      </Tooltip>
      <Tooltip value={props.t("agentManager.intro.reopen")} placement="bottom">
        <IconButton
          icon="help"
          size="small"
          variant="ghost"
          aria-label={props.t("agentManager.intro.reopen")}
          onClick={props.onHelp}
        />
      </Tooltip>
      <IconButton
        icon="settings-gear"
        size="small"
        variant="ghost"
        label={props.t("agentManager.worktree.settings")}
        onClick={props.onSettings}
      />
    </Show>
  </div>
)
