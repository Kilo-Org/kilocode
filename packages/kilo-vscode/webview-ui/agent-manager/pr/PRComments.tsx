/** @jsxImportSource solid-js */
import { Index, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { useLanguage } from "../../src/context/language"
import { useVSCode } from "../../src/context/vscode"
import type { PRStatus } from "../../src/types/messages"
import { sendReviewComments } from "../../diff-viewer/review-annotations"
import { PRCommentCard } from "./PRCommentCard"
import { SEND_LIMIT, githubUrl, prPayload } from "./pr-comment-payload"
import type { PRComment } from "./pr-types"
import { SectionHeading } from "./SectionHeading"

interface Props {
  comments: NonNullable<PRStatus["comments"]>
  worktreeId: string
  activeTerminalId?: string
  onOpenFile?: (file: string, line?: number) => void
  onOpenUrl?: (url: string) => void
}

type Flags = Record<string, boolean>

function without<T>(map: Record<string, T>, id: string): Record<string, T> {
  const next = { ...map }
  delete next[id]
  return next
}

export function PRComments(props: Props) {
  const { t } = useLanguage()
  const vscode = useVSCode()

  const [open, setOpen] = createSignal(true)
  const [doneOpen, setDoneOpen] = createSignal(false)
  // threadId -> resolved state requested by the user, until the next poll confirms it
  const [pending, setPending] = createSignal<Flags>({})
  const [errors, setErrors] = createSignal<Record<string, string>>({})
  // threadId -> expansion override; the default depends on resolved/outdated state
  const [expanded, setExpanded] = createSignal<Flags>({})
  const [sent, setSent] = createSignal<Flags>({})

  const resolved = (comment: PRComment) => pending()[comment.threadId] ?? comment.resolved
  const expandedFor = (comment: PRComment) => expanded()[comment.threadId] ?? (!resolved(comment) && !comment.outdated)

  const groups = createMemo(() => {
    const list = props.comments.comments
    return { todo: list.filter((item) => !resolved(item)), done: list.filter((item) => resolved(item)) }
  })

  const unsent = createMemo(() => groups().todo.filter((item) => !sent()[item.threadId]))

  createEffect(() => {
    props.worktreeId
    setPending({})
    setErrors({})
    setExpanded({})
    setSent({})
    setDoneOpen(false)
  })

  // Drop the optimistic state once a poll reports the state the user asked for.
  createEffect(() => {
    const map = pending()
    const settled = props.comments.comments.filter(
      (item) => map[item.threadId] !== undefined && map[item.threadId] === item.resolved,
    )
    if (settled.length === 0) return
    setPending((prev) => {
      const next = { ...prev }
      for (const item of settled) delete next[item.threadId]
      return next
    })
  })

  onMount(() => {
    function handler(ev: MessageEvent) {
      const msg = ev.data
      const resolveResult = msg?.type === "agentManager.resolveCommentResult"
      const unresolveResult = msg?.type === "agentManager.unresolveCommentResult"
      if (!resolveResult && !unresolveResult) return
      if (msg.worktreeId !== props.worktreeId) return
      // Success waits for the poll to report the new server state.
      if (msg.success) return
      const id = msg.threadId as string
      setPending((prev) => without(prev, id))
      // Keep the card open so the failure is readable instead of hidden in a collapsed row.
      setExpanded((prev) => ({ ...prev, [id]: true }))
      const reason = typeof msg.error === "string" && msg.error ? msg.error : t("common.requestFailed")
      setErrors((prev) => ({
        ...prev,
        [id]: t(resolveResult ? "agentManager.pr.comment.resolveFailed" : "agentManager.pr.comment.unresolveFailed", {
          error: reason,
        }),
      }))
    }
    window.addEventListener("message", handler)
    onCleanup(() => window.removeEventListener("message", handler))
  })

  function toggleResolved(comment: PRComment) {
    const next = !resolved(comment)
    setErrors((prev) => without(prev, comment.threadId))
    setPending((prev) => ({ ...prev, [comment.threadId]: next }))
    // A thread the user just resolved collapses, like it does on GitHub. Open the
    // resolved group so the thread is visibly moved instead of just disappearing.
    setExpanded((prev) => ({ ...prev, [comment.threadId]: !next }))
    if (next) setDoneOpen(true)
    vscode.postMessage({
      type: next ? "agentManager.resolveComment" : "agentManager.unresolveComment",
      worktreeId: props.worktreeId,
      threadId: comment.threadId,
    } as never)
  }

  function send(list: PRComment[]) {
    const batch = list.filter((item) => !sent()[item.threadId]).slice(0, SEND_LIMIT)
    if (batch.length === 0) return
    sendReviewComments(batch.map(prPayload), props.activeTerminalId)
    setSent((prev) => {
      const next = { ...prev }
      for (const item of batch) next[item.threadId] = true
      return next
    })
  }

  // `Index` keyed by position, not `For` keyed by identity: every poll allocates
  // fresh PRComment objects, and remounting would re-run Pierre and Markdown.
  const card = (comment: () => PRComment) => (
    <PRCommentCard
      comment={comment()}
      resolved={resolved(comment())}
      pending={pending()[comment().threadId] !== undefined}
      sent={sent()[comment().threadId] === true}
      open={expandedFor(comment())}
      error={errors()[comment().threadId]}
      onToggleOpen={() => setExpanded((prev) => ({ ...prev, [comment().threadId]: !expandedFor(comment()) }))}
      onToggleResolved={() => toggleResolved(comment())}
      onSend={() => send([comment()])}
      onOpenFile={
        comment().file && props.onOpenFile ? () => props.onOpenFile?.(comment().file!, comment().line) : undefined
      }
      onOpenUrl={
        githubUrl(comment().url) && props.onOpenUrl ? () => props.onOpenUrl?.(githubUrl(comment().url)!) : undefined
      }
    />
  )

  return (
    <>
      <div class="am-pr-panel-divider" />
      <div class="am-pr-panel-section">
        <SectionHeading
          title={t("agentManager.pr.comment.title")}
          open={open()}
          onToggle={() => setOpen((v) => !v)}
          count={
            groups().todo.length > 0
              ? t("agentManager.pr.comment.unresolvedCount", { count: groups().todo.length })
              : undefined
          }
          countClass="am-pr-panel-unresolved"
        />
        <Show when={open()}>
          <Show when={unsent().length > 0}>
            <Button variant="primary" size="small" class="am-pr-comment-send-all" onClick={() => send(unsent())}>
              {t(
                props.activeTerminalId
                  ? "agentManager.pr.comment.sendAllToTerminal"
                  : "agentManager.pr.comment.sendAll",
                { count: Math.min(unsent().length, SEND_LIMIT) },
              )}
            </Button>
          </Show>
          <div class="am-pr-panel-comment-list am-pr-col">
            <Index each={groups().todo}>{card}</Index>
          </div>
          <Show when={groups().done.length > 0}>
            <div class="am-pr-comment-done-group">
              <SectionHeading
                title={t("agentManager.pr.comment.resolvedGroup", { count: groups().done.length })}
                open={doneOpen()}
                onToggle={() => setDoneOpen((v) => !v)}
              />
              <Show when={doneOpen()}>
                <div class="am-pr-panel-comment-list am-pr-col">
                  <Index each={groups().done}>{card}</Index>
                </div>
              </Show>
            </div>
          </Show>
        </Show>
      </div>
    </>
  )
}
