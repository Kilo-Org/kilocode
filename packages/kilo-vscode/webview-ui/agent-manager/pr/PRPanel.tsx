/** @jsxImportSource solid-js */
import { Component, Show, createEffect, createMemo, on, onCleanup } from "solid-js"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import type { WorktreeState } from "../../src/types/messages"
import type { PRStatus } from "../../src/types/messages"
import { useLanguage } from "../../src/context/language"
import { PRBadge } from "./PRBadge"
import { PROverview } from "./PROverview"
import { PRReviewers } from "./PRReviewers"
import { PRDescription } from "./PRDescription"
import { PRChecks } from "./PRChecks"
import { PRComments } from "./PRComments"
import { PRConversation } from "./PRConversation"
import type { PRComment } from "./pr-types"
import type { JumpTarget } from "./pr-actions"
import { commentScroll, patchCommentState, setCommentScroll } from "./pr-comment-state"
import { PRSummary } from "./PRSummary"
import { PRFiles } from "./PRFiles"
import { CopyButton } from "./CopyButton"
import "./pr-panel.css"

interface PRPanelProps {
  pr: PRStatus
  worktree?: WorktreeState
  projectId?: string
  worktreeId: string
  activeTerminalId?: string
  jump?: number
  onJump?: (id: number) => void
  onClose: () => void
  onRefresh: () => void
  onOpenExternal: () => void
  onOpenFile?: (file: string, line?: number) => void
  onOpenDiff?: (comment: PRComment) => void
  onOpenUrl?: (url: string) => void
}

export const PRPanel: Component<PRPanelProps> = (props) => {
  const { t } = useLanguage()
  let checksRef: HTMLDivElement | undefined
  let commentsRef: HTMLDivElement | undefined
  let conversationRef: HTMLDivElement | undefined
  let bodyRef: HTMLDivElement | undefined
  let capture: number | undefined
  let restore: number | undefined
  let jumped: number | undefined
  let requested: JumpTarget | undefined
  // An external jump (props.jump) always targets the review threads.
  const jumping = (): JumpTarget | undefined =>
    requested ?? (props.jump !== undefined && props.jump !== jumped ? "comments" : undefined)
  const targetRef = (target: JumpTarget) =>
    target === "checks" ? checksRef : target === "conversation" ? conversationRef : commentsRef
  const targetReady = (target: JumpTarget) =>
    target === "checks"
      ? props.pr.checks.checks.length > 0
      : target === "conversation"
        ? !!conversation()
        : !!comments()

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
        const target = jumping()
        if (target) {
          const node = targetRef(target)
          if (!targetReady(target) || !node?.isConnected || !bodyRef) return
          bodyRef.scrollBy({
            top: node.getBoundingClientRect().top - bodyRef.getBoundingClientRect().top - bodyRef.clientTop,
            behavior: "instant",
          })
          requested = undefined
          jumped = props.jump
          remember()
          if (jumped !== undefined) props.onJump?.(jumped)
          return
        }
        reposition()
      })
    })
  }

  createEffect(
    on([() => props.projectId, () => props.worktreeId], () => {
      requested = undefined
      jumped = undefined
      if (capture !== undefined) cancelAnimationFrame(capture)
      capture = undefined
      later()
    }),
  )
  createEffect(on(() => props.pr, later, { defer: true }))

  onCleanup(() => {
    if (capture !== undefined) cancelAnimationFrame(capture)
    if (restore !== undefined) cancelAnimationFrame(restore)
  })

  function jumpTo(target: JumpTarget) {
    requested = target
    patchCommentState(props.worktreeId, () =>
      target === "checks"
        ? { checksOpen: true }
        : target === "conversation"
          ? { conversationOpen: true }
          : { open: true },
    )
    later()
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
  const comments = createMemo<
    | { project?: string; worktree: string; number: number; url: string; value: NonNullable<PRStatus["comments"]> }
    | undefined
  >((prev) => {
    const next = props.pr.comments
    if (next)
      return {
        project: props.projectId,
        worktree: props.worktreeId,
        number: props.pr.number,
        url: props.pr.url,
        value: next,
      }
    if (
      prev &&
      prev.project === props.projectId &&
      prev.worktree === props.worktreeId &&
      prev.number === props.pr.number &&
      prev.url === props.pr.url
    )
      return prev
    return undefined
  })

  const conversation = createMemo<
    | { project?: string; worktree: string; number: number; url: string; value: NonNullable<PRStatus["conversation"]> }
    | undefined
  >((prev) => {
    const next = props.pr.conversation
    if (next)
      return {
        project: props.projectId,
        worktree: props.worktreeId,
        number: props.pr.number,
        url: props.pr.url,
        value: next,
      }
    if (
      prev &&
      prev.project === props.projectId &&
      prev.worktree === props.worktreeId &&
      prev.number === props.pr.number &&
      prev.url === props.pr.url
    )
      return prev
    return undefined
  })

  createEffect(() => {
    const target = jumping()
    if (!target || !targetReady(target)) return
    if (target === "comments") patchCommentState(props.worktreeId, () => ({ open: true }))
    later()
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
          <Tooltip value={t("common.refresh")} placement="bottom">
            <IconButton
              icon="refresh"
              size="small"
              variant="ghost"
              aria-label={t("common.refresh")}
              onClick={props.onRefresh}
            />
          </Tooltip>
          <Tooltip value={t("agentManager.pr.copyLink")} placement="bottom">
            <CopyButton text={props.pr.url} label={t("agentManager.pr.copyLink")} />
          </Tooltip>
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
          <PRSummary
            pr={props.pr}
            worktreeId={props.worktreeId}
            activeTerminalId={props.activeTerminalId}
            onJump={jumpTo}
          />
          <PROverview pr={props.pr} worktree={props.worktree} />
          <PRFiles
            projectId={props.projectId}
            worktreeId={props.worktreeId}
            prNumber={props.pr.number}
            prUrl={props.pr.url}
            own={props.pr.viewerDidAuthor}
            closed={props.pr.state === "closed" || props.pr.state === "merged"}
            onRefresh={props.onRefresh}
          />
          <Show when={(props.pr.reviewers ?? []).length > 0}>
            <PRReviewers reviewers={props.pr.reviewers ?? []} />
          </Show>
          <Show when={props.pr.body}>{(body) => <PRDescription body={body()} />}</Show>
          <Show when={props.pr.checks.checks.length > 0}>
            <div ref={checksRef}>
              <PRChecks pr={props.pr} worktreeId={props.worktreeId} activeTerminalId={props.activeTerminalId} />
            </div>
          </Show>
          <Show when={comments()}>
            {(item) => (
              <div ref={commentsRef}>
                <PRComments
                  prNumber={props.pr.number}
                  prUrl={props.pr.url}
                  comments={item().value}
                  projectId={props.projectId}
                  worktreeId={props.worktreeId}
                  activeTerminalId={props.activeTerminalId}
                  onOpenFile={props.onOpenFile}
                  onOpenDiff={props.onOpenDiff}
                  onOpenUrl={props.onOpenUrl}
                />
              </div>
            )}
          </Show>
          <div ref={conversationRef}>
            <PRConversation
              comments={conversation()?.value ?? []}
              prNumber={props.pr.number}
              prUrl={props.pr.url}
              projectId={props.projectId}
              worktreeId={props.worktreeId}
              activeTerminalId={props.activeTerminalId}
              onOpenUrl={props.onOpenUrl}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
