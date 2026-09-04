import { Show, createMemo, type JSXElement } from "solid-js"
import { Portal } from "solid-js/web"
import { Diff } from "@kilocode/kilo-ui/diff"
import { normalizeHunk } from "@kilocode/kilo-ui/session-diff"
import { displayHunk } from "../agent-manager/pr/pr-comment-payload"

export function PRCommentDiff(props: {
  file: string
  line?: number
  side?: "additions" | "deletions"
  hunk: string
  after?: string[]
  inline?: boolean
  top?: boolean
  bottom?: boolean
  children?: JSXElement
}) {
  const host = document.createElement("div")
  host.className = "am-pr-thread-annotation"
  const annotations = createMemo(() => {
    const line = props.line
    const side = props.side
    return props.inline && line && side ? [{ lineNumber: line, side, metadata: undefined }] : undefined
  })
  const input = createMemo(
    () => ({
      file: props.file,
      line: props.line,
      side: props.side,
      hunk: props.hunk,
      after: (props.after ?? []).join("\n"),
    }),
    undefined,
    {
      equals: (a, b) =>
        a.file === b.file && a.line === b.line && a.side === b.side && a.hunk === b.hunk && a.after === b.after,
    },
  )
  const view = createMemo(() => {
    const data = input()
    const hunk = displayHunk(data.hunk, data.line, data.after ? data.after.split("\n") : undefined, data.side)
    const value = normalizeHunk(data.file, hunk.patch)
    if (!value) return
    if (
      props.inline &&
      !hunk.lines.some((item) =>
        data.side === "additions"
          ? item.next === data.line && item.text[0] !== "-"
          : data.side === "deletions" && item.old === data.line && item.text[0] !== "+",
      )
    )
      return
    return { hunk, value }
  })

  return (
    <>
      <Show when={props.inline}>
        <Portal mount={host}>{props.children}</Portal>
      </Show>
      <Show when={view()} fallback={props.inline ? host : undefined}>
        {(value) => (
          <div class="am-pr-diff-hunk" classList={{ "am-pr-diff-thread": props.inline }}>
            <Show when={props.inline}>
              <div class="am-pr-diff-file">
                {props.file}:{props.line}
              </div>
            </Show>
            <Show when={props.top || value().hunk.top}>
              <div class="am-pr-diff-context-marker">...</div>
            </Show>
            <Diff
              fileDiff={value().value.fileDiff}
              diffStyle="unified"
              hunkSeparators="simple"
              virtualized={false}
              annotations={annotations()}
              renderAnnotation={props.inline ? () => host : undefined}
            />
            <Show when={props.bottom || value().hunk.bottom}>
              <div class="am-pr-diff-context-marker">...</div>
            </Show>
          </div>
        )}
      </Show>
    </>
  )
}
