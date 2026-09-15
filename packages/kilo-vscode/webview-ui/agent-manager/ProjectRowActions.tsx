/** @jsxImportSource solid-js */

import { Show, type Component } from "solid-js"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { WorktreeCreate, type WorktreeCreateProps } from "./ProjectActions"

interface Props extends Omit<WorktreeCreateProps, "loaded"> {
  pinned: boolean
  onHistory: () => void
  onSettings: () => void
  onRemove: () => void
}

/**
 * Project row actions: the new-worktree split control plus the individual
 * project actions. Clicks stay off the row toggle so the plus opens the dialog
 * without expanding a collapsed project. The control is not gated on the
 * project's pushed state: create messages are state-gated on the host, so a
 * collapsed project that has never been expanded still works.
 */
export const ProjectRowActions: Component<Props> = (props) => (
  <div class="am-project-actions-row" onClick={(event) => event.stopPropagation()}>
    <WorktreeCreate
      branch={props.branch}
      bindings={props.bindings}
      loaded
      t={props.t}
      onCreate={props.onCreate}
      onNew={props.onNew}
      onSection={props.onSection}
    />
    <IconButton
      icon="history"
      size="small"
      variant="ghost"
      label={props.t("session.showHistory")}
      onClick={props.onHistory}
    />
    <IconButton
      icon="settings-gear"
      size="small"
      variant="ghost"
      label={props.t("agentManager.project.settings")}
      onClick={props.onSettings}
    />
    <Show when={!props.pinned}>
      <IconButton
        icon="close-small"
        size="small"
        variant="ghost"
        label={props.t("agentManager.project.remove")}
        onClick={props.onRemove}
      />
    </Show>
  </div>
)
