/** @jsxImportSource solid-js */
import { For, Show, createSignal, onCleanup, onMount } from "solid-js"
import { Markdown } from "@kilocode/kilo-ui/markdown"
import { useVSCode } from "../../src/context/vscode"
import type { PRStatus } from "../../src/types/messages"
import type { PRComment } from "./pr-types"
import { SectionHeading } from "./SectionHeading"
import { CopyButton } from "./CopyButton"

function DiffHunk(props: { hunk: string }) {
  const lines = () => props.hunk.split("\n")
  return (
    <div class="am-pr-diff-hunk">
      <For each={lines()}>
        {(line) => {
          const cls =
            line.startsWith("+")
              ? "am-pr-diff-line-add"
              : line.startsWith("-")
                ? "am-pr-diff-line-del"
                : line.startsWith("@@")
                  ? "am-pr-diff-line-meta"
                  : "am-pr-diff-line-ctx"
          return <div class={`am-pr-diff-line ${cls}`}>{line || " "}</div>
        }}
      </For>
    </div>
  )
}

function CommentCard(props: { comment: PRComment; worktreeId: string }) {
  const vscode = useVSCode()
  const [resolving, setResolving] = createSignal(false)
  const [optimisticResolved, setOptimisticResolved] = createSignal<boolean | undefined>(undefined)
  const [resolveError, setResolveError] = createSignal<string | undefined>(undefined)

  const resolved = () => optimisticResolved() ?? props.comment.resolved

  onMount(() => {
    function handler(ev: MessageEvent) {
      const msg = ev.data
      if (
        msg?.type === "agentManager.resolveCommentResult" &&
        msg.worktreeId === props.worktreeId &&
        msg.threadId === props.comment.id
      ) {
        if (msg.success) {
          setOptimisticResolved(true)
          setResolveError(undefined)
        } else {
          setOptimisticResolved(undefined)
          setResolveError("Failed to resolve thread")
        }
        setResolving(false)
      }
    }
    window.addEventListener("message", handler)
    onCleanup(() => window.removeEventListener("message", handler))
  })

  function resolve() {
    setResolving(true)
    setResolveError(undefined)
    setOptimisticResolved(true)
    vscode.postMessage({ type: "agentManager.resolveComment", worktreeId: props.worktreeId, threadId: props.comment.id })
  }

  return (
    <div class="am-pr-panel-comment" classList={{ "am-pr-panel-comment-resolved": resolved() }}>
      <Show when={props.comment.diffHunk}>
        {(hunk) => <DiffHunk hunk={hunk()} />}
      </Show>
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
      <Show when={resolveError()}>
        {(err) => <div class="am-pr-resolve-error">{err()}</div>}
      </Show>
      <div class="am-pr-panel-comment-body">
        <Markdown text={props.comment.body} />
      </div>
      <Show when={!resolved()}>
        <div class="am-pr-resolve-row">
          <button class="am-pr-resolve-btn" disabled={resolving()} onClick={resolve}>
            Resolve conversation
          </button>
        </div>
      </Show>
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
            <For each={props.comments.comments}>
              {(comment: PRComment) => <CommentCard comment={comment} worktreeId={props.worktreeId} />}
            </For>
          </div>
        </Show>
      </div>
    </>
  )
}
