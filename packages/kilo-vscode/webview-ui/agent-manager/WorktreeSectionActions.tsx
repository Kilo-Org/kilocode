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
  onAdvanced: () => void
  onSection: () => void
  onShortcuts: () => void
  onSetup: () => void
  onBranch: () => void
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
        <IconButton
          icon="plus"
          size="small"
          variant="ghost"
          label={props.t("agentManager.worktree.new")}
          onClick={props.onCreate}
          disabled={!props.loaded}
        />
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
                  {parseBindingTokens(props.bindings.newWorktree ?? "").map((token) => (
                    <kbd class="am-menu-key">{token}</kbd>
                  ))}
                </span>
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={props.onAdvanced}>
                <Icon name="settings-gear" size="small" />
                <DropdownMenu.ItemLabel>{props.t("agentManager.dialog.configureWorktree")}</DropdownMenu.ItemLabel>
                <span class="am-menu-shortcut">
                  {parseBindingTokens(props.bindings.advancedWorktree ?? "").map((token) => (
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
