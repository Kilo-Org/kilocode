import { Show } from "solid-js"
import { useI18n } from "../context/i18n"
import { IconButton } from "./icon-button"
import { Tooltip } from "./tooltip"
import type { FileDiffInfo } from "@opencode/client"
import { normalizeHunk } from "./session-diff"

export function patchPreview(file: FileDiffInfo) {
  const diff = normalizeHunk(file.file, file.patch)
  if (diff) return { file: file.file, patch: diff.patch, additions: file.additions, deletions: file.deletions, status: file.status }
}

export function ToolDiffAction(props: { when: boolean; onClick: (event: MouseEvent) => void }) {
  const i18n = useI18n()
  return (
    <Show when={props.when}>
      <span data-slot="tool-trigger-actions">
        <Tooltip value={i18n.t("ui.messagePart.openInDiffViewer")} placement="top" gutter={4}>
          <IconButton
            icon="square-arrow-top-right"
            size="small"
            variant="ghost"
            onMouseDown={(e) => e.preventDefault()}
            onClick={props.onClick}
            aria-label={i18n.t("ui.messagePart.openInDiffViewer")}
          />
        </Tooltip>
      </span>
    </Show>
  )
}
