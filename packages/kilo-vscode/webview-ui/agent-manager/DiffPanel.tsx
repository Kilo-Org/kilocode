import { type Component, createSignal, createMemo, For, Show, createEffect, on } from "solid-js"
import { Diff } from "@kilocode/kilo-ui/diff"
import { Accordion } from "@kilocode/kilo-ui/accordion"
import { StickyAccordionHeader } from "@kilocode/kilo-ui/sticky-accordion-header"
import { FileIcon } from "@kilocode/kilo-ui/file-icon"
import { DiffChanges } from "@kilocode/kilo-ui/diff-changes"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import type { DiffLineAnnotation, AnnotationSide, SelectedLineRange } from "@pierre/diffs"
import type { WorktreeFileDiff } from "../src/types/messages"
import { useLanguage } from "../src/context/language"

// --- Data model ---

interface ReviewComment {
  id: string
  file: string
  side: AnnotationSide
  line: number
  comment: string
  selectedText: string
}

// Annotation metadata — kept as stable references for pierre's cache
interface AnnotationMeta {
  type: "comment" | "draft"
  comment: ReviewComment | null
  file: string
  side: AnnotationSide
  line: number
}

interface DiffPanelProps {
  diffs: WorktreeFileDiff[]
  loading: boolean
  onClose: () => void
  onOpenFile?: (relativePath: string) => void
}

function getDirectory(path: string): string {
  const idx = path.lastIndexOf("/")
  return idx === -1 ? "" : path.slice(0, idx + 1)
}

function getFilename(path: string): string {
  const idx = path.lastIndexOf("/")
  return idx === -1 ? path : path.slice(idx + 1)
}

function extractLines(content: string, start: number, end: number): string {
  return content
    .split("\n")
    .slice(start - 1, end)
    .join("\n")
}

export const DiffPanel: Component<DiffPanelProps> = (props) => {
  const { t } = useLanguage()
  const [comments, setComments] = createSignal<ReviewComment[]>([])
  const [open, setOpen] = createSignal<string[]>([])
  const [draft, setDraft] = createSignal<{ file: string; side: AnnotationSide; line: number } | null>(null)
  const [editing, setEditing] = createSignal<string | null>(null)
  let nextId = 0

  // Stable draft metadata ref — avoids recreating the object on every signal read
  // so pierre's annotation cache doesn't invalidate and destroy the textarea
  let draftMeta: AnnotationMeta | null = null

  // Ref to the scrollable container — used to preserve scroll position when
  // annotation changes cause pierre to fully re-render diffs
  let scroller: HTMLDivElement | undefined

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
  }

  // Auto-open files when diffs arrive
  createEffect(
    on(
      () => props.diffs,
      (diffs) => {
        if (diffs.length <= 15) setOpen(diffs.map((d) => d.file))
      },
    ),
  )

  // --- CRUD ---

  const addComment = (file: string, side: AnnotationSide, line: number, text: string, selectedText: string) => {
    preserveScroll(() => {
      const id = `c-${++nextId}-${Date.now()}`
      setComments((prev) => [...prev, { id, file, side, line, comment: text, selectedText }])
      setDraft(null)
      draftMeta = null
    })
  }

  const updateComment = (id: string, text: string) => {
    preserveScroll(() => {
      setComments((prev) => prev.map((c) => (c.id === id ? { ...c, comment: text } : c)))
      setEditing(null)
    })
  }

  const deleteComment = (id: string) => {
    preserveScroll(() => {
      setComments((prev) => prev.filter((c) => c.id !== id))
      if (editing() === id) setEditing(null)
    })
  }

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

  // Compute commentedLines ranges for visual highlights on lines with comments
  const commentedLinesForFile = (file: string): SelectedLineRange[] => {
    const fileComments = commentsByFile().get(file) ?? []
    return fileComments.map((c) => ({
      start: c.line,
      end: c.line,
      side: c.side,
    }))
  }

  // Focus a textarea once it's connected to the DOM (pierre renders async via slots)
  const focusWhenConnected = (el: HTMLTextAreaElement) => {
    let attempts = 0
    const tick = () => {
      if (el.isConnected) {
        el.focus()
        return
      }
      if (++attempts < 20) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }

  // --- renderAnnotation (vanilla DOM — called by pierre) ---

  const buildAnnotation = (annotation: DiffLineAnnotation<AnnotationMeta>): HTMLElement | undefined => {
    const meta = annotation.metadata
    if (!meta) return undefined

    const wrapper = document.createElement("div")

    if (meta.type === "draft") {
      wrapper.className = "am-annotation am-annotation-draft"
      const header = document.createElement("div")
      header.className = "am-annotation-header"
      header.textContent = `Comment on line ${meta.line}`
      const textarea = document.createElement("textarea")
      textarea.className = "am-annotation-textarea"
      textarea.rows = 3
      textarea.placeholder = "Leave a comment..."
      const actions = document.createElement("div")
      actions.className = "am-annotation-actions"
      const cancelBtn = document.createElement("button")
      cancelBtn.className = "am-annotation-btn"
      cancelBtn.textContent = "Cancel"
      const submitBtn = document.createElement("button")
      submitBtn.className = "am-annotation-btn am-annotation-btn-submit"
      submitBtn.textContent = "Comment"
      actions.appendChild(cancelBtn)
      actions.appendChild(submitBtn)
      wrapper.appendChild(header)
      wrapper.appendChild(textarea)
      wrapper.appendChild(actions)

      focusWhenConnected(textarea)

      const submit = () => {
        const text = textarea.value.trim()
        if (!text) return
        // Extract selected text from the diff content
        const diff = props.diffs.find((d) => d.file === meta.file)
        const content = meta.side === "deletions" ? (diff?.before ?? "") : (diff?.after ?? "")
        const selected = extractLines(content, meta.line, meta.line)
        addComment(meta.file, meta.side, meta.line, text, selected)
      }
      cancelBtn.addEventListener("click", (e) => {
        e.stopPropagation()
        cancelDraft()
      })
      submitBtn.addEventListener("click", (e) => {
        e.stopPropagation()
        submit()
      })
      textarea.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.preventDefault()
          cancelDraft()
        }
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault()
          submit()
        }
      })
      return wrapper
    }

    // Existing comment — check if in edit mode
    const c = meta.comment!
    const isEditing = editing() === c.id

    if (isEditing) {
      wrapper.className = "am-annotation am-annotation-draft"
      const header = document.createElement("div")
      header.className = "am-annotation-header"
      header.textContent = `Edit comment on line ${c.line}`
      const textarea = document.createElement("textarea")
      textarea.className = "am-annotation-textarea"
      textarea.rows = 3
      textarea.value = c.comment
      const actions = document.createElement("div")
      actions.className = "am-annotation-actions"
      const cancelBtn = document.createElement("button")
      cancelBtn.className = "am-annotation-btn"
      cancelBtn.textContent = "Cancel"
      const saveBtn = document.createElement("button")
      saveBtn.className = "am-annotation-btn am-annotation-btn-submit"
      saveBtn.textContent = "Save"
      actions.appendChild(cancelBtn)
      actions.appendChild(saveBtn)
      wrapper.appendChild(header)
      wrapper.appendChild(textarea)
      wrapper.appendChild(actions)

      focusWhenConnected(textarea)

      cancelBtn.addEventListener("click", (e) => {
        e.stopPropagation()
        setEditing(null)
      })
      saveBtn.addEventListener("click", (e) => {
        e.stopPropagation()
        const text = textarea.value.trim()
        if (text) updateComment(c.id, text)
      })
      textarea.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.preventDefault()
          setEditing(null)
        }
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault()
          const text = textarea.value.trim()
          if (text) updateComment(c.id, text)
        }
      })
      return wrapper
    }

    // Read-only comment — no code quote or line label since the annotation
    // is visually anchored right below the relevant line
    wrapper.className = "am-annotation"
    const body = document.createElement("div")
    body.className = "am-annotation-comment"

    const text = document.createElement("div")
    text.className = "am-annotation-comment-text"
    text.textContent = c.comment
    body.appendChild(text)

    const btns = document.createElement("div")
    btns.className = "am-annotation-comment-actions"

    const makeBtn = (title: string, svg: string, action: () => void) => {
      const btn = document.createElement("button")
      btn.className = "am-annotation-icon-btn"
      btn.title = title
      btn.innerHTML = svg
      btn.addEventListener("click", (e) => {
        e.stopPropagation()
        action()
      })
      return btn
    }

    btns.appendChild(
      makeBtn(
        "Send to chat",
        '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M1 1l14 7-14 7V9l10-1L1 7z"/></svg>',
        () => {
          const quote = c.selectedText ? `\n> \`\`\`\n> ${c.selectedText.split("\n").join("\n> ")}\n> \`\`\`\n` : ""
          const msg = `**${c.file}** (line ${c.line}):${quote}\n${c.comment}`
          window.dispatchEvent(new MessageEvent("message", { data: { type: "appendChatBoxMessage", text: msg } }))
          deleteComment(c.id)
        },
      ),
    )
    btns.appendChild(
      makeBtn(
        "Edit",
        '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M13.2 1.1l1.7 1.7-1.1 1.1-1.7-1.7zM1 11.5V13.2h1.7l7.8-7.8-1.7-1.7z"/></svg>',
        () => setEditing(c.id),
      ),
    )
    btns.appendChild(
      makeBtn(
        "Delete",
        '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm3.1 9.3l-.8.8L8 8.8l-2.3 2.3-.8-.8L7.2 8 4.9 5.7l.8-.8L8 7.2l2.3-2.3.8.8L8.8 8z"/></svg>',
        () => deleteComment(c.id),
      ),
    )

    wrapper.appendChild(body)
    wrapper.appendChild(btns)
    return wrapper
  }

  // --- Gutter utility click ---
  const handleGutterClick = (file: string, result: { lineNumber: number; side: AnnotationSide }) => {
    // Don't open a second draft while one is active
    if (draft()) return
    setDraft({ file, side: result.side, line: result.lineNumber })
  }

  // --- Send all ---
  const sendAllToChat = () => {
    const all = comments()
    if (all.length === 0) return
    const lines = ["## Review Comments", ""]
    for (const c of all) {
      lines.push(`**${c.file}** (line ${c.line}):`)
      if (c.selectedText) {
        lines.push("```")
        lines.push(c.selectedText)
        lines.push("```")
      }
      lines.push(c.comment)
      lines.push("")
    }
    const text = lines.join("\n")
    window.dispatchEvent(new MessageEvent("message", { data: { type: "appendChatBoxMessage", text } }))
    preserveScroll(() => setComments([]))
  }

  return (
    <div class="am-diff-panel">
      <div class="am-diff-header">
        <span class="am-diff-header-title">Changes</span>
        <IconButton icon="close" size="small" variant="ghost" label="Close" onClick={props.onClose} />
      </div>

      <Show when={props.loading && props.diffs.length === 0}>
        <div class="am-diff-loading">
          <Spinner />
          <span>Computing diff...</span>
        </div>
      </Show>

      <Show when={!props.loading && props.diffs.length === 0}>
        <div class="am-diff-empty">
          <span>No changes detected</span>
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
                                Added
                              </span>
                            </Show>
                            <Show when={isDeleted()}>
                              <span data-slot="session-review-change" data-type="removed">
                                Removed
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
                          annotations={annotationsForFile(diff.file)}
                          commentedLines={commentedLinesForFile(diff.file)}
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
            <Button variant="primary" size="small" onClick={sendAllToChat}>
              Send all to chat
            </Button>
          </div>
        </Show>
      </Show>
    </div>
  )
}
