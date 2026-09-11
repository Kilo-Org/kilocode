import { type Component, createMemo, Show, type JSXElement } from "solid-js"
import { Accordion } from "@kilocode/kilo-ui/accordion"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { DiffStyleSelect } from "../diff-viewer/InlineSelect"
import {
  LONG_DIFF_MARKER_FILE_COUNT,
  allOpenFiles,
  isDiffExpandable,
  isLargeDiffFile,
  sanitizeOpenFiles,
  toggleOpenFiles,
} from "../diff-viewer/diff-open-policy"
import { DiffEndMarker } from "../diff-viewer/DiffEndMarker"
import { DiffViewerNotice } from "../diff-viewer/DiffViewerNotice"
import { VirtualDiffList } from "../diff-viewer/VirtualDiffList"
import { createDiffViewport } from "../diff-viewer/diff-requests"
import "./pr/pr-panel.css"
import "../diff-viewer/remote-comments.css"
import { RemoteCommentsOutside } from "../diff-viewer/remote-comment-renderer"
import { ReviewDiffItem } from "../diff-viewer/ReviewDiffItem"
import { type ReviewViewProps } from "../diff-viewer/review-controller"
import { SendAllButton } from "../diff-viewer/SendAllButton"
import { createReviewSurface } from "../diff-viewer/review-surface"
import type { PRDiffSnapshot, PRTarget } from "../../src/shared/pr-comment-actions"

// --- Data model ---

interface DiffPanelProps extends ReviewViewProps {
  loading: boolean
  sessionId?: string
  /** Well-known source notice kind (e.g. "snapshots-disabled"), shown as a banner. */
  notice?: string
  diffStyle?: "unified" | "split"
  onDiffStyleChange?: (style: "unified" | "split") => void
  onMarkdownRenderChange?: (render: boolean) => void
  onClose: () => void
  onExpand?: () => void
  onOpenDocument?: (relativePath: string) => void
  onRevertFile?: (file: string) => void
  revertingFiles?: Set<string>
  /** Optional leading row rendered under the header (e.g. the scope selector). */
  lead?: JSXElement
  /** Defaults to true. Hides the per-file Revert action when false. */
  canRevert?: boolean
  prTarget?: PRTarget
  prSnapshot?: PRDiffSnapshot
  prLoading?: boolean
  prError?: string
}

export const DiffPanel: Component<DiffPanelProps> = (props) => {
  let rootRef: HTMLDivElement | undefined
  const {
    t,
    noticeText,
    sendAllKeybind,
    open,
    setOpen,
    rows,
    remote,
    register,
    scroller,
    setScroller,
    virtualizer,
    setVirtualizer,
    comments,
    review,
    pinned,
    render,
    request,
    handleRootMouseDown,
    handleKeyDown,
    commentsByFile,
    handleGutterClick,
    sendAllClick,
    sendAllToGithub,
    sendAllGithubCount,
    sendAllGithubAvailable,
    sendAllPending,
    sendAllError,
  } = createReviewSurface(props, () => rootRef)

  const handleExpandAll = () => {
    setOpen(toggleOpenFiles(props.diffs, open()))
  }

  const totals = createMemo(() => ({
    files: props.diffs.length,
    additions: props.diffs.reduce((sum, diff) => sum + diff.additions, 0),
    deletions: props.diffs.reduce((sum, diff) => sum + diff.deletions, 0),
    large: props.diffs.filter((diff) => isDiffExpandable(diff) && isLargeDiffFile(diff)).length,
    collapsed: props.diffs.filter((diff) => isDiffExpandable(diff) && !open().includes(diff.file)).length,
  }))
  const allOpen = createMemo(() => allOpenFiles(props.diffs, open()))
  const openLabel = () => (allOpen() ? t("ui.sessionReview.collapseAll") : t("ui.sessionReview.expandAll"))
  const openIcon = () => (allOpen() ? "files-collapse" : "files-expand")

  return (
    <div class="am-diff-panel" onKeyDown={handleKeyDown} onMouseDown={handleRootMouseDown} tabIndex={-1} ref={rootRef}>
      <div class="am-diff-header">
        <div class="am-diff-header-main">
          {/* Scope + base picker replace the static "Changes" title: it names
              what you're looking at and is the primary control. Always shown,
              so an empty scope can still be switched away from. */}
          <Show when={props.lead}>{props.lead}</Show>
          <Show when={props.prTarget}>
            {(target) => (
              <span class="am-diff-pr-context" title={target().prUrl}>
                {t("diffViewer.comment.prContext", { number: target().prNumber })}
                <Show when={props.prLoading}>
                  <Spinner />
                </Show>
              </span>
            )}
          </Show>
          <Show when={props.diffs.length > 0}>
            <>
              <DiffStyleSelect
                value={props.diffStyle ?? "unified"}
                onSelect={(style) => props.onDiffStyleChange?.(style)}
                unifiedLabel={t("ui.sessionReview.diffStyle.unified")}
                splitLabel={t("ui.sessionReview.diffStyle.split")}
                title={t("ui.sessionReview.diffStyle.unified")}
              />
              <span class="am-diff-header-stats">
                <span>{t("session.review.filesChanged", { count: totals().files })}</span>
                <span class="am-diff-header-adds">+{totals().additions}</span>
                <span class="am-diff-header-dels">-{totals().deletions}</span>
                <Show when={totals().collapsed > 0}>
                  <span class="am-diff-header-collapsed">
                    {totals().large > 0
                      ? t("agentManager.review.collapsedWithLarge", {
                          collapsed: totals().collapsed,
                          large: totals().large,
                        })
                      : t("agentManager.review.collapsedOnly", { count: totals().collapsed })}
                  </span>
                </Show>
              </span>
            </>
          </Show>
        </div>
        <div class="am-diff-header-actions">
          <Show when={props.diffs.length > 0}>
            <Tooltip value={openLabel()} placement="bottom">
              <IconButton
                icon={openIcon()}
                size="small"
                variant="ghost"
                label={openLabel()}
                onClick={handleExpandAll}
              />
            </Tooltip>
          </Show>
          <Show when={props.onExpand}>
            <Tooltip value={t("command.review.toggle")} placement="bottom">
              <IconButton
                icon="expand"
                size="small"
                variant="ghost"
                label={t("command.review.toggle")}
                onClick={() => props.onExpand?.()}
              />
            </Tooltip>
          </Show>
          <IconButton icon="close" size="small" variant="ghost" label={t("common.close")} onClick={props.onClose} />
        </div>
      </div>
      <DiffViewerNotice text={props.prError} role="alert" />

      <DiffViewerNotice text={noticeText()} role="status" />

      <Show when={props.loading && props.diffs.length === 0}>
        <div class="am-diff-loading">
          <span>{t("session.review.loadingChanges")}</span>
        </div>
      </Show>

      <Show when={!props.loading && props.diffs.length === 0 && !noticeText()}>
        <div class="am-diff-empty">
          <span>{t("session.review.noChanges")}</span>
        </div>
      </Show>

      <Show when={props.diffs.length > 0} fallback={<RemoteCommentsOutside controller={remote} />}>
        <div class="am-diff-content" data-component="session-review" ref={setScroller}>
          <Accordion multiple value={open()} onChange={(files) => setOpen(sanitizeOpenFiles(props.diffs, files))}>
            <VirtualDiffList
              context={props.sessionKey}
              data={rows()}
              scroll={scroller()}
              keep={pinned()}
              onReady={setVirtualizer}
              render={(diff) => {
                const viewport = createDiffViewport(scroller)
                const annotations = remote.annotations(diff.file)
                return (
                  <ReviewDiffItem
                    diff={diff}
                    open={open}
                    viewport={viewport}
                    request={props.onRequestDiff ? request : undefined}
                    active={() => props.active !== false}
                    loading={() => props.loadingFiles?.has(diff.file) ?? false}
                    comments={() => (commentsByFile().get(diff.file) ?? []).length + remote.fileCount(diff.file)}
                    diffStyle={() => props.diffStyle ?? "unified"}
                    markdownRender={() => props.markdownRender ?? false}
                    handle={(handle) => register(diff.file, handle)}
                    scrollTo={(offset) => virtualizer()?.scrollTo(offset)}
                    annotations={() => [...review.annotationsForFile(diff.file), ...annotations()]}
                    renderAnnotation={render}
                    onGutterUtilityClick={(result) => handleGutterClick(diff.file, result)}
                    onOpenFile={props.onOpenFile}
                    onOpenDocument={props.onOpenDocument}
                    onRevertFile={props.canRevert !== false ? props.onRevertFile : undefined}
                    reverting={() => props.revertingFiles?.has(diff.file) ?? false}
                    onMarkdownRenderChange={props.onMarkdownRenderChange}
                    canComment={() => true}
                    sessionKey={props.sessionKey}
                    sessionReviewSlot
                  />
                )
              }}
            />
          </Accordion>
          <Show when={props.diffs.length > LONG_DIFF_MARKER_FILE_COUNT}>
            <DiffEndMarker />
          </Show>
          <RemoteCommentsOutside controller={remote} />
        </div>

        <Show when={comments().length > 0}>
          <div class="am-diff-comments-footer">
            <span class="am-diff-comments-count">
              {comments().length} comment{comments().length !== 1 ? "s" : ""}
            </span>
            <Show when={sendAllError()}>
              <span class="am-review-send-error" role="alert">
                {sendAllError()}
              </span>
            </Show>
            <SendAllButton
              count={comments().length}
              githubCount={sendAllGithubCount()}
              githubNumber={sendAllGithubAvailable() ? props.prTarget?.prNumber : undefined}
              pending={sendAllPending()}
              onSendChat={sendAllClick}
              onSendGithub={sendAllToGithub}
              keybind={sendAllKeybind()}
            />
          </div>
        </Show>
      </Show>
    </div>
  )
}
