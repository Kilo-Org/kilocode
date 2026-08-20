/** @jsxImportSource solid-js */
import { Component, Show } from "solid-js"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import type { WorktreeState } from "../../src/types/messages"
import type { PRStatus } from "../../src/types/messages"
import { PRBadge } from "./PRBadge"
import { PROverview } from "./PROverview"
import { PRReviewers } from "./PRReviewers"
import { PRDescription } from "./PRDescription"
import { PRChecks } from "./PRChecks"
import { PRComments } from "./PRComments"
import { PRSummary } from "./PRSummary"
import "./pr-panel.css"

interface PRPanelProps {
  pr: PRStatus
  worktree?: WorktreeState
  worktreeId: string
  activeTerminalId?: string
  onClose: () => void
  onOpenExternal: () => void
  onOpenFile?: (file: string, line?: number) => void
  onOpenUrl?: (url: string) => void
}

export const PRPanel: Component<PRPanelProps> = (props) => {
  let commentsRef: HTMLDivElement | undefined

  function jumpToComments() {
    commentsRef?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  return (
    <div class="am-pr-panel am-pr-col">
      <div class="am-pr-panel-header am-pr-row">
        <div class="am-pr-panel-title-row am-pr-row">
          <PRBadge pr={props.pr} />
          <span class="am-pr-panel-title">{props.pr.title}</span>
          <span class="am-pr-panel-number">#{props.pr.number}</span>
        </div>
        <div class="am-pr-panel-actions am-pr-row">
          <Tooltip value="Open in browser" placement="bottom">
            <IconButton
              icon="link"
              size="small"
              variant="ghost"
              label="Open in browser"
              onClick={props.onOpenExternal}
            />
          </Tooltip>
          <Tooltip value="Close" placement="bottom">
            <IconButton icon="close" size="small" variant="ghost" label="Close PR panel" onClick={props.onClose} />
          </Tooltip>
        </div>
      </div>
      <div class="am-pr-panel-body-wrap">
        <div class="am-pr-panel-body">
          <PRSummary pr={props.pr} onJumpToComments={jumpToComments} />
          <PROverview pr={props.pr} worktree={props.worktree} />
          <Show when={(props.pr.reviewers ?? []).length > 0}>
            <PRReviewers reviewers={props.pr.reviewers ?? []} />
          </Show>
          <Show when={props.pr.body}>{(body) => <PRDescription body={body()} />}</Show>
          <Show when={props.pr.checks.total > 0}>
            <PRChecks checks={props.pr.checks} />
          </Show>
          <Show when={props.pr.comments?.total ? props.pr.comments : undefined}>
            {(comments) => (
              <div ref={commentsRef}>
                <PRComments
                  comments={comments()}
                  worktreeId={props.worktreeId}
                  activeTerminalId={props.activeTerminalId}
                  onOpenFile={props.onOpenFile}
                  onOpenUrl={props.onOpenUrl}
                />
              </div>
            )}
          </Show>
        </div>
      </div>
    </div>
  )
}
