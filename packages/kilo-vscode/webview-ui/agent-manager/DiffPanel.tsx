import { type Component, createSignal, createMemo, For, Show, createEffect, on } from "solid-js"
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
import { useLanguage } from "../src/context/language"
import { getDirectory, getFilename, lineCount, sanitizeReviewComments, type ReviewComment } from "./review-comments"
import {
  buildFileAnnotations,
  buildReviewAnnotation,
  type AnnotationLabels,
  type AnnotationMeta,
} from "./review-annotations"
import { LONG_DIFF_MARKER_FILE_COUNT, initialOpenFiles, isLargeDiffFile } from "./diff-open-policy"
import { DiffEndMarker } from "./DiffEndMarker"
import { treeOrder } from "./file-tree-utils"

// --- Data model ---

interface DiffPanelProps {
  diffs: WorktreeFileDiff[]
  loading: boolean
  loadingFiles?: Set<string>
  sessionId?: string
  sessionKey?: string
  diffStyle?: "unified" | "split"
  onDiffStyleChange?: (style: "unified" | "split") => void
  comments: ReviewComment[]
  onCommentsChange: (comments: ReviewComment[]) => void
  onSendAll?: () => void
  onClose: () => void
  onExpand?: () => void
  onRequestDiff?: (file: string) => void
  onOpenFile?: (relativePath: string) => void
  onRevertFile?: (file: string) => void
  revertingFiles?: Set<string>
}

export const DiffPanel: Component<DiffPanelProps> = (props) => {
  const { t } = useLanguage()
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
  const [open, setOpen] = createSignal<string[]>([])
  const [draft, setDraft] = createSignal<{ file: string; side: AnnotationSide; line: number } | null>(null)
  const [editing, setEditing] = createSignal<string | null>(null)
  let nextId = 0
  // Tracks the session key for which auto-open has already run. When the
  // key changes (different worktree) we re-expand. Within the same key,
  // only pruning happens so the user's manual collapse state is preserved.
  let initializedKey: string | undefined

  // Reorder diffs to match the file-tree's depth-first visual order so
  // scrolling through the accordion matches the tree grouping.
  const sorted = createMemo(() => treeOrder(props.diffs))

  const comments = () => props.comments
  const setComments = (next: ReviewComment[]) => props.onCommentsChange(next)
  const updateComments = (updater: (prev: ReviewComment[]) => ReviewComment[]) => setComments(updater(comments()))

  // Stable draft metadata ref — avoids recreating the object on every signal read
  // so pierre's annotation cache doesn't invalidate and destroy the textarea
  let draftMeta: AnnotationMeta | null = null

  // Ref to the scrollable container — used to preserve scroll position when
  // annotation changes cause pierre to fully re-render diffs
  let rootRef: HTMLDivElement | undefined
  let scroller: HTMLDivElement | undefined

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

  // Run a callback while preserving the scroll position of the diff container.
  // Pierre destroys and rebuilds the DOM on annotation changes (via innerHTML = ""),
  // which resets scrollTop. We capture it before the update and restore it across
  // two animation frames to account for the async shadow-DOM render of <diffs-container>.
  const preserveScroll = (fn: () => void) => {
    const el = scroller
    if (!el) return fn()
    const top = el.scrollTop
    fn()
    requestAnimationFrame(() => {
      el.scrollTop = top
      requestAnimationFrame(() => {
        el.scrollTop = top
      })
    })
  }

  const cancelDraft = () => {
    preserveScroll(() => {
      setDraft(null)
      draftMeta = null
    })
    focusRoot()
  }

  // Unified auto-open effect: tracks both sessionKey and diffs in a single effect
  // to eliminate the race condition between the old separate sessionKey-reset and
  // diffs-watch effects. Uses the session key to decide when auto-expand is needed
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
          setOpen(initialOpenFiles(diffs))
          return
        }

        // Already initialized for this key — preserve manual expand/collapse,
        // only prune files that no longer exist (e.g. deleted during session)
        setOpen((prev) => {
          const filtered = prev.filter((file) => fileSet.has(file))
          if (filtered.length === prev.length && prev.every((f) => fileSet.has(f))) return prev
          return filtered
        })
      },
    ),
  )

  createEffect(
    on(
      () => [open(), props.diffs] as const,
      ([next]) => {
        const loading = props.loadingFiles ?? new Set<string>()
        for (const file of next) {
          if (loading.has(file)) continue
          const diff = props.diffs.find((item) => item.file === file)
          if (!diff || diff.summarized !== true) continue
          props.onRequestDiff?.(file)
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
    })
    focusRoot()
  }

  const updateComment = (id: string, text: string) => {
    preserveScroll(() => {
      updateComments((prev) => prev.map((c) => (c.id === id ? { ...c, comment: text } : c)))
      setEditing(null)
    })
    focusRoot()
  }

  const deleteComment = (id: string) => {
    preserveScroll(() => {
      updateComments((prev) => prev.filter((c) => c.id !== id))
      if (editing() === id) setEditing(null)
    })
    focusRoot()
  }

  const setEditState = (id: string | null) => {
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
        }

        const currentDraft = draft()
        if (!currentDraft) return
        const diff = diffs.find((item) => item.file === currentDraft.file)
        if (!diff) {
          setDraft(null)
          draftMeta = null
          return
        }
        const content = currentDraft.side === "deletions" ? diff.before : diff.after
        const max = lineCount(content)
        if (currentDraft.line < 1 || currentDraft.line > max) {
          setDraft(null)
          draftMeta = null
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

  const annotationsForFile = (file: string): DiffLineAnnotation<AnnotationMeta>[] => {
    const result = buildFileAnnotations(file, commentsByFile().get(file) ?? [], editing(), draft(), draftMeta)
    draftMeta = result.draftMeta
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
      setDraft({ file, side, line: range.start })
    })
  }

  // --- Send all ---
  const sendAllToChat = () => {
    const all = comments()
    if (all.length === 0) return
    window.dispatchEvent(
      new MessageEvent("message", { data: { type: "appendReviewComments", comments: all, autoSend: true } }),
    )
    preserveScroll(() => setComments([]))
    props.onSendAll?.()
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
    const allOpen = open().length === props.diffs.length
    setOpen(allOpen ? [] : props.diffs.map((d) => d.file))
  }

  const totals = createMemo(() => ({
    files: props.diffs.length,
    additions: props.diffs.reduce((sum, diff) => sum + diff.additions, 0),
    deletions: props.diffs.reduce((sum, diff) => sum + diff.deletions, 0),
    large: props.diffs.filter((diff) => isLargeDiffFile(diff)).length,
    collapsed: Math.max(props.diffs.length - open().length, 0),
  }))

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
            <Tooltip
              value={
                open().length === props.diffs.length
                  ? t("ui.sessionReview.collapseAll")
                  : t("ui.sessionReview.expandAll")
              }
              placement="bottom"
            >
              <IconButton
                icon="chevron-grabber-vertical"
                size="small"
                variant="ghost"
                label={
                  open().length === props.diffs.length
                    ? t("ui.sessionReview.collapseAll")
                    : t("ui.sessionReview.expandAll")
                }
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
        <div class="am-diff-content" data-component="session-review" ref={scroller}>
          <Accordion multiple value={open()} onChange={setOpen}>
            <For each={sorted()}>
              {(diff) => {
                const isAdded = () => diff.status === "added"
                const isDeleted = () => diff.status === "deleted"
                const isLargeCollapsed = () => isLargeDiffFile(diff) && !open().includes(diff.file)
                const isLoadingDetail = () => props.loadingFiles?.has(diff.file) ?? false
                const fileCommentCount = () => (commentsByFile().get(diff.file) ?? []).length

                return (
                  <Accordion.Item value={diff.file} data-slot="session-review-accordion-item">
                    <StickyAccordionHeader>
                      <Accordion.Trigger>
                        <div data-slot="session-review-trigger-content">
                          <div data-slot="session-review-file-info">
                            <FileIcon node={{ path: diff.file, type: "file" }} />
                            <div data-slot="session-review-file-name-container">
                              <Show when={diff.file.includes("/")}>
                                <span data-slot="session-review-directory">{getDirectory(diff.file)}</span>
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
                            <span data-slot="session-review-diff-chevron">
                              <Icon name="chevron-down" size="small" />
                            </span>
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
                          <Diff<AnnotationMeta>
                            before={{ name: diff.file, contents: diff.before }}
                            after={{ name: diff.file, contents: diff.after }}
                            diffStyle={props.diffStyle ?? "unified"}
                            annotations={annotationsForFile(diff.file)}
                            renderAnnotation={buildAnnotation}
                            enableGutterUtility={true}
                            onGutterUtilityClick={(result) => handleGutterClick(diff.file, result)}
                          />
                        </Show>
                      </Show>
                    </Accordion.Content>
                  </Accordion.Item>
                )
              }}
            </For>
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
              <Button variant="primary" size="small" onClick={sendAllToChat}>
                {t("agentManager.review.sendAllToChat")}
              </Button>
            </TooltipKeybind>
          </div>
        </Show>
      </Show>
    </div>
  )
}
