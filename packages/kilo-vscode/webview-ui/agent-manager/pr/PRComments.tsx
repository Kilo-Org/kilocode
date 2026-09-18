/** @jsxImportSource solid-js */
import { For, Show, createEffect, createMemo, onCleanup, onMount } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { useLanguage } from "../../src/context/language"
import { useVSCode } from "../../src/context/vscode"
import type { PRStatus } from "../../src/types/messages"
import { PRCommentCard } from "./PRCommentCard"
import { resolvedFor, sendThreads, unsentThreads } from "./pr-actions"
import { SEND_LIMIT, githubUrl } from "./pr-comment-payload"
import { commentState, createReactionController, omit, patchCommentState } from "./pr-comment-state"
import type { PRComment } from "./pr-types"
import { SectionHeading } from "./SectionHeading"

interface Props {
  comments: NonNullable<PRStatus["comments"]>
  projectId?: string
  worktreeId: string
  prNumber: number
  prUrl: string
  activeTerminalId?: string
  onOpenFile?: (file: string, line?: number) => void
  onOpenDiff?: (comment: PRComment) => void
  onOpenUrl?: (url: string) => void
}

export function PRComments(props: Props) {
  const { t } = useLanguage()
  const vscode = useVSCode()
  const reactions = createReactionController({
    worktree: () => props.worktreeId,
    project: () => props.projectId,
    post: vscode.postMessage,
    onMessage: vscode.onMessage,
    fail: (error) => t("agentManager.pr.comment.reactionFailed", { error: error || t("common.requestFailed") }),
  })

  // Held per worktree outside this component, so a remount does not collapse
  // the threads the user opened.
  const state = () => commentState(props.worktreeId)
  const patch = (value: Parameters<typeof patchCommentState>[1]) => patchCommentState(props.worktreeId, value)

  const resolved = (comment: PRComment) => resolvedFor(comment, state())
  const expandedFor = (comment: PRComment) =>
    state().expanded[comment.threadId] ?? (!resolved(comment) && !comment.outdated)

  const index = createMemo(() => new Map(props.comments.comments.map((item) => [item.threadId, item])))

  // Grouped by thread id, not by object: a poll allocates fresh comments, and a
  // resolve moves a thread between groups. Ids keep every card bound to its own
  // thread, so a click cannot land on the thread that took over its position.
  const groups = createMemo(() => {
    const list = props.comments.comments
    return {
      todo: list.filter((item) => !resolved(item)).map((item) => item.threadId),
      done: list.filter((item) => resolved(item)).map((item) => item.threadId),
    }
  })

  const unsent = createMemo(() => unsentThreads(props.comments.comments, state()))

  // Drop the optimistic state once a poll reports the state the user asked for.
  createEffect(() => {
    const map = state().pending
    const settled = props.comments.comments.filter(
      (item) => map[item.threadId] !== undefined && map[item.threadId] === item.resolved,
    )
    if (settled.length === 0) return
    patch((prev) => {
      const pending = { ...prev.pending }
      for (const item of settled) delete pending[item.threadId]
      return { pending }
    })
  })

  onMount(() => {
    function handler(ev: MessageEvent) {
      const msg = ev.data
      const resolveResult = msg?.type === "agentManager.resolveCommentResult"
      const unresolveResult = msg?.type === "agentManager.unresolveCommentResult"
      if (!resolveResult && !unresolveResult) return
      if (msg.worktreeId !== props.worktreeId) return
      if (props.projectId && msg.projectId !== props.projectId) return
      // Success waits for the poll to report the new server state.
      if (msg.success) return
      const id = msg.threadId as string
      const reason = typeof msg.error === "string" && msg.error ? msg.error : t("common.requestFailed")
      patch((prev) => ({
        pending: omit(prev.pending, id),
        // Keep the card open so the failure is readable instead of hidden in a collapsed row.
        expanded: { ...prev.expanded, [id]: true },
        errors: {
          ...prev.errors,
          [id]: t(resolveResult ? "agentManager.pr.comment.resolveFailed" : "agentManager.pr.comment.unresolveFailed", {
            error: reason,
          }),
        },
      }))
    }
    window.addEventListener("message", handler)
    onCleanup(() => window.removeEventListener("message", handler))
  })

  function toggleResolved(comment: PRComment) {
    const next = !resolved(comment)
    patch((prev) => ({
      errors: omit(prev.errors, comment.threadId),
      pending: { ...prev.pending, [comment.threadId]: next },
      // A thread the user just resolved collapses, like it does on GitHub. Open
      // the resolved group so the thread is visibly moved, not just gone.
      expanded: { ...prev.expanded, [comment.threadId]: !next },
      doneOpen: next || prev.doneOpen,
    }))
    vscode.postMessage({
      type: next ? "agentManager.resolveComment" : "agentManager.unresolveComment",
      projectId: props.projectId,
      worktreeId: props.worktreeId,
      threadId: comment.threadId,
    } as never)
  }

  function send(ids: string[]) {
    sendThreads(props.worktreeId, props.comments.comments, ids, state(), props.activeTerminalId)
  }

  // `For` over stable thread ids: the DOM survives a poll, so Pierre and
  // Markdown are not torn down and an open card stays open and clickable.
  const card = (id: string) => (
    <Show when={index().get(id)}>
      {(comment) => (
        <PRCommentCard
          projectId={props.projectId}
          worktreeId={props.worktreeId}
          prNumber={props.prNumber}
          prUrl={props.prUrl}
          comment={comment()}
          preview={comment().outdated ? undefined : comment().preview}
          resolved={resolved(comment())}
          pending={state().pending[id] !== undefined}
          sent={state().sent[id] === true}
          open={expandedFor(comment())}
          error={state().errors[id]}
          reactionError={reactions.error(comment().id)}
          reactions={reactions.list(comment().id, comment().reactions)}
          reactionPending={(content) => reactions.pending(comment().id, content)}
          onReaction={(content, add) => reactions.toggle(comment().id, content, add)}
          replyReactionError={(id) => reactions.error(id)}
          replyReactions={(id, values) => reactions.list(id, values)}
          replyReactionPending={(id, content) => reactions.pending(id, content)}
          onReplyReaction={(id, content, add) => reactions.toggle(id, content, add)}
          onToggleOpen={() => {
            const next = !expandedFor(comment())
            patch((prev) => ({ expanded: { ...prev.expanded, [id]: next } }))
          }}
          onToggleResolved={() => toggleResolved(comment())}
          onSend={() => send([id])}
          onOpenFile={
            comment().file && props.onOpenFile
              ? () =>
                  props.onOpenFile?.(
                    comment().file!,
                    comment().outdated || comment().side === "deletions" ? undefined : comment().line,
                  )
              : undefined
          }
          onOpenDiff={comment().file && props.onOpenDiff ? () => props.onOpenDiff?.(comment()) : undefined}
          onOpenUrl={
            githubUrl(comment().url) && props.onOpenUrl ? () => props.onOpenUrl?.(githubUrl(comment().url)!) : undefined
          }
        />
      )}
    </Show>
  )

  return (
    <>
      <div class="am-pr-panel-divider" />
      <div class="am-pr-panel-section">
        <SectionHeading
          title={t("agentManager.pr.comment.title")}
          open={state().open}
          onToggle={() => patch((prev) => ({ open: !prev.open }))}
          count={
            groups().todo.length > 0
              ? t("agentManager.pr.comment.unresolvedCount", { count: groups().todo.length })
              : undefined
          }
          countClass="am-pr-panel-unresolved"
        />
        <Show when={state().open}>
          <Show when={unsent().length > 0}>
            <Button variant="primary" size="small" class="am-pr-comment-send-all" onClick={() => send(unsent())}>
              {t(
                props.activeTerminalId
                  ? "agentManager.pr.comment.sendAllToTerminal"
                  : "agentManager.pr.fixWithKiloCount",
                { count: Math.min(unsent().length, SEND_LIMIT) },
              )}
            </Button>
          </Show>
          <div class="am-pr-panel-comment-list am-pr-col">
            <For each={groups().todo}>{card}</For>
          </div>
          <Show when={groups().done.length > 0}>
            <div class="am-pr-comment-done-group">
              <SectionHeading
                title={t("agentManager.pr.comment.resolvedGroup", { count: groups().done.length })}
                open={state().doneOpen}
                onToggle={() => patch((prev) => ({ doneOpen: !prev.doneOpen }))}
              />
              <Show when={state().doneOpen}>
                <div class="am-pr-panel-comment-list am-pr-col">
                  <For each={groups().done}>{card}</For>
                </div>
              </Show>
            </div>
          </Show>
        </Show>
      </div>
    </>
  )
}
