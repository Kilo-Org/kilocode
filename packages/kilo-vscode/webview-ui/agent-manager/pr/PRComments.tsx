/** @jsxImportSource solid-js */
import { For, Show, createSignal } from "solid-js"
import { Markdown } from "@kilocode/kilo-ui/markdown"
import type { PRStatus } from "../../src/types/messages"
import type { PRComment } from "./pr-types"
import { SectionHeading } from "./SectionHeading"
import { CopyButton } from "./CopyButton"

export function PRComments(props: { comments: NonNullable<PRStatus["comments"]> }) {
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
              {(comment: PRComment) => (
                <div class="am-pr-panel-comment" classList={{ "am-pr-panel-comment-resolved": comment.resolved }}>
                  <div class="am-pr-panel-comment-header am-pr-row">
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
                    <CopyButton text={comment.body} class="am-pr-copy-btn" />
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
    </>
  )
}
