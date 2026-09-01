import { type Component, createSignal, createMemo, createEffect, on, Show, type JSXElement } from "solid-js"
import type { VirtualizerHandle } from "virtua/solid"
import type { DiffLineAnnotation } from "@pierre/diffs"
import type { DiffHandle } from "@kilocode/kilo-ui/pierre"
import { Accordion } from "@kilocode/kilo-ui/accordion"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip, TooltipKeybind } from "@kilocode/kilo-ui/tooltip"
import type { WorktreeFileDiff } from "../src/types/messages"
import { useLanguage } from "../src/context/language"
import { useVSCode } from "../src/context/vscode"
import { DiffStyleSelect } from "../diff-viewer/InlineSelect"
import type { ReviewComment } from "../diff-viewer/review-comments"
import { createReviewComposer, type AnnotationMeta, type ReviewComposer } from "../diff-viewer/review-annotations"
import {
  LONG_DIFF_MARKER_FILE_COUNT,
  allOpenFiles,
  isDiffExpandable,
  isLargeDiffFile,
  sanitizeOpenFiles,
  shouldVirtualizeDiff,
  toggleOpenFiles,
} from "../diff-viewer/diff-open-policy"
import { isMarkdownFile } from "../diff-viewer/MarkdownDiffView"
import { DiffEndMarker } from "../diff-viewer/DiffEndMarker"
import { VirtualDiffList } from "../diff-viewer/VirtualDiffList"
import { treeOrder } from "../diff-viewer/file-tree-utils"
import { createDiffRows } from "../diff-viewer/diff-state"
import { createDiffRequests, createDiffViewport } from "../diff-viewer/diff-requests"
import "./pr/pr-panel.css"
import "../diff-viewer/remote-comments.css"
import {
  createRemoteCommentController,
  createRemoteFocus,
  RemoteCommentsOutside,
  type DiffAnnotationMeta,
} from "../diff-viewer/remote-comment-renderer"
import type { PRComment } from "./pr/pr-types"
import { ReviewDiffItem } from "../diff-viewer/ReviewDiffItem"
import { createReviewOpenState } from "../diff-viewer/review-state"
import { createReviewScrollPreserver } from "../diff-viewer/review-scroll"
import { createReviewController } from "../diff-viewer/review-controller"
import { keepsNativeFocus, notice, reviewFocus, reviewSendAllKeybind } from "../diff-viewer/review-setup"

// --- Data model ---

interface DiffPanelProps {
  diffs: WorktreeFileDiff[]
  loading: boolean
  active?: boolean
  loadingFiles?: Set<string>
  sessionId?: string
  sessionKey?: string
  /** Well-known source notice kind (e.g. "snapshots-disabled"), shown as a banner. */
  notice?: string
  diffStyle?: "unified" | "split"
  onDiffStyleChange?: (style: "unified" | "split") => void
  markdownRender?: boolean
  onMarkdownRenderChange?: (render: boolean) => void
  comments: ReviewComment[]
  onCommentsChange: (comments: ReviewComment[]) => void
  composer?: ReviewComposer
  onSendAll?: () => void
  onSendClick?: () => void
  onClose: () => void
  onExpand?: () => void
  onRequestDiff?: (file: string) => void
  onOpenFile?: (relativePath: string, line?: number) => void
  onOpenDocument?: (relativePath: string) => void
  onRevertFile?: (file: string) => void
  revertingFiles?: Set<string>
  activeTerminalId?: string
  /** Optional leading row rendered under the header (e.g. the scope selector). */
  lead?: JSXElement
  /** Defaults to true. Hides the per-file Revert action when false. */
  canRevert?: boolean
  remoteComments?: PRComment[]
  focusedComment?: { id: string; file: string }
}

export const DiffPanel: Component<DiffPanelProps> = (props) => {
  const { t } = useLanguage()
  const vscode = useVSCode()
  const noticeText = () => notice(t, props.notice)
  const sendAllKeybind = () => reviewSendAllKeybind(t)
  const localComposer = createReviewComposer()
  const composer = () => props.composer ?? localComposer
  const reviewOpen = createReviewOpenState(
    () => props.diffs,
    () => props.sessionKey,
  )
  const open = reviewOpen.open
  const setOpen = reviewOpen.setOpen
  // Reorder diffs to match the file-tree's depth-first visual order so
  // scrolling through the accordion matches the tree grouping.
  const sorted = createMemo(() => treeOrder(props.diffs))
  const rows = createDiffRows(sorted, () => props.sessionKey)
  const remote = createRemoteCommentController({
    key: () => props.sessionKey,
    comments: () => props.remoteComments,
    loading: () => props.loadingFiles,
    diffs: () => rows(),
    active: () => true,
    activeTerminalId: () => props.activeTerminalId,
    onSendClick: props.onSendClick,
    onOpenFile: props.onOpenFile,
    onOpenUrl: (url) => vscode.postMessage({ type: "openExternal", url }),
  })
  const handles = new Map<string, DiffHandle>()
  const reveal = (file: string) => {
    const diff = props.diffs.find((item) => item.file === file)
    if (!diff || (props.markdownRender && isMarkdownFile(file)) || !shouldVirtualizeDiff(diff)) return true
    const target = props.focusedComment
    const anchor = target
      ? remote
          .map()
          .anchors.get(file)
          ?.find((item) => item.comments.some((comment) => comment.threadId === target.id))
      : undefined
    return anchor ? (handles.get(file)?.scrollToLine(anchor.line, anchor.side) ?? false) : false
  }
  const register = (file: string, handle: DiffHandle | undefined) => {
    if (!handle) return void handles.delete(file)
    handles.set(file, handle)
    if (focusFile() === file) reveal(file)
  }

  const setComments = (next: ReviewComment[]) => props.onCommentsChange(next)
  const comments = () => props.comments

  // Ref to the scrollable container — used to preserve scroll position when
  // annotation changes cause pierre to fully re-render diffs
  let rootRef: HTMLDivElement | undefined
  const [scroller, setScroller] = createSignal<HTMLDivElement>()
  const [virtualizer, setVirtualizer] = createSignal<VirtualizerHandle>()
  const [focusFile, setFocusFile] = createSignal<string>()
  const focus = createRemoteFocus(() => rootRef, setFocusFile, {
    root: scroller,
    to: (offset) => virtualizer()?.scrollTo(offset),
  })

  createEffect(
    on(
      () => [props.active, props.sessionKey] as const,
      ([active]) => {
        if (active === false) focus.stop()
      },
      { defer: true },
    ),
  )

  const focusRoot = () => reviewFocus(() => rootRef)

  // Preserve the visible file and its intra-row offset while Pierre rebuilds a
  // row. Raw scrollTop is not stable once the virtualizer remeasures dynamic rows.
  const preserveScroll = createReviewScrollPreserver(rows, virtualizer)
  const review = createReviewController({
    diffs: () => props.diffs,
    rows,
    comments: () => props.comments,
    setComments,
    composer,
    key: () => props.sessionKey,
    preserveScroll,
    focus: focusRoot,
    label: t,
    activeTerminalId: () => props.activeTerminalId,
    active: () => props.active !== false,
    onSendClick: props.onSendClick,
    onSendAll: props.onSendAll,
  })
  const { commentsByFile, handleGutterClick, sendAllToChat, sendAllClick } = review
  const pinned = createMemo(() => {
    const keep = new Set(review.pinned())
    const target = focusFile()
    return rows().flatMap((diff, index) => (keep.has(index) || diff.file === target ? [index] : []))
  })
  const annotations = (file: string): DiffLineAnnotation<DiffAnnotationMeta>[] => [
    ...review.annotationsForFile(file),
    ...remote.annotations(file),
  ]
  const render = (annotation: DiffLineAnnotation<DiffAnnotationMeta>): HTMLElement | undefined => {
    if (annotation.metadata?.type === "remote") return remote.render(annotation.metadata)
    return review.buildAnnotation(annotation as DiffLineAnnotation<AnnotationMeta>)
  }

  const request = createDiffRequests({
    key: () => props.sessionKey,
    diffs: () => props.diffs,
    open,
    loading: () => props.loadingFiles,
    send: () => (props.active === false ? undefined : props.onRequestDiff),
    eager: false,
  })

  createEffect(
    on(
      () => [props.focusedComment, props.active, props.sessionKey, virtualizer()] as const,
      ([target]) => {
        if (!target || props.active === false) {
          focus.stop()
          return
        }
        focus.request(
          target.id,
          target.file,
          () => {
            remote.open(target.id)
            const diff = props.diffs.find((item) => item.file === target.file)
            if (!diff) return
            if (isDiffExpandable(diff) && !open().includes(target.file)) setOpen((prev) => [...prev, target.file])
            const index = rows().findIndex((item) => item.file === target.file)
            if (index >= 0) virtualizer()?.scrollToIndex(index, { offset: -8, smooth: false })
            request(diff)
          },
          () => remote.location(target.file, target.id),
          () => reveal(target.file),
        )
      },
    ),
  )

  const handleRootMouseDown = (e: MouseEvent) => {
    if (keepsNativeFocus(e.target)) return
    focusRoot()
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Enter") return
    if (!(e.metaKey || e.ctrlKey)) return
    const target = e.target
    if (keepsNativeFocus(target)) return
    if (comments().length === 0) return
    e.preventDefault()
    e.stopPropagation()
    sendAllToChat()
  }

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

      <Show when={noticeText()}>
        <div class="diff-viewer-notice" role="status">
          <span class="diff-viewer-notice-icon">
            <Icon name="warning" size="small" />
          </span>
          <span class="diff-viewer-notice-text">{noticeText()}</span>
        </div>
      </Show>

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
                return (
                  <ReviewDiffItem
                    diff={diff}
                    open={open}
                    viewport={viewport}
                    request={request}
                    active={() => props.active !== false}
                    loading={() => props.loadingFiles?.has(diff.file) ?? false}
                    comments={() => (commentsByFile().get(diff.file) ?? []).length + remote.fileCount(diff.file)}
                    diffStyle={() => props.diffStyle ?? "unified"}
                    markdownRender={() => props.markdownRender ?? false}
                    handle={(handle) => register(diff.file, handle)}
                    scrollTo={(offset) => virtualizer()?.scrollTo(offset)}
                    annotations={() => annotations(diff.file)}
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
            <TooltipKeybind title={t("agentManager.review.sendAllToChat")} keybind={sendAllKeybind()} placement="top">
              <Button variant="primary" size="small" onClick={sendAllClick}>
                {t("agentManager.review.sendAllToChat")}
              </Button>
            </TooltipKeybind>
          </div>
        </Show>
      </Show>
    </div>
  )
}
