import type { FileDiffInfo } from "@opencode/client"
import { Diff } from "@kilocode/kilo-ui/diff"
import { DiffChanges } from "@kilocode/kilo-ui/diff-changes"
import { FileIcon } from "@kilocode/kilo-ui/file-icon"
import { For, Show, createMemo } from "solid-js"
import { useLanguage } from "../context/language"

function splitPath(file: string) {
  const normalized = file.replaceAll("\\", "/")
  const separator = normalized.lastIndexOf("/")
  if (separator === -1) return { name: file, directory: undefined }
  return { name: normalized.slice(separator + 1), directory: normalized.slice(0, separator) }
}

/** The proposed changes of an edit or write permission request, rendered beside the approval controls. */
export function PermissionDiff(props: { files: FileDiffInfo[] }) {
  const language = useLanguage()
  return (
    <div data-slot="permission-diffs" data-count={props.files.length}>
      <For each={props.files}>
        {(file) => {
          const path = createMemo(() => splitPath(file.file))
          // `patch` is required by the type, but older or plugin-provided metadata can omit it.
          const patch = () => (typeof file.patch === "string" ? file.patch : "")
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
                <Show
                  when={/^@@/m.test(patch())}
                  fallback={<div data-slot="permission-diff-empty">{language.t("ui.permission.noChanges")}</div>}
                >
                  <Diff patch={patch()} diffStyle="unified" hunkSeparators="simple" />
                </Show>
              </div>
            </div>
          )
        }}
      </For>
    </div>
  )
}
