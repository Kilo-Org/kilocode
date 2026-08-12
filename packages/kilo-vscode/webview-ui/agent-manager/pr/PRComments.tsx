/** @jsxImportSource solid-js */
import { Index, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { Markdown } from "@kilocode/kilo-ui/markdown"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { useVSCode } from "../../src/context/vscode"
import type { PRStatus } from "../../src/types/messages"
import type { PRComment } from "./pr-types"
import { SectionHeading } from "./SectionHeading"
import { CopyButton } from "./CopyButton"

function DiffHunk(props: { hunk: string }) {
  const lines = () => props.hunk.split("\n")
  return (
    <div class="am-pr-diff-hunk">
      <Index each={lines()}>
        {(line) => {
          const text = line()
          const cls = text.startsWith("+")
            ? "am-pr-diff-line-add"
            : text.startsWith("-")
              ? "am-pr-diff-line-del"
              : text.startsWith("@@")
                ? "am-pr-diff-line-meta"
                : "am-pr-diff-line-ctx"
          return <div class={`am-pr-diff-line ${cls}`}>{text || " "}</div>
        }}
      </Index>
    </div>
  )
}

function CommentCard(props: { comment: PRComment; worktreeId: string }) {
  const vscode = useVSCode()

  // Track pending action and any error from the result
  const [pendingResolved, setPendingResolved] = createSignal<boolean | undefined>(undefined)
  const [actionError, setActionError] = createSignal<string | undefined>(undefined)

  // Resolved shows pending state if exists, otherwise server state
  const resolved = createMemo(() => pendingResolved() ?? props.comment.resolved)

  // Clear pending when server state matches (action confirmed by poll)
  createMemo(() => {
    const pending = pendingResolved()
    if (pending !== undefined && pending === props.comment.resolved) {
      setPendingResolved(undefined)
      setActionError(undefined)
    }
  })

  onMount(() => {
    function handler(ev: MessageEvent) {
      const msg = ev.data
      const isResult =
        (msg?.type === "agentManager.resolveCommentResult" || msg?.type === "agentManager.unresolveCommentResult") &&
        msg.worktreeId === props.worktreeId &&
        msg.threadId === props.comment.threadId
      if (!isResult) return
      if (!msg.success) {
        // Only clear on error - success waits for poll to update props.comment.resolved
        setPendingResolved(undefined)
        setActionError(
          msg.type === "agentManager.resolveCommentResult"
            ? "Failed to resolve thread."
            : "Failed to unresolve thread.",
        )
      }
    }
    window.addEventListener("message", handler)
    onCleanup(() => window.removeEventListener("message", handler))
  })

  function toggle() {
    setActionError(undefined)
    const next = !resolved()
    setPendingResolved(next)
    vscode.postMessage({
      type: next ? "agentManager.resolveComment" : "agentManager.unresolveComment",
      worktreeId: props.worktreeId,
      threadId: props.comment.threadId,
    } as never)
  }

  return (
    <div class="am-pr-panel-comment" classList={{ "am-pr-panel-comment-resolved": resolved() }}>
      <Show when={props.comment.diffHunk}>{(hunk) => <DiffHunk hunk={hunk()} />}</Show>
      <div class="am-pr-panel-comment-header am-pr-row">
        <span class="am-pr-panel-comment-author">{props.comment.author}</span>
        <Show when={props.comment.file}>
          <span class="am-pr-panel-comment-file">
            {props.comment.file}
            <Show when={props.comment.line}>{`:${props.comment.line}`}</Show>
          </span>
        </Show>
        <Show when={resolved()}>
          <span class="am-pr-panel-comment-resolved-badge">Resolved</span>
        </Show>
        <CopyButton text={props.comment.body} class="am-pr-copy-btn" />
      </div>
      <Show when={actionError()}>{(err) => <div class="am-pr-resolve-error">{err()}</div>}</Show>
      <div class="am-pr-panel-comment-body">
        <Markdown text={props.comment.body} />
      </div>
      <div class="am-pr-resolve-row">
        <Show
          when={pendingResolved() === undefined}
          fallback={
            <div class="am-pr-resolve-loading">
              <Spinner class="am-pr-resolve-spinner" />
              <span>Loading</span>
            </div>
          }
        >
          <button class="am-pr-resolve-btn" onClick={toggle}>
            {resolved() ? "Unresolve comment" : "Resolve comment"}
          </button>
        </Show>
      </div>
    </div>
  )
}

export function PRComments(props: { comments: NonNullable<PRStatus["comments"]>; worktreeId: string }) {
  const [open, setOpen] = createSignal(true)
  return (
    <>
      <div class="am-pr-panel-divider" />
      <div class="am-pr-panel-section">
        <SectionHeading
          title="Comments"
          open={open()}
          onToggle={() => setOpen((v) => !v)}
          count={props.comments.unresolved > 0 ? `${props.comments.unresolved} unresolved` : undefined}
          countClass="am-pr-panel-unresolved"
        />
        <Show when={open()}>
          <div class="am-pr-panel-comment-list am-pr-col">
            <Index each={props.comments.comments}>
              {(comment) => <CommentCard comment={comment()} worktreeId={props.worktreeId} />}
            </Index>
          </div>
        </Show>
      </div>
    </>
  )
}
