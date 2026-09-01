import { createEffect, type Accessor, type Component, Show } from "solid-js"
import { Accordion } from "@kilocode/kilo-ui/accordion"
import { Diff } from "@kilocode/kilo-ui/diff"
import { DiffChanges } from "@kilocode/kilo-ui/diff-changes"
import { FileIcon } from "@kilocode/kilo-ui/file-icon"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { StickyAccordionHeader } from "@kilocode/kilo-ui/sticky-accordion-header"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import type { DiffLineAnnotation, SelectedLineRange } from "@pierre/diffs"
import type { WorktreeFileDiff } from "../src/types/messages"
import { KILO_FILE_PATH_MIME } from "../src/utils/path-mentions"
import { useLanguage } from "../src/context/language"
import { diffSizeKey } from "./diff-state"
import type { DiffViewport } from "./diff-requests"
import { isDiffExpandable, isLargeDiffFile, shouldVirtualizeDiff } from "./diff-open-policy"
import { isMarkdownFile, MarkdownDiffView } from "./MarkdownDiffView"
import { ImageDiffView } from "./ImageDiffView"
import type { AnnotationMeta } from "./review-annotations"

type Props = {
  diff: WorktreeFileDiff
  open: Accessor<string[]>
  viewport: DiffViewport
  request: (diff: WorktreeFileDiff, visible?: () => boolean) => void
  active?: Accessor<boolean>
  loading: Accessor<boolean>
  comments: Accessor<number>
  diffStyle: Accessor<"unified" | "split">
  markdownRender: Accessor<boolean>
  annotations: () => DiffLineAnnotation<AnnotationMeta>[]
  renderAnnotation: (annotation: DiffLineAnnotation<AnnotationMeta>) => HTMLElement | undefined
  onGutterUtilityClick: (range: SelectedLineRange) => void
  onOpenFile?: (file: string, line?: number) => void
  onOpenDocument?: (file: string) => void
  onRevertFile?: (file: string) => void
  reverting: Accessor<boolean>
  onMarkdownRenderChange?: (render: boolean) => void
  canComment: Accessor<boolean>
  sessionKey?: string
  sessionReviewSlot?: boolean
  showLoadingSpinner?: boolean
}

export const ReviewDiffItem: Component<Props> = (props) => {
  const { t } = useLanguage()
  const isAdded = () => props.diff.status === "added"
  const isDeleted = () => props.diff.status === "deleted"
  const isLargeCollapsed = () => isLargeDiffFile(props.diff) && !props.open().includes(props.diff.file)
  const active = () => props.active?.() ?? true

  createEffect(() => {
    if (!props.viewport.visible() || !props.open().includes(props.diff.file) || !active()) return
    props.request(props.diff, props.viewport.intersects)
  })

  return (
    <Accordion.Item
      ref={props.viewport.ref}
      value={props.diff.file}
      data-slot={props.sessionReviewSlot ? "session-review-accordion-item" : undefined}
      data-file-path={props.diff.file}
    >
      <StickyAccordionHeader>
        <Accordion.Trigger>
          <div data-slot="session-review-trigger-content">
            <div
              data-slot="session-review-file-info"
              draggable={true}
              onDragStart={(event: DragEvent) => {
                event.dataTransfer?.setData(KILO_FILE_PATH_MIME, props.diff.file)
                event.dataTransfer?.setData("text/plain", props.diff.file)
                event.stopPropagation()
              }}
            >
              <FileIcon node={{ path: props.diff.file, type: "file" }} />
              <div data-slot="session-review-file-name-container">
                <Show when={props.diff.file.includes("/")}>
                  <span data-slot="session-review-directory">{`\u2066${getDirectory(props.diff.file)}\u2069`}</span>
                </Show>
                <span data-slot="session-review-filename">{getFilename(props.diff.file)}</span>
                <Show when={props.comments() > 0}>
                  <span class="am-diff-file-badge">{props.comments()}</span>
                </Show>
              </div>
            </div>
            <div data-slot="session-review-trigger-actions">
              <Show when={isAdded()}>
                <span data-slot="session-review-change" data-type="added">
                  {t("ui.sessionReview.change.added")}
                </span>
              </Show>
              <Show when={isDeleted()}>
                <span data-slot="session-review-change" data-type="removed">
                  {t("ui.sessionReview.change.removed")}
                </span>
              </Show>
              <DiffChanges changes={props.diff} />
              <Show when={props.diff.kind === "image"}>
                <span class="am-diff-summary-pill">{t("agentManager.review.image")}</span>
              </Show>
              <Show when={isLargeCollapsed()}>
                <span class="am-diff-large-pill">{t("agentManager.review.largeFileCollapsed")}</span>
              </Show>
              <Show when={props.diff.tracked === false}>
                <span class="am-diff-summary-pill">untracked</span>
              </Show>
              <Show when={props.diff.generatedLike === true}>
                <span class="am-diff-summary-pill">generated</span>
              </Show>
              <Show when={props.onOpenFile && !isDeleted()}>
                <Tooltip value={t("agentManager.diff.openFile")} placement="top">
                  <IconButton
                    icon="go-to-file"
                    size="small"
                    variant="ghost"
                    label={t("agentManager.diff.openFile")}
                    onClick={(event: MouseEvent) => {
                      event.stopPropagation()
                      props.onOpenFile?.(props.diff.file)
                    }}
                  />
                </Tooltip>
              </Show>
              <Show when={isMarkdownFile(props.diff.file) && props.onOpenDocument && !isDeleted()}>
                <Tooltip value={t("agentManager.documents.preview")} placement="top">
                  <IconButton
                    icon="book-open-check"
                    size="small"
                    variant="ghost"
                    label={t("agentManager.documents.preview")}
                    onClick={(event: MouseEvent) => {
                      event.stopPropagation()
                      props.onOpenDocument?.(props.diff.file)
                    }}
                  />
                </Tooltip>
              </Show>
              <Show when={props.onRevertFile}>
                <Tooltip value={t("agentManager.diff.revertFile")} placement="top">
                  <IconButton
                    icon="discard"
                    size="small"
                    variant="ghost"
                    class="am-diff-revert-btn"
                    label={t("agentManager.diff.revertFile")}
                    disabled={props.reverting()}
                    onClick={(event: MouseEvent) => {
                      event.stopPropagation()
                      props.onRevertFile?.(props.diff.file)
                    }}
                  />
                </Tooltip>
              </Show>
              <Show when={isMarkdownFile(props.diff.file) && props.onMarkdownRenderChange}>
                <Tooltip value={props.markdownRender() ? "Show raw Markdown" : "Render Markdown"} placement="top">
                  <IconButton
                    icon={props.markdownRender() ? "code" : "eye"}
                    size="small"
                    variant="ghost"
                    label={props.markdownRender() ? "Show raw Markdown" : "Render Markdown"}
                    onClick={(event: MouseEvent) => {
                      event.stopPropagation()
                      props.onMarkdownRenderChange?.(!props.markdownRender())
                    }}
                  />
                </Tooltip>
              </Show>
              <Show when={isDiffExpandable(props.diff)}>
                <span data-slot="session-review-diff-chevron">
                  <Icon name="chevron-down" size="small" />
                </span>
              </Show>
            </div>
          </div>
        </Accordion.Trigger>
      </StickyAccordionHeader>
      <Accordion.Content>
        <Show when={props.open().includes(props.diff.file)}>
          <Show
            when={props.diff.summarized !== true}
            fallback={
              <div class="am-diff-summary-state">
                <Show when={props.loading()} fallback={<span>Diff preview loads on demand.</span>}>
                  <Show when={props.showLoadingSpinner}>
                    <Spinner />
                  </Show>
                  <span>Loading diff...</span>
                </Show>
              </div>
            }
          >
            <Show
              when={props.diff.kind === "image"}
              fallback={
                <Show
                  when={props.markdownRender() && isMarkdownFile(props.diff.file)}
                  fallback={
                    <Diff<AnnotationMeta>
                      before={{ name: props.diff.file, contents: props.diff.before }}
                      after={{ name: props.diff.file, contents: props.diff.after }}
                      patch={props.diff.patch}
                      diffStyle={props.diffStyle()}
                      sizeKey={diffSizeKey(props.sessionKey, props.diff, props.diffStyle())}
                      virtualized={shouldVirtualizeDiff(props.diff)}
                      visible={props.viewport.visible() && active()}
                      annotations={props.annotations()}
                      renderAnnotation={props.renderAnnotation}
                      enableGutterUtility={props.canComment()}
                      onGutterUtilityClick={props.onGutterUtilityClick}
                      onLineNumberClick={(event) => {
                        if (event.annotationSide === "deletions") return
                        props.onOpenFile?.(props.diff.file, event.lineNumber)
                      }}
                    />
                  }
                >
                  <MarkdownDiffView
                    diff={props.diff}
                    annotations={props.annotations()}
                    renderAnnotation={props.renderAnnotation}
                    enableGutterUtility={props.canComment()}
                    onGutterUtilityClick={props.onGutterUtilityClick}
                    onLineNumberClick={(event) => {
                      if (event.annotationSide === "deletions") return
                      props.onOpenFile?.(props.diff.file, event.lineNumber)
                    }}
                  />
                </Show>
              }
            >
              <ImageDiffView diff={props.diff} />
            </Show>
          </Show>
        </Show>
      </Accordion.Content>
    </Accordion.Item>
  )
}

function getDirectory(path: string): string {
  const index = path.lastIndexOf("/")
  return index === -1 ? "" : path.slice(0, index + 1)
}

function getFilename(path: string): string {
  const index = path.lastIndexOf("/")
  return index === -1 ? path : path.slice(index + 1)
}
