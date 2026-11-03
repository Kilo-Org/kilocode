import { createEffect, createMemo, on, onCleanup, Show, type Component } from "solid-js"
import { Diff } from "@kilocode/kilo-ui/diff"
import { FileIcon } from "@kilocode/kilo-ui/file-icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { RadioGroup } from "@kilocode/kilo-ui/radio-group"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { normalize } from "@kilocode/kilo-ui/session-diff"
import { useLanguage } from "../src/context/language"
import { EXTREME_DIFF_CHANGED_LINES } from "./diff-open-policy"
import { isMarkdownFile, MarkdownDiffView } from "./MarkdownDiffView"
import { diffCounts } from "../agent-manager/edit-preview"

export interface VirtualDiffFile {
  file: string
  patch?: string
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified"
  files?: VirtualDiffFile[]
}

export interface VirtualDiffViewProps {
  diff: VirtualDiffFile
  diffStyle: "unified" | "split"
  onDiffStyleChange: (style: "unified" | "split") => void
  markdownRender: boolean
  onMarkdownRenderChange: (render: boolean) => void
  /** Hidden when a shared control already drives every stacked file. */
  styleSelect?: boolean
}

export const VirtualDiffView: Component<VirtualDiffViewProps> = (props) => {
  const { t } = useLanguage()
  let scroller: HTMLDivElement | undefined

  createEffect(
    on(
      () => props.diff,
      () => {
        if (scroller) scroller.scrollTop = 0
      },
      { defer: true },
    ),
  )

  onCleanup(() => {
    scroller = undefined
  })

  const filename = () => {
    const file = props.diff.file
    return file.includes("/") ? (file.split("/").pop() ?? file) : file
  }

  const directory = () => {
    const file = props.diff.file
    if (!file.includes("/")) return null
    return file.split("/").slice(0, -1).join("/")
  }

  // A patch that Pierre cannot turn into hunks has nothing to show; the caller
  // renders the unavailable state instead of an empty diff container.
  const view = createMemo(() => {
    if (!props.diff.patch) return
    const value = normalize(props.diff)
    if (!value.fileDiff.hunks.length) return
    return value
  })

  // Provided counts win, but some added files report 0 while the patch has
  // real changed lines. Hunk counts exclude context lines.
  const counts = createMemo(() => {
    const value = view()
    if (!value) return { additions: props.diff.additions, deletions: props.diff.deletions }
    return diffCounts(props.diff, value.fileDiff.hunks, props.diff.status)
  })

  // Hunk-bounded patches render fully and let the surrounding list scroll, so a
  // small change no longer reserves a tall pane. Only unbounded or extreme
  // diffs keep Pierre's own virtualizer, which needs a capped scroll box.
  const heavy = createMemo(
    () => !props.diff.patch || counts().additions + counts().deletions > EXTREME_DIFF_CHANGED_LINES,
  )

  return (
    <div class="am-review-layout" data-virtualized={heavy() ? "true" : undefined}>
      <div class="am-review-toolbar">
        <div class="am-review-toolbar-left">
          <Show when={props.styleSelect !== false}>
            <RadioGroup
              options={["unified", "split"] as const}
              current={props.diffStyle}
              value={(style) => style}
              label={(style) =>
                style === "unified" ? t("ui.sessionReview.diffStyle.unified") : t("ui.sessionReview.diffStyle.split")
              }
              size="small"
              onSelect={(style) => {
                if (style) props.onDiffStyleChange(style)
              }}
            />
          </Show>
          <span class="am-review-toolbar-stats">
            <FileIcon node={{ path: props.diff.file, type: "file" }} />
            <Show when={directory()}>
              <span class="am-review-toolbar-dir">{`\u2066${directory()}/\u2069`}</span>
            </Show>
            <span class="am-review-toolbar-fname">{filename()}</span>
            <span class="am-review-toolbar-adds">+{counts().additions}</span>
            <span class="am-review-toolbar-dels">-{counts().deletions}</span>
          </span>
        </div>
        <Show when={isMarkdownFile(props.diff.file)}>
          <Tooltip value={props.markdownRender ? "Show raw Markdown" : "Render Markdown"} placement="bottom">
            <IconButton
              icon={props.markdownRender ? "code" : "eye"}
              size="small"
              variant="ghost"
              label={props.markdownRender ? "Show raw Markdown" : "Render Markdown"}
              onClick={() => props.onMarkdownRenderChange(!props.markdownRender)}
            />
          </Tooltip>
        </Show>
      </div>
      <div class="am-review-diff" style={{ width: "100%" }} ref={(el) => (scroller = el)}>
        <Show
          when={view()}
          fallback={<div class="am-edit-preview-unavailable">Diff preview unavailable for this file.</div>}
        >
          {(current) => (
            <Show
              when={props.markdownRender && isMarkdownFile(props.diff.file)}
              fallback={
                <Diff
                  fileDiff={current().fileDiff}
                  diffStyle={props.diffStyle}
                  hunkSeparators="simple"
                  virtualized={heavy()}
                />
              }
            >
              <MarkdownDiffView diff={{ file: props.diff.file, before: current().before, after: current().after }} />
            </Show>
          )}
        </Show>
      </div>
    </div>
  )
}
