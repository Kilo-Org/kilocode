/** @jsxImportSource solid-js */
import { Component, Show } from "solid-js"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { MarkedProvider } from "@kilocode/kilo-ui/context/marked"
import type { WorktreeState } from "../../src/types/messages"
import type { PRStatus } from "../../src/types/messages"
import { PRBadge } from "./PRBadge"
import { PROverview } from "./PROverview"
import { PRReviewers } from "./PRReviewers"
import { PRDescription } from "./PRDescription"
import { PRFileChanges } from "./PRFileChanges"
import { PRChecks } from "./PRChecks"
import { PRComments } from "./PRComments"
import "./pr-panel.css"

interface PRPanelProps {
  pr: PRStatus
  worktree?: WorktreeState
  onClose: () => void
  onOpenExternal: () => void
}

export const PRPanel: Component<PRPanelProps> = (props) => (
  <MarkedProvider>
    <div class="am-pr-panel">
      <div class="am-pr-panel-header am-pr-row">
        <div class="am-pr-panel-title-row am-pr-row">
          <PRBadge pr={props.pr} />
          <span class="am-pr-panel-title">{props.pr.title}</span>
        </div>
        <div class="am-pr-panel-actions am-pr-row">
          <Tooltip value="Open in browser" placement="bottom">
            <IconButton icon="link" size="small" variant="ghost" label="Open in browser" onClick={props.onOpenExternal} />
          </Tooltip>
          <Tooltip value="Close" placement="bottom">
            <IconButton icon="close" size="small" variant="ghost" label="Close PR panel" onClick={props.onClose} />
          </Tooltip>
        </div>
      </div>
      <div class="am-pr-panel-body">
        <PROverview pr={props.pr} worktree={props.worktree} />
        <Show when={props.pr.comments?.reviewers?.length}>
          <PRReviewers reviewers={props.pr.comments!.reviewers} />
        </Show>
        <Show when={props.pr.body}>
          <PRDescription body={props.pr.body!} />
        </Show>
        <Show when={props.pr.files > 0 || props.pr.additions > 0 || props.pr.deletions > 0}>
          <PRFileChanges files={props.pr.files} additions={props.pr.additions} deletions={props.pr.deletions} />
        </Show>
        <Show when={props.pr.checks.total > 0}>
          <PRChecks checks={props.pr.checks} />
        </Show>
        <Show when={props.pr.comments && props.pr.comments.total > 0}>
          <PRComments comments={props.pr.comments!} />
        </Show>
      </div>
    </div>
  </MarkedProvider>
)
