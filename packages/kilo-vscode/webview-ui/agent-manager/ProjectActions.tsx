/** @jsxImportSource solid-js */

import type { Component } from "solid-js"
import { DropdownMenu } from "@kilocode/kilo-ui/dropdown-menu"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { TooltipKeybind } from "@kilocode/kilo-ui/tooltip"
import type { LanguageContextValue } from "../src/context/language"
import { parseBindingTokens } from "./keybind-tokens"

export interface WorktreeCreateProps {
  branch: string
  bindings: Record<string, string>
  loaded: boolean
  t: LanguageContextValue["t"]
  onCreate: () => void
  onNew: () => void
  onSection: () => void
}

export const WorktreeCreate: Component<WorktreeCreateProps> = (props) => (
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
        as={IconButton}
        icon="chevron-down"
        size="small"
        variant="ghost"
        class="am-split-arrow"
        aria-label={props.t("agentManager.worktree.advancedOptions")}
        disabled={!props.loaded}
      />
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
)

export const ProjectActions: Component<WorktreeCreateProps & { onSettings: () => void }> = (props) => (
  <div class="am-project-actions">
    <WorktreeCreate {...props} />
    <IconButton
      icon="settings-gear"
      size="small"
      variant="ghost"
      label={props.t("agentManager.worktree.settings")}
      onClick={props.onSettings}
    />
  </div>
)
