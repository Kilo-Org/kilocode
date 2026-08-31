import { type Component, createSignal, createMemo, createEffect, on, onCleanup, Show, type JSXElement } from "solid-js"
import type { VirtualizerHandle } from "virtua/solid"
// Styles are imported by the component so every consumer (sidebar diff viewer,
// agent manager, storybook) picks them up automatically. Keep these imports here —
// see tests/unit/diff-viewer-css-arch.test.ts for the invariant.
import "../agent-manager/agent-manager.css"
import "../agent-manager/agent-manager-review.css"
import { Accordion } from "@kilocode/kilo-ui/accordion"
import { RadioGroup } from "@kilocode/kilo-ui/radio-group"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { ResizeHandle } from "@kilocode/kilo-ui/resize-handle"
import { TooltipKeybind } from "@kilocode/kilo-ui/tooltip"
import type { WorktreeFileDiff } from "../src/types/messages"
import { useLanguage } from "../src/context/language"
import { FileTree } from "./FileTree"
import { treeOrder } from "./file-tree-utils"
import type { ReviewComment } from "./review-comments"
import { createReviewComposer, type ReviewComposer } from "./review-annotations"
import {
  LONG_DIFF_MARKER_FILE_COUNT,
  allOpenFiles,
  isDiffExpandable,
  isLargeDiffFile,
  sanitizeOpenFiles,
  toggleOpenFiles,
} from "./diff-open-policy"
import { DiffEndMarker } from "./DiffEndMarker"
import { VirtualDiffList } from "./VirtualDiffList"
import { createDiffRows } from "./diff-state"
import { createDiffRequests, createDiffViewport } from "./diff-requests"
import { ReviewDiffItem } from "./ReviewDiffItem"
import { createReviewOpenState } from "./review-state"
import { createReviewScrollPreserver } from "./review-scroll"
import { createReviewController } from "./review-controller"
import { keepsNativeFocus, notice, reviewFocus, reviewSendAllKeybind } from "./review-setup"

type DiffStyle = "unified" | "split"

interface FullScreenDiffViewProps {
  diffs: WorktreeFileDiff[]
  loading: boolean
  loadingFiles?: Set<string>
  sessionId?: string
  sessionKey?: string
  /** Well-known source notice kind (e.g. "snapshots-disabled"), shown as a banner. */
  notice?: string
  comments: ReviewComment[]
  onCommentsChange: (comments: ReviewComment[]) => void
  composer?: ReviewComposer
  onSendAll?: () => void
  onSendClick?: () => void
  diffStyle: DiffStyle
  onDiffStyleChange: (style: DiffStyle) => void
  markdownRender?: boolean
  onMarkdownRenderChange?: (render: boolean) => void
  onRequestDiff?: (file: string) => void
  onOpenFile?: (relativePath: string, line?: number) => void
  initialFile?: string
  onRevertFile?: (file: string) => void
  revertingFiles?: Set<string>
  activeTerminalId?: string
  /** Defaults to true. Hides the per-file Revert action when false. */
  canRevert?: boolean
  /** Defaults to true. Disables comment creation and "Send all" when false. */
  canComment?: boolean
  /** Optional leading content rendered first in the toolbar's left group. */
  lead?: JSXElement
  onClose: () => void
}

export const FullScreenDiffView: Component<FullScreenDiffViewProps> = (props) => {
  const { t } = useLanguage()
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

  const [manualActiveFile, setManualActiveFile] = createSignal<Record<string, string | null>>({})
  const activeFile = createMemo(() => {
    const key = props.sessionKey ?? ""
    const diffs = props.diffs
    if (diffs.length === 0) return null
    const manual = manualActiveFile()[key]
    if (manual && diffs.some((d) => d.file === manual)) return manual
    return diffs[0]?.file ?? null
  })
  const setActiveFile = (file: string | null) => {
    const key = props.sessionKey ?? ""
    setManualActiveFile((prev) => ({ ...prev, [key]: file }))
  }

  const [treeWidth, setTreeWidth] = createSignal(240)
  let initialFileKey: string | undefined
  let rootRef: HTMLDivElement | undefined
  const [scroller, setScroller] = createSignal<HTMLDivElement>()
  const [virtualizer, setVirtualizer] = createSignal<VirtualizerHandle>()
  let syncFrame: number | undefined

  // Reorder diffs to match the file-tree's depth-first visual order so
  // scrolling through the diff panel matches the tree on the left.
  const sorted = createMemo(() => treeOrder(props.diffs))
  const rows = createDiffRows(sorted, () => props.sessionKey)

  const setComments = (next: ReviewComment[]) => props.onCommentsChange(next)
  const comments = () => props.comments

  const focusRoot = () => reviewFocus(() => rootRef)

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
    canComment: () => props.canComment !== false,
    onSendClick: props.onSendClick,
    onSendAll: props.onSendAll,
  })
  const {
    pinned,
    commentsByFile,
    annotationsForFile,
    buildAnnotation,
    handleGutterClick,
    sendAllToChat,
    sendAllClick,
  } = review

  createEffect(
    on(
      () => [props.sessionKey, props.diffs, props.initialFile] as const,
      ([key, diffs, initial]) => {
        if (!initial || !diffs.some((diff) => diff.file === initial)) return
        const next = `${key ?? ""}:${initial}`
        if (initialFileKey === next) return
        initialFileKey = next
        setActiveFile(initial)
      },
    ),
  )
  const request = createDiffRequests({
    key: () => props.sessionKey,
    diffs: () => props.diffs,
    open,
    loading: () => props.loadingFiles,
    send: () => props.onRequestDiff,
    eager: false,
  })

  const handleRootMouseDown = (e: MouseEvent) => {
    if (keepsNativeFocus(e.target)) return
    focusRoot()
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Enter") return
    if (!(e.metaKey || e.ctrlKey)) return
    const target = e.target
    if (keepsNativeFocus(target)) return
    if (props.canComment === false) return
    if (comments().length === 0) return
    e.preventDefault()
    e.stopPropagation()
    sendAllToChat()
  }

  const handleFileSelect = (path: string) => {
    const diff = props.diffs.find((item) => item.file === path)
    if (diff) request(diff)
    setActiveFile(path)
    if (diff && isDiffExpandable(diff) && !open().includes(path)) setOpen((prev) => [...prev, path])
    requestAnimationFrame(() => {
      const index = rows().findIndex((diff) => diff.file === path)
      if (index < 0) return
      const handle = virtualizer()
      const current = handle?.findItemIndex(handle.scrollOffset) ?? index
      virtualizer()?.scrollToIndex(index, { offset: -8, smooth: Math.abs(index - current) <= 8 })
    })
  }

  const handleExpandAll = () => {
    setOpen(toggleOpenFiles(props.diffs, open()))
  }

  const syncActiveFileFromScroll = () => {
    const handle = virtualizer()
    if (!handle) return
    const file = rows()[handle.findItemIndex(handle.scrollOffset)]?.file
    if (file) setActiveFile(file)
  }

  const scheduleSyncActiveFile = () => {
    if (syncFrame !== undefined) cancelAnimationFrame(syncFrame)
    syncFrame = requestAnimationFrame(() => {
      syncFrame = undefined
      syncActiveFileFromScroll()
    })
  }

  // Keep file tree selection in sync with viewport during scroll in both directions.
  createEffect(() => {
    const container = scroller()
    if (!container) return
    const onScroll = () => scheduleSyncActiveFile()
    const resize = new ResizeObserver(() => scheduleSyncActiveFile())
    container.addEventListener("scroll", onScroll, { passive: true })
    resize.observe(container)
    scheduleSyncActiveFile()

    onCleanup(() => {
      container.removeEventListener("scroll", onScroll)
      resize.disconnect()
      if (syncFrame !== undefined) {
        cancelAnimationFrame(syncFrame)
        syncFrame = undefined
      }
    })
  })

  createEffect(
    on(
      () => [props.diffs, open()] as const,
      () => scheduleSyncActiveFile(),
    ),
  )

  const totals = createMemo(() => ({
    files: props.diffs.length,
    additions: props.diffs.reduce((s, d) => s + d.additions, 0),
    deletions: props.diffs.reduce((s, d) => s + d.deletions, 0),
    large: props.diffs.filter((diff) => isDiffExpandable(diff) && isLargeDiffFile(diff)).length,
    collapsed: props.diffs.filter((diff) => isDiffExpandable(diff) && !open().includes(diff.file)).length,
  }))
  const allOpen = createMemo(() => allOpenFiles(props.diffs, open()))
  const openLabel = () => (allOpen() ? t("ui.sessionReview.collapseAll") : t("ui.sessionReview.expandAll"))

  return (
    <div
      class="am-review-layout"
      onKeyDown={handleKeyDown}
      onMouseDown={handleRootMouseDown}
      tabIndex={-1}
      ref={rootRef}
    >
      {/* Toolbar */}
      <div class="am-review-toolbar">
        <div class="am-review-toolbar-left">
          <Show when={props.lead}>{props.lead}</Show>
          <RadioGroup
            options={["unified", "split"] as const}
            current={props.diffStyle}
            size="small"
            value={(style) => style}
            label={(style) =>
              style === "unified" ? t("ui.sessionReview.diffStyle.unified") : t("ui.sessionReview.diffStyle.split")
            }
            onSelect={(style) => {
              if (style) props.onDiffStyleChange(style)
            }}
          />
          <span class="am-review-toolbar-stats">
            <span>{t("session.review.filesChanged", { count: totals().files })}</span>
            <span class="am-review-toolbar-adds">+{totals().additions}</span>
            <span class="am-review-toolbar-dels">-{totals().deletions}</span>
            <Show when={totals().collapsed > 0}>
              <span class="am-review-toolbar-collapsed">
                {totals().large > 0
                  ? t("agentManager.review.collapsedWithLarge", {
                      collapsed: totals().collapsed,
                      large: totals().large,
                    })
                  : t("agentManager.review.collapsedOnly", { count: totals().collapsed })}
              </span>
            </Show>
          </span>
        </div>
        <div class="am-review-toolbar-right">
          <Button size="small" variant="ghost" onClick={handleExpandAll}>
            <Icon name="chevron-grabber-vertical" size="small" />
            {openLabel()}
          </Button>
          <Show when={comments().length > 0 && props.canComment !== false}>
            <TooltipKeybind
              title={t("agentManager.review.sendAllToChat")}
              keybind={sendAllKeybind()}
              placement="bottom"
            >
              <Button variant="primary" size="small" onClick={sendAllClick}>
                {t("agentManager.review.sendAllToChatWithCount", { count: comments().length })}
              </Button>
            </TooltipKeybind>
          </Show>
          <IconButton icon="close" size="small" variant="ghost" label={t("common.close")} onClick={props.onClose} />
        </div>
      </div>

      {/* Body: file tree + diff viewer */}
      <div class="am-review-body">
        <div class="am-review-tree-resize" style={{ width: `${treeWidth()}px` }}>
          <div class="am-review-tree-wrapper">
            <FileTree
              diffs={props.diffs}
              activeFile={activeFile()}
              onFileSelect={handleFileSelect}
              comments={comments()}
              onRevertFile={props.canRevert !== false ? props.onRevertFile : undefined}
              revertingFiles={props.revertingFiles}
            />
          </div>
          <ResizeHandle
            direction="horizontal"
            edge="end"
            size={treeWidth()}
            min={160}
            max={400}
            onResize={(w) => setTreeWidth(Math.max(160, Math.min(w, 400)))}
          />
        </div>
        <div class="am-review-diff" ref={setScroller}>
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
              <Spinner />
              <span>{t("session.review.loadingChanges")}</span>
            </div>
          </Show>

          <Show when={!props.loading && props.diffs.length === 0 && !noticeText()}>
            <div class="am-diff-empty">
              <span>{t("session.review.noChanges")}</span>
            </div>
          </Show>

          <Show when={props.diffs.length > 0}>
            <div class="am-review-diff-content" data-component="session-review">
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
                        loading={() => props.loadingFiles?.has(diff.file) ?? false}
                        comments={() => (commentsByFile().get(diff.file) ?? []).length}
                        diffStyle={() => props.diffStyle}
                        markdownRender={() => props.markdownRender ?? false}
                        annotations={() => annotationsForFile(diff.file)}
                        renderAnnotation={buildAnnotation}
                        onGutterUtilityClick={(result) => handleGutterClick(diff.file, result)}
                        onOpenFile={props.onOpenFile}
                        onRevertFile={props.canRevert !== false ? props.onRevertFile : undefined}
                        reverting={() => props.revertingFiles?.has(diff.file) ?? false}
                        onMarkdownRenderChange={props.onMarkdownRenderChange}
                        canComment={() => props.canComment !== false}
                        sessionKey={props.sessionKey}
                        showLoadingSpinner
                      />
                    )
                  }}
                />
              </Accordion>
              <Show when={props.diffs.length > LONG_DIFF_MARKER_FILE_COUNT}>
                <DiffEndMarker />
              </Show>
            </div>
          </Show>
        </div>
      </div>
    </div>
  )
}
