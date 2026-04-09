import { type Component, createMemo } from "solid-js"
import { Diff } from "@kilocode/kilo-ui/diff"
import { DiffChanges } from "@kilocode/kilo-ui/diff-changes"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import type { PermissionFileDiff } from "../../types/messages"
import { useVSCode } from "../../context/vscode"

interface PermissionDiffProps {
  filediff: PermissionFileDiff
}

export const PermissionDiff: Component<PermissionDiffProps> = (props) => {
  const vscode = useVSCode()
  const filename = createMemo(() => {
    const parts = props.filediff.file.split("/")
    return parts[parts.length - 1] ?? props.filediff.file
  })

  const directory = createMemo(() => {
    const parts = props.filediff.file.split("/")
    if (parts.length <= 1) return null
    return parts.slice(0, -1).join("/")
  })

  const openInTab = () => {
    vscode.postMessage({
      type: "openDiffVirtual",
      diff: props.filediff,
    })
  }

  return (
    <div data-slot="permission-diff">
      <div data-slot="permission-diff-header">
        <div data-slot="permission-diff-file-info">
          <div data-slot="permission-diff-icon">
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              data-component="file-icon"
            >
              <path
                d="M3 2C3 1.44772 3.44772 1 4 1H10.1716C10.4368 1 10.6911 1.10536 10.8787 1.29289L13.7071 4.12132C13.8946 4.30886 14 4.56312 14 4.82843V13C14 13.5523 13.5523 14 13 14H4C3.44772 14 3 13.5523 3 13V2Z"
                fill="var(--vscode-editorLineNumber-foreground, #858585)"
                stroke="var(--vscode-editorLineNumber-foreground, #858585)"
                stroke-width="0.5"
              />
            </svg>
          </div>
          <div data-slot="permission-diff-filename">
            {directory() && <span data-slot="permission-diff-directory">{directory()}/</span>}
            <span data-slot="permission-diff-name">{filename()}</span>
          </div>
        </div>
        <div data-slot="permission-diff-actions">
          <DiffChanges changes={props.filediff} />
          <Tooltip value="View in new tab">
            <IconButton size="small" icon="expand" onClick={openInTab} aria-label="View diff in new tab" />
          </Tooltip>
        </div>
      </div>
      <div data-slot="permission-diff-content">
        <Diff
          before={{ name: props.filediff.file, contents: props.filediff.before ?? "" }}
          after={{ name: props.filediff.file, contents: props.filediff.after ?? "" }}
          diffStyle="unified"
        />
      </div>
    </div>
  )
}
