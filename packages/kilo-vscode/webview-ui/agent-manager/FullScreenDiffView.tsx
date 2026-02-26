import { type Component, createSignal, createMemo, createEffect, on, onCleanup, For, Show } from "solid-js"
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
import type { DiffLineAnnotation, AnnotationSide } from "@pierre/diffs"
import type { WorktreeFileDiff } from "../src/types/messages"
import { FileTree } from "./FileTree"
import { sanitizeReviewComments, type ReviewComment } from "./review-comments"

// --- Shared data model (same as DiffPanel) ---

interface AnnotationMeta {
  type: "comment" | "draft"
  comment: ReviewComment | null
  file: string
  side: AnnotationSide
  line: number
}

type DiffStyle = "unified" | "split"

interface FullScreenDiffViewProps {
  diffs: WorktreeFileDiff[]
  loading: boolean
  comments: ReviewComment[]
  onCommentsChange: (comments: ReviewComment[]) => void
  onSendAll?: () => void
  diffStyle: DiffStyle
  onDiffStyleChange: (style: DiffStyle) => void
  onClose: () => void
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

export const FullScreenDiffView: Component<FullScreenDiffViewProps> = (props) => {
  const [open, setOpen] = createSignal<string[]>([])
  const [openInit, setOpenInit] = createSignal(false)
  const [draft, setDraft] = createSignal<{ file: string; side: AnnotationSide; line: number } | null>(null)
  const [editing, setEditing] = createSignal<string | null>(null)
  const [activeFile, setActiveFile] = createSignal<string | null>(null)
  const [treeWidth, setTreeWidth] = createSignal(240)
  let nextId = 0
  let draftMeta: AnnotationMeta | null = null
  let scrollRef: HTMLDivElement | undefined
  let syncFrame: number | undefined

  const comments = () => props.comments
  const setComments = (next: ReviewComment[]) => props.onCommentsChange(next)
  const updateComments = (updater: (prev: ReviewComment[]) => ReviewComment[]) => setComments(updater(comments()))

  const preserveScroll = (fn: () => void) => {
    const el = scrollRef
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
        const files = diffs.map((d) => d.file)
        setOpen((prev) => prev.filter((file) => files.includes(file)))
        if (diffs.length === 0) {
          setActiveFile(null)
          return
        }
        if (!openInit()) {
          if (diffs.length <= 15) setOpen(files)
          setOpenInit(true)
        }
        const current = activeFile()
        if (!current || !diffs.some((d) => d.file === current)) {
          setActiveFile(diffs[0]!.file)
        }
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
  }

  const updateComment = (id: string, text: string) => {
    preserveScroll(() => {
      updateComments((prev) => prev.map((c) => (c.id === id ? { ...c, comment: text } : c)))
      setEditing(null)
    })
  }

  const deleteComment = (id: string) => {
    preserveScroll(() => {
      updateComments((prev) => prev.filter((c) => c.id !== id))
      if (editing() === id) setEditing(null)
    })
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
      if (!draftMeta || draftMeta.file !== d.file || draftMeta.side !== d.side || draftMeta.line !== d.line) {
        draftMeta = { type: "draft", comment: null, file: d.file, side: d.side, line: d.line }
      }
      result.push({ side: d.side, lineNumber: d.line, metadata: draftMeta })
    }
    return result
  }

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
        preserveScroll(() => setEditing(null))
      })
      saveBtn.addEventListener("click", (e) => {
        e.stopPropagation()
        const text = textarea.value.trim()
        if (text) updateComment(c.id, text)
      })
      textarea.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.preventDefault()
          preserveScroll(() => setEditing(null))
        }
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault()
          const text = textarea.value.trim()
          if (text) updateComment(c.id, text)
        }
      })
      return wrapper
    }

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

  const handleGutterClick = (file: string, result: { lineNumber: number; side: AnnotationSide }) => {
    if (draft()) return
    setDraft({ file, side: result.side, line: result.lineNumber })
  }

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
    props.onSendAll?.()
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Enter") return
    if (!(e.metaKey || e.ctrlKey)) return
    const target = e.target
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) return
    if (target instanceof HTMLElement && target.isContentEditable) return
    if (comments().length === 0) return
    e.preventDefault()
    e.stopPropagation()
    sendAllToChat()
  }

  const handleFileSelect = (path: string) => {
    setActiveFile(path)
    // Ensure the accordion is open for this file
    if (!open().includes(path)) {
      setOpen((prev) => [...prev, path])
    }
    // Scroll to the file in the diff viewer
    requestAnimationFrame(() => {
      const el = scrollRef?.querySelector(`[data-slot="accordion-item"][data-file-path="${CSS.escape(path)}"]`)
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ block: "start", behavior: "smooth" })
      }
    })
  }

  const handleExpandAll = () => {
    const allOpen = open().length === props.diffs.length
    setOpen(allOpen ? [] : props.diffs.map((d) => d.file))
  }

  const syncActiveFileFromScroll = () => {
    const container = scrollRef
    if (!container) return
    const headers = Array.from(container.querySelectorAll<HTMLElement>('[data-slot="accordion-item"][data-file-path]'))
    if (headers.length === 0) return

    const top = container.getBoundingClientRect().top + 1
    const first = headers[0]?.dataset.filePath
    const selected = headers.reduce<string | undefined>((carry, header) => {
      const path = header.dataset.filePath
      if (!path) return carry
      if (header.getBoundingClientRect().top <= top) return path
      return carry
    }, first)

    if (selected) setActiveFile(selected)
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
    const container = scrollRef
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
  }))

  return (
    <div class="am-review-layout" onKeyDown={handleKeyDown}>
      {/* Toolbar */}
      <div class="am-review-toolbar">
        <div class="am-review-toolbar-left">
          <RadioGroup
            options={["unified", "split"] as const}
            current={props.diffStyle}
            size="small"
            value={(style) => style}
            label={(style) => (style === "unified" ? "Unified" : "Split")}
            onSelect={(style) => {
              if (style) props.onDiffStyleChange(style)
            }}
          />
          <span class="am-review-toolbar-stats">
            <span>
              {totals().files} file{totals().files !== 1 ? "s" : ""}
            </span>
            <span class="am-review-toolbar-adds">+{totals().additions}</span>
            <span class="am-review-toolbar-dels">-{totals().deletions}</span>
          </span>
        </div>
        <div class="am-review-toolbar-right">
          <Button size="small" variant="ghost" onClick={handleExpandAll}>
            <Icon name="chevron-grabber-vertical" size="small" />
            {open().length === props.diffs.length ? "Collapse all" : "Expand all"}
          </Button>
          <Show when={comments().length > 0}>
            <Button variant="primary" size="small" onClick={sendAllToChat}>
              Send all to chat ({comments().length})
            </Button>
          </Show>
          <IconButton icon="close" size="small" variant="ghost" label="Close review" onClick={props.onClose} />
        </div>
      </div>

      {/* Body: file tree + diff viewer */}
      <div class="am-review-body">
        <div class="am-review-tree-resize" style={{ width: `${treeWidth()}px` }}>
          <div class="am-review-tree-wrapper">
            <FileTree diffs={props.diffs} activeFile={activeFile()} onFileSelect={handleFileSelect} />
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
        <div class="am-review-diff" ref={scrollRef}>
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
            <div class="am-review-diff-content" data-component="session-review">
              <Accordion multiple value={open()} onChange={setOpen}>
                <For each={props.diffs}>
                  {(diff) => {
                    const isAdded = () => diff.status === "added"
                    const isDeleted = () => diff.status === "deleted"
                    const fileCommentCount = () => (commentsByFile().get(diff.file) ?? []).length

                    return (
                      <Accordion.Item value={diff.file} data-file-path={diff.file}>
                        <StickyAccordionHeader>
                          <Accordion.Trigger>
                            <div data-slot="session-review-trigger-content">
                              <div data-slot="session-review-file-info">
                                <FileIcon node={{ path: diff.file, type: "file" }} />
                                <div data-slot="session-review-file-name-container">
                                  <Show when={diff.file.includes("/")}>
                                    <span data-slot="session-review-directory">{`\u202A${getDirectory(diff.file)}\u202C`}</span>
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
                              diffStyle={props.diffStyle}
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
          </Show>
        </div>
      </div>
    </div>
  )
}
