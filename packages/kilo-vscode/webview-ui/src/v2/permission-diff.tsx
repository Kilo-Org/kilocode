import type { FileDiffInfo } from "@opencode/client"
import { Diff } from "@kilocode/kilo-ui/diff"
import { DiffChanges } from "@kilocode/kilo-ui/diff-changes"
import { FileIcon } from "@kilocode/kilo-ui/file-icon"
import { normalize } from "@kilocode/kilo-ui/session-diff"
import { For, Show, createMemo } from "solid-js"

function splitPath(file: string) {
  const parts = file.split("/")
  if (parts.length === 1) return { name: file, directory: undefined }
  return { name: parts[parts.length - 1] ?? file, directory: parts.slice(0, -1).join("/") }
}

/** The proposed changes of an edit or write permission request, rendered beside the approval controls. */
export function PermissionDiff(props: { files: FileDiffInfo[] }) {
  return (
    <div data-slot="permission-diffs" data-count={props.files.length}>
      <For each={props.files}>
        {(file) => {
          const path = createMemo(() => splitPath(file.file))
          const view = createMemo(() => normalize(file))
          return (
            <div data-slot="permission-diff">
              <div data-slot="permission-diff-header">
                <div data-slot="permission-diff-file-info">
                  <div data-slot="permission-diff-icon">
                    <FileIcon node={{ path: file.file, type: "file" }} />
                  </div>
                  <div data-slot="permission-diff-filename">
                    <Show when={path().directory}>
                      {(directory) => <span data-slot="permission-diff-directory">{`\u2066${directory()}/\u2069`}</span>}
                    </Show>
                    <span data-slot="permission-diff-name">{path().name}</span>
                  </div>
                </div>
                <div data-slot="permission-diff-actions">
                  <DiffChanges changes={file} />
                </div>
              </div>
              <div data-slot="permission-diff-content">
                <Diff fileDiff={view().fileDiff} diffStyle="unified" hunkSeparators="simple" visible={true} />
              </div>
            </div>
          )
        }}
      </For>
    </div>
  )
}
