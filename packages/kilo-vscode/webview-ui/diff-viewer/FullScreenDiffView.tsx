import { type Component, createSignal, createMemo, createEffect, on, onCleanup, Show, type JSXElement } from "solid-js"
// Styles are imported by the component so every consumer (sidebar diff viewer,
// agent manager, storybook) picks them up automatically. Keep these imports here —
// see tests/unit/diff-viewer-css-arch.test.ts for the invariant.
import "../agent-manager/agent-manager.css"
import "../agent-manager/agent-manager-review.css"
import "../agent-manager/pr/pr-panel.css"
import "./remote-comments.css"
import { Accordion } from "@kilocode/kilo-ui/accordion"
import { RadioGroup } from "@kilocode/kilo-ui/radio-group"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { ResizeHandle } from "@kilocode/kilo-ui/resize-handle"
import { TooltipKeybind } from "@kilocode/kilo-ui/tooltip"
import { useLanguage } from "../src/context/language"
import { FileTree } from "./FileTree"
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
import { createDiffViewport } from "./diff-requests"
import { RemoteCommentsOutside } from "./remote-comment-renderer"
import { ReviewDiffItem } from "./ReviewDiffItem"
import { createReviewView, type ReviewViewProps } from "./review-controller"
import { notice, reviewSendAllKeybind } from "./review-setup"

type DiffStyle = "unified" | "split"

interface FullScreenDiffViewProps extends ReviewViewProps {
  loading: boolean
  sessionId?: string
  /** Well-known source notice kind (e.g. "snapshots-disabled"), shown as a banner. */
  notice?: string
  diffStyle: DiffStyle
  onDiffStyleChange: (style: DiffStyle) => void
  onMarkdownRenderChange?: (render: boolean) => void
  initialFile?: string
  onRevertFile?: (file: string) => void
  revertingFiles?: Set<string>
  /** Defaults to true. Hides the per-file Revert action when false. */
  canRevert?: boolean
  /** Optional leading content rendered first in the toolbar's left group. */
  lead?: JSXElement
  onClose: () => void
}

export const FullScreenDiffView: Component<FullScreenDiffViewProps> = (props) => {
  const { t } = useLanguage()
  const noticeText = () => notice(t, props.notice)
  const sendAllKeybind = () => reviewSendAllKeybind(t)
  let rootRef: HTMLDivElement | undefined
  const {
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
  } = createReviewView(props, () => rootRef)

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
  let syncFrame: number | undefined

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
                    const annotations = remote.annotations(diff.file)
                    return (
                      <ReviewDiffItem
                        diff={diff}
                        open={open}
                        viewport={viewport}
                        request={props.onRequestDiff ? request : undefined}
                        loading={() => props.loadingFiles?.has(diff.file) ?? false}
                        comments={() => (commentsByFile().get(diff.file) ?? []).length + remote.fileCount(diff.file)}
                        diffStyle={() => props.diffStyle}
                        markdownRender={() => props.markdownRender ?? false}
                        handle={(handle) => register(diff.file, handle)}
                        scrollTo={(offset) => virtualizer()?.scrollTo(offset)}
                        annotations={() => [...review.annotationsForFile(diff.file), ...annotations()]}
                        renderAnnotation={render}
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
          <RemoteCommentsOutside controller={remote} />
        </div>
      </div>
    </div>
  )
}
