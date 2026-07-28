import { type Component, createSignal, createMemo, Show, createEffect, on } from "solid-js"
import type { VirtualizerHandle } from "virtua/solid"
import { Diff } from "@kilocode/kilo-ui/diff"
import { Accordion } from "@kilocode/kilo-ui/accordion"
import { StickyAccordionHeader } from "@kilocode/kilo-ui/sticky-accordion-header"
import { FileIcon } from "@kilocode/kilo-ui/file-icon"
import { DiffChanges } from "@kilocode/kilo-ui/diff-changes"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Button } from "@kilocode/kilo-ui/button"
import { RadioGroup } from "@kilocode/kilo-ui/radio-group"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Spinner } from "@kilocode/kilo-ui/spinner"
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
import {
  getDirectory,
  getFilename,
  lineCount,
  sanitizeReviewComments,
  type ReviewComment,
} from "../diff-viewer/review-comments"
import {
  buildFileAnnotations,
  buildReviewAnnotation,
  clearReviewComposer,
  createReviewComposer,
  reviewComposerDraft,
  reviewComposerEdit,
  reviewDraftSpeechKey,
  reviewEditSpeechKey,
  sendReviewComments,
  type AnnotationLabels,
  type AnnotationMeta,
  type ReviewComposer,
  type ReviewDraft,
} from "../diff-viewer/review-annotations"
import { createReviewAnnotationSpeechRenderer } from "../diff-viewer/review-annotation-speech"
import {
  LONG_DIFF_MARKER_FILE_COUNT,
  allOpenFiles,
  initialOpenFiles,
  isDiffExpandable,
  isLargeDiffFile,
  sanitizeOpenFiles,
  shouldVirtualizeDiff,
  toggleOpenFiles,
} from "../diff-viewer/diff-open-policy"
import { DiffEndMarker } from "../diff-viewer/DiffEndMarker"
import { VirtualDiffList } from "../diff-viewer/VirtualDiffList"
import { treeOrder } from "../diff-viewer/file-tree-utils"
import { isMarkdownFile, MarkdownDiffView } from "../diff-viewer/MarkdownDiffView"
import { ImageDiffView } from "../diff-viewer/ImageDiffView"
import { createDiffRows } from "../diff-viewer/diff-state"
import { createDiffRequests } from "../diff-viewer/diff-requests"

// --- Data model ---

interface DiffPanelProps {
  diffs: WorktreeFileDiff[]
  loading: boolean
  loadingFiles?: Set<string>
  sessionId?: string
  sessionKey?: string
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
  onRevertFile?: (file: string) => void
  revertingFiles?: Set<string>
  activeTerminalId?: string
}

export const DiffPanel: Component<DiffPanelProps> = (props) => {
  const { t } = useLanguage()
  const vscode = useVSCode()
  const server = useServer()
  const provider = useProvider()
  const { config } = useConfig()
  const speech = useSpeechToText(vscode, server, { t })
  const canUseSpeech = () => canUseSpeechToText(config(), provider.authStates())
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
    send: t("prompt.action.send"),
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
  let nextId = 0
  // Initialize each worktree with every file expanded, then preserve manual
  // collapse state while adding and removing files from live summaries.
  let initializedKey: string | undefined
  let known = new Set<string>()

  // Reorder diffs to match the file-tree's depth-first visual order so
  // scrolling through the accordion matches the tree grouping.
  const sorted = createMemo(() => treeOrder(props.diffs))
  const rows = createDiffRows(sorted, () => props.sessionKey)

  const comments = () => props.comments
  const setComments = (next: ReviewComment[]) => props.onCommentsChange(next)
  const updateComments = (updater: (prev: ReviewComment[]) => ReviewComment[]) => setComments(updater(comments()))

  // Stable composer metadata refs avoid recreating the object on every signal read
  // so pierre's annotation cache doesn't invalidate and destroy the textarea.
  let draftMeta: AnnotationMeta | null = composer().draft
  let editMeta: AnnotationMeta | null = composer().edit

  // Ref to the scrollable container — used to preserve scroll position when
  // annotation changes cause pierre to fully re-render diffs
  let rootRef: HTMLDivElement | undefined
  const [scroller, setScroller] = createSignal<HTMLDivElement>()
  const [virtualizer, setVirtualizer] = createSignal<VirtualizerHandle>()

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

  // Preserve the visible file and its intra-row offset while Pierre rebuilds a
  // row. Raw scrollTop is not stable once the virtualizer remeasures dynamic rows.
  const preserveScroll = (fn: () => void) => {
    const handle = virtualizer()
    const index = handle?.findItemIndex(handle.scrollOffset)
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
        // No diffs yet (async fetch in progress) — don't mark as initialized
        // so auto-open runs when data arrives.
        // Important: do not prune on empty, otherwise transient empty updates
        // collapse all files and they stay collapsed for the same key.
        if (diffs.length === 0) return

        const fileSet = new Set(diffs.map((diff) => diff.file))

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
        setDraft(null)
        draftMeta = null
        setEditing(null)
        editMeta = null
        clearReviewComposer(composer())
      },
      { defer: true },
    ),
  )

  const request = createDiffRequests({
    key: () => props.sessionKey,
    diffs: () => props.diffs,
    open,
    loading: () => props.loadingFiles,
    send: () => props.onRequestDiff,
  })

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

  const sendComment = (file: string, side: AnnotationSide, line: number, text: string, selectedText: string) => {
    const comment = { id: `c-${++nextId}-${Date.now()}`, file, side, line, comment: text, selectedText }
    sendReviewComments([comment], props.activeTerminalId)
    preserveScroll(() => {
      setDraft(null)
      draftMeta = null
      composer().draft = null
    })
    props.onSendClick?.()
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
      sendComment,
      updateComment,
      deleteComment,
      cancelDraft,
      labels: labels(),
      activeTerminalId: props.activeTerminalId,
      speech: reviewSpeech,
    })
  }

  const handleRootMouseDown = (e: MouseEvent) => {
    if (keepNativeFocus(e.target)) return
    focusRoot()
  }

  // --- Gutter utility click ---
  const handleGutterClick = (file: string, range: SelectedLineRange) => {
    // Don't open a second draft while one is active
    if (draft()) return
    const side: AnnotationSide = range.side === "deletions" ? "deletions" : "additions"
    preserveScroll(() => {
      const next = { file, side, line: range.start, endLine: range.end }
      draftMeta = { type: "draft", comment: null, ...next }
      composer().draft = draftMeta
      setDraft(next)
    })
  }

  // --- Send all ---
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

  const sendAllClick = () => {
    props.onSendClick?.()
    sendAllToChat()
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Enter") return
    if (!(e.metaKey || e.ctrlKey)) return
    const target = e.target
    if (keepNativeFocus(target)) return
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
          <span class="am-diff-header-title">{t("session.review.change.other")}</span>
          <Show when={props.diffs.length > 0}>
            <>
              <RadioGroup
                options={["unified", "split"] as const}
                current={props.diffStyle ?? "unified"}
                size="small"
                value={(style) => style}
                label={(style) =>
                  style === "unified" ? t("ui.sessionReview.diffStyle.unified") : t("ui.sessionReview.diffStyle.split")
                }
                onSelect={(style) => {
                  if (!style) return
                  props.onDiffStyleChange?.(style)
                }}
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
        <div class="am-diff-content" data-component="session-review" ref={setScroller}>
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

                createEffect(() => {
                  if (diff.kind === "image" && open().includes(diff.file)) request(diff)
                })

                return (
                  <Accordion.Item
                    value={diff.file}
                    data-slot="session-review-accordion-item"
                    data-file-path={diff.file}
                  >
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
                            <Show when={diff.kind === "image"}>
                              <span class="am-diff-summary-pill">{t("agentManager.review.image")}</span>
                            </Show>
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
                            <Show when={props.onRevertFile}>
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
                            when={diff.kind === "image"}
                            fallback={
                              <Show
                                when={props.markdownRender && isMarkdownFile(diff.file)}
                                fallback={
                                  <Diff<AnnotationMeta>
                                    before={{ name: diff.file, contents: diff.before }}
                                    after={{ name: diff.file, contents: diff.after }}
                                    patch={diff.patch}
                                    diffStyle={props.diffStyle ?? "unified"}
                                    virtualized={shouldVirtualizeDiff(diff)}
                                    annotations={annotationsForFile(diff.file)}
                                    renderAnnotation={buildAnnotation}
                                    enableGutterUtility={true}
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
                                  enableGutterUtility={true}
                                  onGutterUtilityClick={(result) => handleGutterClick(diff.file, result)}
                                  onLineNumberClick={(event) => {
                                    if (event.annotationSide === "deletions") return
                                    props.onOpenFile?.(diff.file, event.lineNumber)
                                  }}
                                />
                              </Show>
                            }
                          >
                            <ImageDiffView diff={diff} />
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
