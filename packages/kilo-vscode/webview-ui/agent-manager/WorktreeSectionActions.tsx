/** @jsxImportSource solid-js */

import type { Accessor, Component } from "solid-js"
import { Show } from "solid-js"
import { DropdownMenu } from "@kilocode/kilo-ui/dropdown-menu"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { TooltipKeybind } from "@kilocode/kilo-ui/tooltip"
import type { LanguageContextValue } from "../src/context/language"
import { parseBindingTokens } from "./keybind-tokens"
import { SidebarSearchMenu, type SidebarSearchMenuRef } from "./SidebarSearchMenu"
import type { SidebarSearchItem } from "./sidebar-search"

interface WorktreeSectionActionsProps {
  items: Accessor<SidebarSearchItem[]>
  current: Accessor<SidebarSearchItem | undefined>
  bindings: Record<string, string>
  branch: string
  git: boolean
  loaded: boolean
  t: LanguageContextValue["t"]
  onRef: (ref: SidebarSearchMenuRef) => void
  onSelect: (item: SidebarSearchItem) => void
  onCreate: () => void
  onNew: () => void
  onSection: () => void
  onShortcuts: () => void
  onSetup: () => void
  onBranch: () => void
  /** When supplied, render an "Add project" item in the settings menu —
   *  used to expose the global Add Project action for users with 0 or 1
   *  registered projects where the global toolbar is hidden. */
  onAddProject?: () => void
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
        waiting: props.t("agentManager.tabsMenu.status.waiting"),
        retry: props.t("agentManager.tabsMenu.status.retry"),
      }}
      onSelect={props.onSelect}
    />
    <Show when={props.git}>
      <div class="am-split-button">
        <TooltipKeybind
          title={props.t("agentManager.shortcuts.advancedWorktree")}
          keybind={props.bindings.newWorktree ?? ""}
        >
          <IconButton
            icon="plus"
            size="small"
            variant="ghost"
            label={props.t("agentManager.worktree.new")}
            onClick={props.onNew}
            disabled={!props.loaded}
          />
        </TooltipKeybind>
        <DropdownMenu gutter={4} placement="bottom-end">
          <DropdownMenu.Trigger
            class="am-split-arrow"
            aria-label={props.t("agentManager.worktree.advancedOptions")}
            disabled={!props.loaded}
          >
            <Icon name="chevron-down" size="small" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content class="am-split-menu">
              <DropdownMenu.Item onSelect={props.onCreate}>
                <span class="am-worktree-menu-gap" aria-hidden="true" />
                <DropdownMenu.ItemLabel class="am-worktree-menu-label">
                  <span>{props.t("sidebar.session.newWorktree.from")}</span>
                  <span class="am-worktree-menu-branch">
                    <Icon name="branch" size="small" />
                    <strong>{props.branch}</strong>
                  </span>
                </DropdownMenu.ItemLabel>
                <span class="am-menu-shortcut">
                  {parseBindingTokens(props.bindings.quickWorktree ?? "").map((token) => (
                    <kbd class="am-menu-key">{token}</kbd>
                  ))}
                </span>
              </DropdownMenu.Item>
              <DropdownMenu.Separator />
              <DropdownMenu.Item onSelect={props.onSection}>
                <Icon name="plus" size="small" />
                <DropdownMenu.ItemLabel>{props.t("agentManager.worktree.newSection")}</DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu>
      </div>
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
      <DropdownMenu gutter={4} placement="bottom-end">
        <DropdownMenu.Trigger
          as={IconButton}
          icon="settings-gear"
          size="small"
          variant="ghost"
          label={props.t("agentManager.worktree.settings")}
        />
        <DropdownMenu.Portal>
          <DropdownMenu.Content class="am-split-menu">
            <Show when={props.onAddProject}>
              <DropdownMenu.Item onSelect={() => props.onAddProject?.()}>
                <Icon name="repo" size="small" />
                <DropdownMenu.ItemLabel>{props.t("agentManager.project.add")}</DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
              <DropdownMenu.Separator />
            </Show>
            <DropdownMenu.Item onSelect={props.onSetup}>
              <DropdownMenu.ItemLabel>{props.t("agentManager.worktree.setupScript")}</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item onSelect={props.onBranch}>
              <DropdownMenu.ItemLabel>
                {props.t("agentManager.worktree.defaultBaseBranch")}: {props.branch}
              </DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </Show>
  </div>
)
