/** @jsxImportSource solid-js */

import { Show, type Component } from "solid-js"
import { DropdownMenu } from "@kilocode/kilo-ui/dropdown-menu"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { WorktreeCreate, type WorktreeCreateProps } from "./ProjectActions"

interface Props extends WorktreeCreateProps {
  pinned: boolean
  onHistory: () => void
  onSettings: () => void
  onRemove: () => void
}

/**
 * Sticky project row actions: the new-worktree split control plus an overflow
 * menu for the low-frequency project actions. Clicks stay off the row toggle so
 * the plus opens the dialog without expanding a collapsed project.
 */
export const ProjectRowActions: Component<Props> = (props) => (
  <div class="am-project-actions-row" onClick={(event) => event.stopPropagation()}>
    <WorktreeCreate
      branch={props.branch}
      bindings={props.bindings}
      loaded={props.loaded}
      t={props.t}
      onCreate={props.onCreate}
      onNew={props.onNew}
      onSection={props.onSection}
    />
    <DropdownMenu gutter={4} placement="bottom-end">
      <DropdownMenu.Trigger
        as={IconButton}
        icon="dot-grid"
        size="small"
        variant="ghost"
        aria-label={props.t("agentManager.project.more")}
      />
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="am-project-menu">
          <DropdownMenu.Item onSelect={props.onHistory}>
            <Icon name="history" size="small" />
            <DropdownMenu.ItemLabel>{props.t("session.showHistory")}</DropdownMenu.ItemLabel>
          </DropdownMenu.Item>
          <DropdownMenu.Item onSelect={props.onSettings}>
            <Icon name="settings-gear" size="small" />
            <DropdownMenu.ItemLabel>{props.t("agentManager.project.settings")}</DropdownMenu.ItemLabel>
          </DropdownMenu.Item>
          <Show when={!props.pinned}>
            <DropdownMenu.Separator />
            <DropdownMenu.Item onSelect={props.onRemove}>
              <Icon name="close-small" size="small" />
              <DropdownMenu.ItemLabel>{props.t("agentManager.project.remove")}</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
          </Show>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  </div>
)
