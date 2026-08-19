import { Show, createMemo } from "solid-js"
import { Diff } from "@kilocode/kilo-ui/diff"
import { normalizeHunk } from "@kilocode/kilo-ui/session-diff"

export function PRCommentDiff(props: { file: string; hunk: string }) {
  const view = createMemo(() => normalizeHunk(props.file, props.hunk))

  return (
    <Show when={view()}>
      {(value) => (
        <div class="am-pr-diff-hunk">
          <Diff fileDiff={value().fileDiff} diffStyle="unified" virtualized={false} />
        </div>
      )}
    </Show>
  )
}
