/** @jsxImportSource solid-js */
import { Component, For, Show, createSignal } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { Markdown } from "@kilocode/kilo-ui/markdown"
import { MarkedProvider } from "@kilocode/kilo-ui/context/marked"
import type { PRStatus, CheckStatus, PRReviewer, WorktreeState } from "../src/types/messages"
import { prAccentColor, prBadgeIndicator, prChecksRunning } from "./WorktreeItem"

interface PRPanelProps {
  pr: PRStatus
  worktree?: WorktreeState
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
  failure: "circle-x-outline",
  cancelled: "circle-x-outline",
  skipped: "circle-x-outline",
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
  pending: "dash",
}

const REVIEWER_STATE_LABEL: Record<PRReviewer["state"], string> = {
  approved: "Approved",
  changes_requested: "Changes requested",
  commented: "Commented",
  pending: "Awaiting",
}

function SectionHeading(props: {
  title: string
  open: boolean
  onToggle: () => void
  count?: string
  countClass?: string
}) {
  return (
    <button class="am-pr-panel-section-heading am-pr-panel-section-toggle" onClick={props.onToggle}>
      <span class="am-pr-panel-section-heading-left">
        <Icon name={props.open ? "chevron-down" : "chevron-right"} size="small" class="am-pr-section-chevron" />
        {props.title}
      </span>
      <Show when={props.count}>
        <span class={`am-pr-panel-section-count ${props.countClass ?? ""}`}>{props.count}</span>
      </Show>
    </button>
  )
}

export const PRPanel: Component<PRPanelProps> = (props) => (
  <MarkedProvider>
    <PRPanelInner {...props} />
  </MarkedProvider>
)

const PRPanelInner: Component<PRPanelProps> = (props) => {
  const accent = () => prAccentColor(props.pr)
  const indicator = () => prBadgeIndicator(props.pr)
  const pulsing = () => prChecksRunning(props.pr)

  const [reviewersOpen, setReviewersOpen] = createSignal(true)
  const [descOpen, setDescOpen] = createSignal(true)
  const [checksOpen, setChecksOpen] = createSignal(true)
  const [commentsOpen, setCommentsOpen] = createSignal(true)

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
        {/* Overview: branch→base + status */}
        <div class="am-pr-panel-section">
          <Show when={props.worktree}>
            {(wt) => (
              <div class="am-pr-panel-row">
                <span class="am-pr-panel-label">Branch</span>
                <span class="am-pr-panel-value am-pr-panel-branch">
                  <span class="am-pr-branch-name">{wt().branch}</span>
                  <Icon name="arrow-right" size="small" class="am-pr-branch-arrow" />
                  <span class="am-pr-branch-name">{wt().parentBranch}</span>
                </span>
              </div>
            )}
          </Show>
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

        {/* Reviewers */}
        <Show when={props.pr.reviewers && props.pr.reviewers.length > 0}>
          <div class="am-pr-panel-divider" />
          <div class="am-pr-panel-section">
            <SectionHeading title="Reviewers" open={reviewersOpen()} onToggle={() => setReviewersOpen((v) => !v)} />
            <Show when={reviewersOpen()}>
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
            </Show>
          </div>
        </Show>

        {/* Description */}
        <Show when={props.pr.body}>
          <div class="am-pr-panel-divider" />
          <div class="am-pr-panel-section">
            <SectionHeading title="Description" open={descOpen()} onToggle={() => setDescOpen((v) => !v)} />
            <Show when={descOpen()}>
              <div class="am-pr-panel-description">
                <Markdown text={props.pr.body!} />
              </div>
            </Show>
          </div>
        </Show>

        {/* File Changes */}
        <Show when={props.pr.files > 0 || props.pr.additions > 0 || props.pr.deletions > 0}>
          <div class="am-pr-panel-divider" />
          <div class="am-pr-panel-section">
            <div class="am-pr-panel-section-heading">
              File Changes
              <span class="am-pr-panel-section-count am-pr-panel-diff">
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
            <SectionHeading
              title="Checks"
              open={checksOpen()}
              onToggle={() => setChecksOpen((v) => !v)}
              count={`${props.pr.checks.passed}/${props.pr.checks.total} passed`}
              countClass={`am-pr-checks-count-${props.pr.checks.status}`}
            />
            <Show when={checksOpen()}>
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
            </Show>
          </div>
        </Show>

        {/* Comments */}
        <Show when={props.pr.comments && props.pr.comments.total > 0}>
          <div class="am-pr-panel-divider" />
          <div class="am-pr-panel-section">
            <SectionHeading
              title="Comments"
              open={commentsOpen()}
              onToggle={() => setCommentsOpen((v) => !v)}
              count={props.pr.comments!.unresolved > 0 ? `${props.pr.comments!.unresolved} unresolved` : undefined}
              countClass="am-pr-panel-unresolved"
            />
            <Show when={commentsOpen()}>
              <div class="am-pr-panel-comment-list">
                <For each={props.pr.comments!.items}>
                  {(comment) => (
                    <div class="am-pr-panel-comment" classList={{ "am-pr-panel-comment-resolved": comment.resolved }}>
                      <div class="am-pr-panel-comment-header">
                        <span class="am-pr-panel-comment-author">{comment.author}</span>
                        <Show when={comment.file}>
                          <span class="am-pr-panel-comment-file">
                            {comment.file}
                            <Show when={comment.line}>{`:${comment.line}`}</Show>
                          </span>
                        </Show>
                        <Show when={comment.resolved}>
                          <span class="am-pr-panel-comment-resolved-badge">Resolved</span>
                        </Show>
                      </div>
                      <div class="am-pr-panel-comment-body">
                        <Markdown text={comment.body} />
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  )
}
