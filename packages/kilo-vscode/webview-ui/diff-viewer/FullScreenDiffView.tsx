import { type Component, createSignal, createMemo, createEffect, on, onCleanup, Show } from "solid-js"
import type { VirtualizerHandle } from "virtua/solid"
// Styles are imported by the component so every consumer (sidebar diff viewer,
// agent manager, storybook) picks them up automatically. Keep these imports here —
// see tests/unit/diff-viewer-css-arch.test.ts for the invariant.
import "../agent-manager/agent-manager.css"
import "../agent-manager/agent-manager-review.css"
import { Diff } from "@kilocode/kilo-ui/diff"
import { Accordion } from "@kilocode/kilo-ui/accordion"
import { StickyAccordionHeader } from "@kilocode/kilo-ui/sticky-accordion-header"
import { FileIcon } from "@kilocode/kilo-ui/file-icon"
import { DiffChanges } from "@kilocode/kilo-ui/diff-changes"
import { RadioGroup } from "@kilocode/kilo-ui/radio-group"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { ResizeHandle } from "@kilocode/kilo-ui/resize-handle"
import { Tooltip, TooltipKeybind } from "@kilocode/kilo-ui/tooltip"
import type { DiffLineAnnotation, AnnotationSide, SelectedLineRange } from "@pierre/diffs"
import type { WorktreeFileDiff } from "../src/types/messages"
import { KILO_FILE_PATH_MIME } from "../src/utils/path-mentions"
import { useLanguage } from "../src/context/language"
import { useVSCode } from "../src/context/vscode"
import { useServer } from "../src/context/server"
import { useProvider } from "../src/context/provider"
import { useConfig } from "../src/context/config"
import { canUseSpeechToText, selectedSpeechToTextModel } from "../src/components/speech-to-text/availability"
import { useSpeechToText } from "../src/components/speech-to-text/useSpeechToText"
import { FileTree } from "./FileTree"
import { treeOrder } from "./file-tree-utils"
import { getDirectory, getFilename, lineCount, sanitizeReviewComments, type ReviewComment } from "./review-comments"
import {
  buildFileAnnotations,
  buildReviewAnnotation,
  clearReviewComposer,
  createReviewComposer,
  reviewComposerDraft,
  reviewComposerEdit,
  reviewDraftSpeechKey,
  reviewEditSpeechKey,
  type AnnotationLabels,
  type AnnotationMeta,
  type ReviewComposer,
  type ReviewDraft,
} from "./review-annotations"
import { createReviewAnnotationSpeechRenderer } from "./review-annotation-speech"
import {
  LONG_DIFF_MARKER_FILE_COUNT,
  allOpenFiles,
  initialOpenFiles,
  isDiffExpandable,
  isLargeDiffFile,
  sanitizeOpenFiles,
  shouldVirtualizeDiff,
  toggleOpenFiles,
} from "./diff-open-policy"
import { DiffEndMarker } from "./DiffEndMarker"
import { VirtualDiffList } from "./VirtualDiffList"
import { isMarkdownFile, MarkdownDiffView } from "./MarkdownDiffView"
import { createDiffRows, diffToken } from "./diff-state"

type DiffStyle = "unified" | "split"

interface FullScreenDiffViewProps {
  diffs: WorktreeFileDiff[]
  loading: boolean
  loadingFiles?: Set<string>
  sessionId?: string
  sessionKey?: string
  comments: ReviewComment[]
  onCommentsChange: (comments: ReviewComment[]) => void
  composer?: ReviewComposer
  onSendAll?: () => void
  diffStyle: DiffStyle
  onDiffStyleChange: (style: DiffStyle) => void
  markdownRender?: boolean
  onMarkdownRenderChange?: (render: boolean) => void
  onRequestDiff?: (file: string) => void
  onOpenFile?: (relativePath: string, line?: number) => void
  onRevertFile?: (file: string) => void
  revertingFiles?: Set<string>
  activeTerminalId?: string
  /** Defaults to true. Hides the per-file Revert action when false. */
  canRevert?: boolean
  /** Defaults to true. Disables comment creation and "Send all" when false. */
  canComment?: boolean
  onClose: () => void
}

export const FullScreenDiffView: Component<FullScreenDiffViewProps> = (props) => {
  const { t } = useLanguage()
  const vscode = useVSCode()
  const server = useServer()
  const provider = useProvider()
  const { config } = useConfig()
  const speech = useSpeechToText(vscode, server, { t })
  const canUseSpeech = () => canUseSpeechToText(config(), provider.connected(), server.profileData())
  const speechModel = () => selectedSpeechToTextModel(config())
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent)
  const sendAllKeybind = () =>
    isMac ? t("agentManager.review.sendAllShortcut.mac") : t("agentManager.review.sendAllShortcut.other")
  const labels = (): AnnotationLabels => ({
    commentOnLine: (line) => t("agentManager.review.commentOnLine", { line }),
    editCommentOnLine: (line) => t("agentManager.review.editCommentOnLine", { line }),
    placeholder: t("agentManager.review.commentPlaceholder"),
    cancel: t("common.cancel"),
    comment: t("agentManager.review.commentAction"),
    save: t("common.save"),
    sendToChat: t("agentManager.review.sendToChat"),
    edit: t("common.edit"),
    delete: t("common.delete"),
  })
  const localComposer = createReviewComposer()
  const composer = () => props.composer ?? localComposer
  const [open, setOpen] = createSignal<string[]>([])
  const [draft, setDraft] = createSignal<ReviewDraft | null>(reviewComposerDraft(composer()))
  const [editing, setEditing] = createSignal<string | null>(reviewComposerEdit(composer()))
  const speechKeys = createMemo(() => {
    const keys = new Set<string>()
    const current = draft()
    const edit = editing()
    if (current) keys.add(reviewDraftSpeechKey(current))
    if (edit) keys.add(reviewEditSpeechKey(edit))
    return keys
  })
  const reviewSpeech = createReviewAnnotationSpeechRenderer({
    speech,
    enabled: canUseSpeech,
    model: speechModel,
    label: t,
    keys: speechKeys,
  })
  const [activeFile, setActiveFile] = createSignal<string | null>(null)
  const [treeWidth, setTreeWidth] = createSignal(240)
  let nextId = 0
  let draftMeta: AnnotationMeta | null = composer().draft
  let editMeta: AnnotationMeta | null = composer().edit
  // Initialize each worktree with every file expanded, then preserve manual
  // collapse state while adding and removing files from live summaries.
  let initializedKey: string | undefined
  let known = new Set<string>()
  const requested = new Map<string, string>()
  let rootRef: HTMLDivElement | undefined
  const [scroller, setScroller] = createSignal<HTMLDivElement>()
  const [virtualizer, setVirtualizer] = createSignal<VirtualizerHandle>()
  let syncFrame: number | undefined

  // Reorder diffs to match the file-tree's depth-first visual order so
  // scrolling through the diff panel matches the tree on the left.
  const sorted = createMemo(() => treeOrder(props.diffs))
  const rows = createDiffRows(sorted, () => props.sessionKey)

  const comments = () => props.comments
  const setComments = (next: ReviewComment[]) => props.onCommentsChange(next)
  const updateComments = (updater: (prev: ReviewComment[]) => ReviewComment[]) => setComments(updater(comments()))

  const focusRoot = () => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        rootRef?.focus()
      })
    })
  }

  const keepNativeFocus = (target: EventTarget | null) => {
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) return true
    if (target instanceof HTMLElement && target.isContentEditable) return true
    return false
  }

  const preserveScroll = (fn: () => void) => {
    const handle = virtualizer()
    const index = handle?.findStartIndex()
    const file = index === undefined ? undefined : rows()[index]?.file
    const offset = index === undefined ? 0 : (handle?.scrollOffset ?? 0) - (handle?.getItemOffset(index) ?? 0)
    fn()
    if (!file) return
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const next = rows().findIndex((diff) => diff.file === file)
        if (next < 0) return
        virtualizer()?.scrollToIndex(next, { offset })
      })
    })
  }

  const cancelDraft = () => {
    preserveScroll(() => {
      setDraft(null)
      draftMeta = null
      composer().draft = null
    })
    focusRoot()
  }

  // Unified open-state effect: tracks both sessionKey and diffs in a single effect
  // to eliminate the race condition between the old separate sessionKey-reset and
  // diffs-watch effects. Uses the session key to decide when initialization is needed
  // vs when we just prune stale entries from the open list.
  createEffect(
    on(
      () => [props.sessionKey, props.diffs] as const,
      ([key, diffs]) => {
        if (diffs.length === 0) {
          // No diffs yet — clear active file only for a new key; keep current
          // selection for transient empty updates in the same key.
          if (key !== initializedKey) setActiveFile(null)
          return
        }

        const fileSet = new Set(diffs.map((diff) => diff.file))

        // Keep active file in sync — pick first if current is stale
        const current = activeFile()
        if (!current || !diffs.some((d) => d.file === current)) {
          setActiveFile(diffs[0]!.file)
        }

        // New context: initialize open state from the diff policy.
        if (key !== initializedKey) {
          initializedKey = key
          known = fileSet
          setOpen(initialOpenFiles(diffs))
          return
        }

        // Preserve manual collapse state for known files, while keeping newly
        // arriving files expanded when a live summary grows.
        const added = diffs.filter((diff) => !known.has(diff.file)).map((diff) => diff.file)
        known = fileSet
        setOpen((prev) => {
          const next = sanitizeOpenFiles(diffs, [...prev.filter((file) => fileSet.has(file)), ...added])
          if (next.length === prev.length && next.every((file, index) => file === prev[index])) return prev
          return next
        })
      },
    ),
  )

  createEffect(
    on(
      () => props.sessionKey,
      () => {
        requested.clear()
        setDraft(null)
        draftMeta = null
        setEditing(null)
        editMeta = null
        clearReviewComposer(composer())
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => [open(), props.diffs] as const,
      ([next]) => {
        const files = new Set(next)
        for (const file of requested.keys()) {
          if (!files.has(file)) requested.delete(file)
        }
        if (!props.onRequestDiff) return
        for (const file of next) {
          if (props.loadingFiles?.has(file)) continue
          const diff = props.diffs.find((item) => item.file === file)
          if (!diff || !isDiffExpandable(diff) || diff.summarized !== true) continue
          const value = diffToken(diff)
          if (requested.get(file) === value) continue
          requested.set(file, value)
          props.onRequestDiff(file)
        }
      },
      { defer: true },
    ),
  )

  // --- CRUD ---

  const addComment = (file: string, side: AnnotationSide, line: number, text: string, selectedText: string) => {
    preserveScroll(() => {
      const id = `c-${++nextId}-${Date.now()}`
      updateComments((prev) => [...prev, { id, file, side, line, comment: text, selectedText }])
      setDraft(null)
      draftMeta = null
      composer().draft = null
    })
    focusRoot()
  }

  const updateComment = (id: string, text: string) => {
    preserveScroll(() => {
      updateComments((prev) => prev.map((c) => (c.id === id ? { ...c, comment: text } : c)))
      setEditing(null)
      editMeta = null
      composer().edit = null
    })
    focusRoot()
  }

  const deleteComment = (id: string) => {
    preserveScroll(() => {
      updateComments((prev) => prev.filter((c) => c.id !== id))
      if (editing() === id) {
        setEditing(null)
        editMeta = null
        composer().edit = null
      }
    })
    focusRoot()
  }

  const setEditState = (id: string | null) => {
    if (editing() !== id) {
      editMeta = null
      composer().edit = null
    }
    preserveScroll(() => setEditing(id))
    if (id === null) focusRoot()
  }

  const handleRootMouseDown = (e: MouseEvent) => {
    if (keepNativeFocus(e.target)) return
    focusRoot()
  }

  createEffect(
    on(
      () => [props.diffs, comments()] as const,
      ([diffs, current]) => {
        const valid = sanitizeReviewComments(current, diffs)
        if (valid.length !== current.length) {
          setComments(valid)
        }

        const edit = editing()
        if (edit && !valid.some((comment) => comment.id === edit)) {
          setEditing(null)
          editMeta = null
          composer().edit = null
        }

        const currentDraft = draft()
        if (!currentDraft) return
        const diff = diffs.find((item) => item.file === currentDraft.file)
        if (!diff) {
          setDraft(null)
          draftMeta = null
          composer().draft = null
          return
        }
        const content = currentDraft.side === "deletions" ? diff.before : diff.after
        const max = lineCount(content)
        if (currentDraft.line < 1 || currentDraft.line > max) {
          setDraft(null)
          draftMeta = null
          composer().draft = null
          return
        }
        if (currentDraft.endLine !== undefined && currentDraft.endLine > max) {
          setDraft(null)
          draftMeta = null
          composer().draft = null
        }
      },
    ),
  )

  // --- Per-file memoized annotations ---

  const commentsByFile = createMemo(() => {
    const map = new Map<string, ReviewComment[]>()
    for (const c of comments()) {
      const arr = map.get(c.file) ?? []
      arr.push(c)
      map.set(c.file, arr)
    }
    return map
  })
  const pinned = createMemo(() => {
    const files = new Set<string>()
    const current = draft()
    if (current) files.add(current.file)
    const edit = editing()
    if (edit) {
      const comment = comments().find((item) => item.id === edit)
      if (comment) files.add(comment.file)
    }
    return rows().flatMap((diff, index) => (files.has(diff.file) ? [index] : []))
  })

  const annotationsForFile = (file: string): DiffLineAnnotation<AnnotationMeta>[] => {
    const result = buildFileAnnotations(file, commentsByFile().get(file) ?? [], editing(), draft(), draftMeta, editMeta)
    draftMeta = result.draftMeta
    editMeta = result.editMeta
    composer().draft = draft() ? draftMeta : null
    composer().edit = editing() ? editMeta : null
    return result.annotations
  }

  const buildAnnotation = (annotation: DiffLineAnnotation<AnnotationMeta>): HTMLElement | undefined => {
    return buildReviewAnnotation(annotation, {
      diffs: props.diffs,
      editing: editing(),
      setEditing: setEditState,
      addComment,
      updateComment,
      deleteComment,
      cancelDraft,
      labels: labels(),
      activeTerminalId: props.activeTerminalId,
      speech: reviewSpeech,
    })
  }

  const handleGutterClick = (file: string, range: SelectedLineRange) => {
    if (props.canComment === false) return
    if (draft()) return
    const side: AnnotationSide = range.side === "deletions" ? "deletions" : "additions"
    preserveScroll(() => {
      const next = { file, side, line: range.start, endLine: range.end }
      draftMeta = { type: "draft", comment: null, ...next }
      composer().draft = draftMeta
      setDraft(next)
    })
  }

  const sendAllToChat = () => {
    const all = comments()
    if (all.length === 0) return
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: props.activeTerminalId ? "appendReviewCommentsToTerminal" : "appendReviewComments",
          comments: all,
          autoSend: true,
          targetTerminalId: props.activeTerminalId,
        },
      }),
    )
    preserveScroll(() => setComments([]))
    props.onSendAll?.()
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Enter") return
    if (!(e.metaKey || e.ctrlKey)) return
    const target = e.target
    if (keepNativeFocus(target)) return
    if (props.canComment === false) return
    if (comments().length === 0) return
    e.preventDefault()
    e.stopPropagation()
    sendAllToChat()
  }

  const handleFileSelect = (path: string) => {
    setActiveFile(path)
    const diff = props.diffs.find((item) => item.file === path)
    if (diff && isDiffExpandable(diff) && !open().includes(path)) setOpen((prev) => [...prev, path])
    requestAnimationFrame(() => {
      const index = rows().findIndex((diff) => diff.file === path)
      if (index < 0) return
      const current = virtualizer()?.findStartIndex() ?? index
      virtualizer()?.scrollToIndex(index, { offset: -8, smooth: Math.abs(index - current) <= 8 })
    })
  }

  const handleExpandAll = () => {
    setOpen(toggleOpenFiles(props.diffs, open()))
  }

  const syncActiveFileFromScroll = () => {
    const handle = virtualizer()
    if (!handle) return
    const file = rows()[handle.findStartIndex()]?.file
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
              <Button variant="primary" size="small" onClick={sendAllToChat}>
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
          <Show when={props.loading && props.diffs.length === 0}>
            <div class="am-diff-loading">
              <Spinner />
              <span>{t("session.review.loadingChanges")}</span>
            </div>
          </Show>

          <Show when={!props.loading && props.diffs.length === 0}>
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
                    const isAdded = () => diff.status === "added"
                    const isDeleted = () => diff.status === "deleted"
                    const isLargeCollapsed = () => isLargeDiffFile(diff) && !open().includes(diff.file)
                    const isLoadingDetail = () => props.loadingFiles?.has(diff.file) ?? false
                    const fileCommentCount = () => (commentsByFile().get(diff.file) ?? []).length

                    return (
                      <Accordion.Item value={diff.file} data-file-path={diff.file}>
                        <StickyAccordionHeader>
                          <Accordion.Trigger>
                            <div data-slot="session-review-trigger-content">
                              <div
                                data-slot="session-review-file-info"
                                draggable={true}
                                onDragStart={(e: DragEvent) => {
                                  e.dataTransfer?.setData(KILO_FILE_PATH_MIME, diff.file)
                                  e.dataTransfer?.setData("text/plain", diff.file)
                                  e.stopPropagation()
                                }}
                              >
                                <FileIcon node={{ path: diff.file, type: "file" }} />
                                <div data-slot="session-review-file-name-container">
                                  <Show when={diff.file.includes("/")}>
                                    <span data-slot="session-review-directory">{`\u2066${getDirectory(diff.file)}\u2069`}</span>
                                  </Show>
                                  <span data-slot="session-review-filename">{getFilename(diff.file)}</span>
                                  <Show when={fileCommentCount() > 0}>
                                    <span class="am-diff-file-badge">{fileCommentCount()}</span>
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
                                <DiffChanges changes={diff} />
                                <Show when={isLargeCollapsed()}>
                                  <span class="am-diff-large-pill">{t("agentManager.review.largeFileCollapsed")}</span>
                                </Show>
                                <Show when={diff.tracked === false}>
                                  <span class="am-diff-summary-pill">untracked</span>
                                </Show>
                                <Show when={diff.generatedLike === true}>
                                  <span class="am-diff-summary-pill">generated</span>
                                </Show>
                                <Show when={props.onOpenFile && !isDeleted()}>
                                  <Tooltip value={t("agentManager.diff.openFile")} placement="top">
                                    <IconButton
                                      icon="go-to-file"
                                      size="small"
                                      variant="ghost"
                                      label={t("agentManager.diff.openFile")}
                                      onClick={(e: MouseEvent) => {
                                        e.stopPropagation()
                                        props.onOpenFile?.(diff.file)
                                      }}
                                    />
                                  </Tooltip>
                                </Show>
                                <Show when={props.onRevertFile && props.canRevert !== false}>
                                  <Tooltip value={t("agentManager.diff.revertFile")} placement="top">
                                    <IconButton
                                      icon="discard"
                                      size="small"
                                      variant="ghost"
                                      class="am-diff-revert-btn"
                                      label={t("agentManager.diff.revertFile")}
                                      disabled={props.revertingFiles?.has(diff.file) ?? false}
                                      onClick={(e: MouseEvent) => {
                                        e.stopPropagation()
                                        props.onRevertFile?.(diff.file)
                                      }}
                                    />
                                  </Tooltip>
                                </Show>
                                <Show when={isMarkdownFile(diff.file) && props.onMarkdownRenderChange}>
                                  <Tooltip
                                    value={props.markdownRender ? "Show raw Markdown" : "Render Markdown"}
                                    placement="top"
                                  >
                                    <IconButton
                                      icon={props.markdownRender ? "code" : "eye"}
                                      size="small"
                                      variant="ghost"
                                      label={props.markdownRender ? "Show raw Markdown" : "Render Markdown"}
                                      onClick={(e: MouseEvent) => {
                                        e.stopPropagation()
                                        props.onMarkdownRenderChange?.(!props.markdownRender)
                                      }}
                                    />
                                  </Tooltip>
                                </Show>
                                <Show when={isDiffExpandable(diff)}>
                                  <span data-slot="session-review-diff-chevron">
                                    <Icon name="chevron-down" size="small" />
                                  </span>
                                </Show>
                              </div>
                            </div>
                          </Accordion.Trigger>
                        </StickyAccordionHeader>
                        <Accordion.Content>
                          <Show when={open().includes(diff.file)}>
                            <Show
                              when={diff.summarized !== true}
                              fallback={
                                <div class="am-diff-summary-state">
                                  <Show when={isLoadingDetail()} fallback={<span>Diff preview loads on demand.</span>}>
                                    <>
                                      <Spinner />
                                      <span>Loading diff...</span>
                                    </>
                                  </Show>
                                </div>
                              }
                            >
                              <Show
                                when={props.markdownRender && isMarkdownFile(diff.file)}
                                fallback={
                                  <Diff<AnnotationMeta>
                                    before={{ name: diff.file, contents: diff.before }}
                                    after={{ name: diff.file, contents: diff.after }}
                                    patch={diff.patch}
                                    diffStyle={props.diffStyle}
                                    virtualized={shouldVirtualizeDiff(diff)}
                                    annotations={annotationsForFile(diff.file)}
                                    renderAnnotation={buildAnnotation}
                                    enableGutterUtility={props.canComment !== false}
                                    onGutterUtilityClick={(result) => handleGutterClick(diff.file, result)}
                                    onLineNumberClick={(event) => {
                                      if (event.annotationSide === "deletions") return
                                      props.onOpenFile?.(diff.file, event.lineNumber)
                                    }}
                                  />
                                }
                              >
                                <MarkdownDiffView
                                  diff={diff}
                                  annotations={annotationsForFile(diff.file)}
                                  renderAnnotation={buildAnnotation}
                                  enableGutterUtility={props.canComment !== false}
                                  onGutterUtilityClick={(result) => handleGutterClick(diff.file, result)}
                                  onLineNumberClick={(event) => {
                                    if (event.annotationSide === "deletions") return
                                    props.onOpenFile?.(diff.file, event.lineNumber)
                                  }}
                                />
                              </Show>
                            </Show>
                          </Show>
                        </Accordion.Content>
                      </Accordion.Item>
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
