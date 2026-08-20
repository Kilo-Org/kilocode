import { Show, createMemo } from "solid-js"
import { Diff } from "@kilocode/kilo-ui/diff"
import { normalizeHunk } from "@kilocode/kilo-ui/session-diff"
import { displayHunk } from "../agent-manager/pr/pr-comment-payload"

export function PRCommentDiff(props: { file: string; line?: number; hunk: string; after?: string[] }) {
  const input = createMemo(
    () => ({ file: props.file, line: props.line, hunk: props.hunk, after: (props.after ?? []).join("\n") }),
    undefined,
    { equals: (a, b) => a.file === b.file && a.line === b.line && a.hunk === b.hunk && a.after === b.after },
  )
  const view = createMemo(() => {
    const data = input()
    const hunk = displayHunk(data.hunk, data.line, data.after ? data.after.split("\n") : undefined)
    const value = normalizeHunk(data.file, hunk.patch)
    return value ? { hunk, value } : undefined
  })

  return (
    <Show when={view()}>
      {(value) => (
        <div class="am-pr-diff-hunk">
          <Show when={value().hunk.top}>
            <div class="am-pr-diff-context-marker">...</div>
          </Show>
          <Diff fileDiff={value().value.fileDiff} diffStyle="unified" hunkSeparators="simple" virtualized={false} />
          <Show when={value().hunk.bottom}>
            <div class="am-pr-diff-context-marker">...</div>
          </Show>
        </div>
      )}
    </Show>
  )
}
