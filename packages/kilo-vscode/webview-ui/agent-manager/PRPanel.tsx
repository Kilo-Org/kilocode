/** @jsxImportSource solid-js */
import { Component, For, Show } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import type { PRStatus, CheckStatus, PRReviewer } from "../src/types/messages"
import { prAccentColor, prBadgeIndicator, prChecksRunning } from "./WorktreeItem"

interface PRPanelProps {
  pr: PRStatus
  onClose: () => void
  onOpenExternal: () => void
}

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

const CHECK_ICON: Record<CheckStatus, string> = {
  success: "circle-check",
  failure: "circle-x",
  cancelled: "circle-x",
  skipped: "circle-x",
  pending: "play",
}

const CHECK_LABEL: Record<CheckStatus, string> = {
  success: "Passed",
  failure: "Failed",
  pending: "Running",
  skipped: "Skipped",
  cancelled: "Cancelled",
}

const REVIEWER_STATE_ICON: Record<PRReviewer["state"], string> = {
  approved: "circle-check",
  changes_requested: "refresh",
  commented: "edit",
  pending: "clock",
}

const REVIEWER_STATE_LABEL: Record<PRReviewer["state"], string> = {
  approved: "Approved",
  changes_requested: "Changes requested",
  commented: "Commented",
  pending: "Awaiting",
}

export const PRPanel: Component<PRPanelProps> = (props) => {
  const accent = () => prAccentColor(props.pr)
  const indicator = () => prBadgeIndicator(props.pr)
  const pulsing = () => prChecksRunning(props.pr)

  return (
    <div class="am-pr-panel">
      <div class="am-pr-panel-header">
        <div class="am-pr-panel-title-row">
          <span
            class="am-pr-panel-badge"
            style={{ "--pr-accent": accent() }}
            data-pending={pulsing() ? "" : undefined}
          >
            <Icon
              name={indicator() === "failure" || indicator() === "changes" || indicator() === "approved"
                ? ({ failure: "circle-x", changes: "warning", approved: "circle-check" } as const)[indicator() as "failure" | "changes" | "approved"]
                : "branch"}
              size="small"
              class={indicator() !== "none" ? "am-pr-badge-status" : undefined}
              data-status={indicator() !== "none" ? indicator() : undefined}
            />
            <span class="am-pr-badge-number">#{props.pr.number}</span>
          </span>
          <span class="am-pr-panel-title">{props.pr.title}</span>
        </div>
        <div class="am-pr-panel-actions">
          <Tooltip value="Open in browser" placement="bottom">
            <IconButton icon="link" size="small" variant="ghost" label="Open in browser" onClick={props.onOpenExternal} />
          </Tooltip>
          <Tooltip value="Close" placement="bottom">
            <IconButton icon="close" size="small" variant="ghost" label="Close PR panel" onClick={props.onClose} />
          </Tooltip>
        </div>
      </div>

      <div class="am-pr-panel-body">
        {/* State + review */}
        <div class="am-pr-panel-section">
          <div class="am-pr-panel-row">
            <span class="am-pr-panel-label">Status</span>
            <span class="am-pr-panel-value" data-pr-state={props.pr.state}>{STATE_LABEL[props.pr.state]}</span>
          </div>
          <Show when={props.pr.review}>
            {(review) => (
              <div class="am-pr-panel-row">
                <span class="am-pr-panel-label">Review</span>
                <span class="am-pr-panel-value">{REVIEW_LABEL[review()]}</span>
              </div>
            )}
          </Show>
        </div>

        {/* Description */}
        <Show when={props.pr.body}>
          <div class="am-pr-panel-divider" />
          <div class="am-pr-panel-section">
            <div class="am-pr-panel-description">{props.pr.body}</div>
          </div>
        </Show>

        {/* Reviewers */}
        <Show when={props.pr.reviewers && props.pr.reviewers.length > 0}>
          <div class="am-pr-panel-divider" />
          <div class="am-pr-panel-section">
            <div class="am-pr-panel-label" style={{ "padding-bottom": "4px" }}>Reviewers</div>
            <div class="am-pr-panel-reviewers">
              <For each={props.pr.reviewers}>
                {(reviewer) => (
                  <div class="am-pr-panel-reviewer" data-state={reviewer.state}>
                    <Icon name={REVIEWER_STATE_ICON[reviewer.state]} size="small" class="am-pr-reviewer-icon" />
                    <span class="am-pr-reviewer-login">{reviewer.login}</span>
                    <span class="am-pr-reviewer-state">{REVIEWER_STATE_LABEL[reviewer.state]}</span>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>

        {/* Diff stats */}
        <Show when={props.pr.files > 0 || props.pr.additions > 0 || props.pr.deletions > 0}>
          <div class="am-pr-panel-divider" />
          <div class="am-pr-panel-section">
            <div class="am-pr-panel-row">
              <span class="am-pr-panel-label">Changes</span>
              <span class="am-pr-panel-value am-pr-panel-diff">
                <Show when={props.pr.files > 0}>
                  <span class="am-stat-files">{props.pr.files}f</span>
                </Show>
                <Show when={props.pr.additions > 0}>
                  <span class="am-stat-additions">+{props.pr.additions}</span>
                </Show>
                <Show when={props.pr.deletions > 0}>
                  <span class="am-stat-deletions">−{props.pr.deletions}</span>
                </Show>
              </span>
            </div>
          </div>
        </Show>

        {/* Checks */}
        <Show when={props.pr.checks.total > 0}>
          <div class="am-pr-panel-divider" />
          <div class="am-pr-panel-section">
            <div class="am-pr-panel-row">
              <span class="am-pr-panel-label">Checks</span>
              <span class="am-pr-panel-value" data-checks={props.pr.checks.status}>
                {props.pr.checks.passed}/{props.pr.checks.total} passed
              </span>
            </div>
            <div class="am-pr-panel-checks">
              <For each={props.pr.checks.items}>
                {(check) => (
                  <div class="am-pr-panel-check-item" data-status={check.status}>
                    <Icon name={CHECK_ICON[check.status]} size="small" class="am-pr-check-icon" />
                    <span class="am-pr-check-name">{check.name}</span>
                    <span class="am-pr-check-status">{CHECK_LABEL[check.status]}</span>
                    <Show when={check.duration}>
                      <span class="am-pr-check-duration">{check.duration}</span>
                    </Show>
                    <Show when={check.url}>
                      <a class="am-pr-check-link" href={check.url} onClick={(e) => e.preventDefault()}>
                        <Icon name="link" size="small" />
                      </a>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>

        {/* Comments */}
        <Show when={props.pr.comments && props.pr.comments.total > 0}>
          <div class="am-pr-panel-divider" />
          <div class="am-pr-panel-section">
            <div class="am-pr-panel-row">
              <span class="am-pr-panel-label">Comments</span>
              <span class="am-pr-panel-value">
                {props.pr.comments!.total}
                <Show when={props.pr.comments!.unresolved > 0}>
                  {" "}
                  <span class="am-pr-panel-unresolved">({props.pr.comments!.unresolved} unresolved)</span>
                </Show>
              </span>
            </div>
          </div>
        </Show>
      </div>
    </div>
  )
}
