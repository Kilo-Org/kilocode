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
import type { DiffLineAnnotation, AnnotationSide } from "@pierre/diffs"
import type { WorktreeFileDiff } from "../src/types/messages"
import { useLanguage } from "../src/context/language"
import {
  formatReviewCommentsMarkdown,
  getDirectory,
  getFilename,
  sanitizeReviewComments,
  type ReviewComment,
} from "./review-comments"
import { buildReviewAnnotation, type AnnotationLabels, type AnnotationMeta } from "./review-annotations"

// --- Data model ---

interface DiffPanelProps {
  diffs: WorktreeFileDiff[]
  loading: boolean
  diffStyle?: "unified" | "split"
  onDiffStyleChange?: (style: "unified" | "split") => void
  comments: ReviewComment[]
  onCommentsChange: (comments: ReviewComment[]) => void
  onSendAll?: () => void
  onClose: () => void
  onExpand?: () => void
  onOpenFile?: (relativePath: string) => void
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
  const [openInit, setOpenInit] = createSignal(false)
  const [draft, setDraft] = createSignal<{ file: string; side: AnnotationSide; line: number } | null>(null)
  const [editing, setEditing] = createSignal<string | null>(null)
  let nextId = 0

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

  // Auto-open files when diffs arrive
  createEffect(
    on(
      () => props.diffs,
      (diffs) => {
        const files = diffs.map((d) => d.file)
        setOpen((prev) => prev.filter((file) => files.includes(file)))
        if (openInit()) return
        if (diffs.length === 0) return
        if (diffs.length <= 15) setOpen(files)
        setOpenInit(true)
      },
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
        const max = content.length === 0 ? 0 : content.split("\n").length
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
    const fileComments = commentsByFile().get(file) ?? []
    const result: DiffLineAnnotation<AnnotationMeta>[] = fileComments.map((c) => ({
      side: c.side,
      lineNumber: c.line,
      metadata: { type: "comment" as const, comment: c, file: c.file, side: c.side, line: c.line },
    }))

    const d = draft()
    if (d && d.file === file) {
      // Reuse stable reference for draft to prevent pierre cache invalidation
      if (!draftMeta || draftMeta.file !== d.file || draftMeta.side !== d.side || draftMeta.line !== d.line) {
        draftMeta = { type: "draft", comment: null, file: d.file, side: d.side, line: d.line }
      }
      result.push({ side: d.side, lineNumber: d.line, metadata: draftMeta })
    }
    return result
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
  const handleGutterClick = (file: string, result: { lineNumber: number; side: AnnotationSide }) => {
    // Don't open a second draft while one is active
    if (draft()) return
    preserveScroll(() => {
      setDraft({ file, side: result.side, line: result.lineNumber })
    })
  }

  // --- Send all ---
  const sendAllToChat = () => {
    const all = comments()
    if (all.length === 0) return
    const text = formatReviewCommentsMarkdown(all)
    window.dispatchEvent(new MessageEvent("message", { data: { type: "appendChatBoxMessage", text } }))
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

  const totals = createMemo(() => ({
    files: props.diffs.length,
    additions: props.diffs.reduce((sum, diff) => sum + diff.additions, 0),
    deletions: props.diffs.reduce((sum, diff) => sum + diff.deletions, 0),
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
              </span>
            </>
          </Show>
        </div>
        <div class="am-diff-header-actions">
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
            <For each={props.diffs}>
              {(diff) => {
                const isAdded = () => diff.status === "added"
                const isDeleted = () => diff.status === "deleted"
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
                            <Show when={!isAdded() && !isDeleted()}>
                              <DiffChanges changes={diff} />
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
                            <span data-slot="session-review-diff-chevron">
                              <Icon name="chevron-down" size="small" />
                            </span>
                          </div>
                        </div>
                      </Accordion.Trigger>
                    </StickyAccordionHeader>
                    <Accordion.Content>
                      <Show when={open().includes(diff.file)}>
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
                    </Accordion.Content>
                  </Accordion.Item>
                )
              }}
            </For>
          </Accordion>
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
