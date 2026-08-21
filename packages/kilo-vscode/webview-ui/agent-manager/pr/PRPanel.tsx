/** @jsxImportSource solid-js */
import { Component, Show, createEffect, createMemo, on, onCleanup } from "solid-js"
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
import { commentScroll, setCommentScroll } from "./pr-comment-state"
import { PRSummary } from "./PRSummary"
import "./pr-panel.css"

interface PRPanelProps {
  pr: PRStatus
  worktree?: WorktreeState
  projectId?: string
  worktreeId: string
  activeTerminalId?: string
  onClose: () => void
  onOpenExternal: () => void
  onOpenFile?: (file: string, line?: number) => void
  onOpenUrl?: (url: string) => void
}

export const PRPanel: Component<PRPanelProps> = (props) => {
  let commentsRef: HTMLDivElement | undefined
  let bodyRef: HTMLDivElement | undefined
  let capture: number | undefined
  let restore: number | undefined

  // A poll replaces the whole status, so the panel re-renders, and sometimes
  // remounts, while the user reads. Anchoring on the topmost visible thread
  // keeps that thread still even when a section above it grows, which a raw
  // scrollTop cannot do. Both live outside the component so a remount restores
  // the same position instead of jumping to the top.
  const remember = () => {
    if (!bodyRef) return
    const top = bodyRef.getBoundingClientRect().top
    for (const node of bodyRef.querySelectorAll<HTMLElement>("[data-thread-id]")) {
      const box = node.getBoundingClientRect()
      if (box.bottom <= top) continue
      const id = node.dataset.threadId
      if (id) setCommentScroll(props.worktreeId, bodyRef.scrollTop, { id, offset: box.top - top })
      return
    }
    setCommentScroll(props.worktreeId, bodyRef.scrollTop)
  }

  const reposition = () => {
    if (!bodyRef) return
    const saved = commentScroll(props.worktreeId)
    if (!saved) return
    const anchor = saved.anchor
    const node = anchor ? bodyRef.querySelector<HTMLElement>(`[data-thread-id="${anchor.id}"]`) : undefined
    if (node && anchor) {
      const delta = node.getBoundingClientRect().top - bodyRef.getBoundingClientRect().top - anchor.offset
      if (Math.abs(delta) >= 1) bodyRef.scrollTop += delta
      setCommentScroll(props.worktreeId, bodyRef.scrollTop, anchor)
      return
    }
    const max = Math.max(0, bodyRef.scrollHeight - bodyRef.clientHeight)
    bodyRef.scrollTop = Math.min(saved.scroll, max)
  }

  // Two frames: the first lets Solid flush the new DOM, the second lets Pierre
  // finish rendering the hunks that decide the final height.
  const later = () => {
    if (restore !== undefined) cancelAnimationFrame(restore)
    restore = requestAnimationFrame(() => {
      restore = requestAnimationFrame(() => {
        restore = undefined
        reposition()
      })
    })
  }

  createEffect(on(() => props.worktreeId, later))
  createEffect(on(() => props.pr, later, { defer: true }))

  onCleanup(() => {
    if (capture !== undefined) cancelAnimationFrame(capture)
    if (restore !== undefined) cancelAnimationFrame(restore)
  })

  function jumpToComments() {
    commentsRef?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  function onScroll() {
    if (capture !== undefined) return
    capture = requestAnimationFrame(() => {
      capture = undefined
      remember()
    })
  }

  // Only the selected worktree fetches threads, and that fetch can fail, so a
  // refresh can arrive without comments. Dropping the section would discard the
  // expanded card and the scroll position, so the last list for this PR stays.
  const comments = createMemo<{ number: number; value: NonNullable<PRStatus["comments"]> } | undefined>((prev) => {
    const next = props.pr.comments
    if (next) return { number: props.pr.number, value: next }
    if (prev && prev.number === props.pr.number) return prev
    return undefined
  })

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
        <div class="am-pr-panel-body" ref={bodyRef} onScroll={onScroll}>
          <PRSummary pr={props.pr} onJumpToComments={jumpToComments} />
          <PROverview pr={props.pr} worktree={props.worktree} />
          <Show when={(props.pr.reviewers ?? []).length > 0}>
            <PRReviewers reviewers={props.pr.reviewers ?? []} />
          </Show>
          <Show when={props.pr.body}>{(body) => <PRDescription body={body()} />}</Show>
          <Show when={props.pr.checks.total > 0}>
            <PRChecks checks={props.pr.checks} />
          </Show>
          <Show when={comments()}>
            {(item) => (
              <div ref={commentsRef}>
                <PRComments
                  comments={item().value}
                  projectId={props.projectId}
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
