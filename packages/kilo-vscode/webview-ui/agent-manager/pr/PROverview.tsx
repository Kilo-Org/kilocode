/** @jsxImportSource solid-js */
import { Show } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import type { WorktreeState } from "../../src/types/messages"
import type { PRStatus } from "../../src/types/messages"

const STATE_LABEL: Record<PRStatus["state"], string> = {
  open: "Open",
  draft: "Draft",
  merged: "Merged",
  closed: "Closed",
}

const REVIEW_LABEL: Partial<Record<NonNullable<PRStatus["review"]>, string>> = {
  approved: "Approved",
  changes_requested: "Changes Requested",
  pending: "Review Pending",
}

export function PROverview(props: { pr: PRStatus; worktree?: WorktreeState }) {
  return (
    <div class="am-pr-panel-section">
      <Show when={props.worktree}>
        {(wt) => (
          <div class="am-pr-panel-row am-pr-row">
            <span class="am-pr-panel-label">Branch</span>
            <span class="am-pr-panel-value am-pr-panel-branch am-pr-row">
              <span class="am-pr-branch-name">{wt().branch}</span>
              <Icon name="arrow-right" size="small" class="am-pr-branch-arrow" />
              <span class="am-pr-branch-name">{wt().parentBranch}</span>
            </span>
          </div>
        )}
      </Show>
      <div class="am-pr-panel-row am-pr-row">
        <span class="am-pr-panel-label">Status</span>
        <span class="am-pr-panel-value" data-pr-state={props.pr.state}>
          {STATE_LABEL[props.pr.state]}
        </span>
      </div>
      <Show when={props.pr.review}>
        {(review) => (
          <div class="am-pr-panel-row am-pr-row">
            <span class="am-pr-panel-label">Review</span>
            <span class="am-pr-panel-value">{REVIEW_LABEL[review()]}</span>
          </div>
        )}
      </Show>
    </div>
  )
}
