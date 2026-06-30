import type { AnnotationSide, DiffLineAnnotation } from "@pierre/diffs"
import type { WorktreeFileDiff } from "../src/types/messages"
import { extractLines, type ReviewComment } from "./review-comments"

export interface AnnotationLabels {
  commentOnLine: (line: number) => string
  editCommentOnLine: (line: number) => string
  placeholder: string
  cancel: string
  comment: string
  send: string
  save: string
  sendToChat: string
  edit: string
  delete: string
}

// A draft is the active unsaved inline comment composer opened from the gutter.
// It becomes a normal comment only after the user submits the textarea.
export interface AnnotationMeta {
  type: "comment" | "draft"
  comment: ReviewComment | null
  file: string
  side: AnnotationSide
  line: number
  endLine?: number
  editing?: boolean
  text?: string
}

export type ReviewDraft = Pick<AnnotationMeta, "file" | "side" | "line" | "endLine">

export interface ReviewComposer {
  draft: AnnotationMeta | null
  edit: AnnotationMeta | null
}

export function createReviewComposer(): ReviewComposer {
  return { draft: null, edit: null }
}

export function clearReviewComposer(composer: ReviewComposer): void {
  composer.draft = null
  composer.edit = null
}

export function reviewComposerDraft(composer: ReviewComposer): ReviewDraft | null {
  const draft = composer.draft
  if (!draft || draft.type !== "draft") return null
  return { file: draft.file, side: draft.side, line: draft.line, endLine: draft.endLine }
}

export function reviewComposerEdit(composer: ReviewComposer): string | null {
  const edit = composer.edit
  if (!edit || edit.type !== "comment") return null
  return edit.comment?.id ?? null
}

type SpeechDraft = Pick<AnnotationMeta, "file" | "side" | "line" | "endLine">

export function reviewDraftSpeechKey(draft: SpeechDraft): string {
  return `draft:${draft.file}:${draft.side}:${draft.line}:${draft.endLine ?? draft.line}`
}

export function reviewEditSpeechKey(id: string): string {
  return `edit:${id}`
}

export function reviewAnnotationSpeechKey(meta: AnnotationMeta): string | undefined {
  if (meta.type === "draft") return reviewDraftSpeechKey(meta)
  if (!meta.editing || !meta.comment) return undefined
  return reviewEditSpeechKey(meta.comment.id)
}

interface AnnotationHandlers {
  diffs: WorktreeFileDiff[]
  editing: string | null
  setEditing: (id: string | null) => void
  addComment: (file: string, side: AnnotationSide, line: number, text: string, selectedText: string) => void
  sendComment: (file: string, side: AnnotationSide, line: number, text: string, selectedText: string) => void
  updateComment: (id: string, text: string) => void
  deleteComment: (id: string) => void
  cancelDraft: () => void
  labels: AnnotationLabels
  activeTerminalId?: string
  speech?: {
    active: () => boolean
    render: (meta: AnnotationMeta, textarea: HTMLTextAreaElement) => HTMLElement | undefined
  }
}

function focusWhenConnected(el: HTMLTextAreaElement): void {
  let attempts = 0
  const tick = () => {
    if (el.isConnected) {
      el.focus()
      return
    }
    attempts += 1
    if (attempts < 20) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

// Keep composer text off the disposable annotation DOM without making each keystroke reactive.
function trackText(meta: AnnotationMeta, textarea: HTMLTextAreaElement, fallback = ""): void {
  textarea.value = meta.text ?? fallback
  textarea.addEventListener("input", () => {
    meta.text = textarea.value
  })
}

function makeIcon(pathData: string): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg"
  const svg = document.createElementNS(ns, "svg")
  svg.setAttribute("width", "14")
  svg.setAttribute("height", "14")
  svg.setAttribute("viewBox", "0 0 16 16")
  svg.setAttribute("fill", "currentColor")
  const path = document.createElementNS(ns, "path")
  path.setAttribute("d", pathData)
  svg.appendChild(path)
  return svg
}

function makeActionButton(title: string, icon: SVGSVGElement, action: () => void): HTMLButtonElement {
  const button = document.createElement("button")
  button.className = "am-annotation-icon-btn"
  button.title = title
  button.appendChild(icon)
  button.addEventListener("click", (event) => {
    event.stopPropagation()
    action()
  })
  return button
}

export function sendReviewComments(comments: ReviewComment[], activeTerminalId?: string): void {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        type: activeTerminalId ? "appendReviewCommentsToTerminal" : "appendReviewComments",
        comments,
        autoSend: true,
        targetTerminalId: activeTerminalId,
      },
    }),
  )
}

export function buildFileAnnotations(
  file: string,
  fileComments: ReviewComment[],
  edit: string | null,
  draft: ReviewDraft | null,
  draftMeta: AnnotationMeta | null,
  editMeta: AnnotationMeta | null,
): {
  annotations: DiffLineAnnotation<AnnotationMeta>[]
  draftMeta: AnnotationMeta | null
  editMeta: AnnotationMeta | null
} {
  if (!edit) editMeta = null
  const result: DiffLineAnnotation<AnnotationMeta>[] = fileComments.map((c) => {
    if (c.id !== edit) {
      return {
        side: c.side,
        lineNumber: c.line,
        metadata: {
          type: "comment" as const,
          comment: c,
          file: c.file,
          side: c.side,
          line: c.line,
        },
      }
    }
    if (
      !editMeta ||
      editMeta.comment?.id !== c.id ||
      editMeta.file !== c.file ||
      editMeta.side !== c.side ||
      editMeta.line !== c.line
    ) {
      editMeta = {
        type: "comment",
        comment: c,
        file: c.file,
        side: c.side,
        line: c.line,
        editing: true,
      }
    }
    editMeta.comment = c
    return { side: c.side, lineNumber: c.line, metadata: editMeta }
  })

  if (draft && draft.file === file) {
    if (
      !draftMeta ||
      draftMeta.file !== draft.file ||
      draftMeta.side !== draft.side ||
      draftMeta.line !== draft.line ||
      draftMeta.endLine !== draft.endLine
    ) {
      draftMeta = {
        type: "draft",
        comment: null,
        file: draft.file,
        side: draft.side,
        line: draft.line,
        endLine: draft.endLine,
      }
    }
    result.push({ side: draft.side, lineNumber: draft.line, metadata: draftMeta })
  }
  return { annotations: result, draftMeta, editMeta }
}

export function buildReviewAnnotation(
  annotation: DiffLineAnnotation<AnnotationMeta>,
  handlers: AnnotationHandlers,
): HTMLElement | undefined {
  const meta = annotation.metadata
  if (!meta) return undefined

  const wrapper = document.createElement("div")

  if (meta.type === "draft") {
    wrapper.className = "am-annotation am-annotation-draft"

    const header = document.createElement("div")
    header.className = "am-annotation-header"
    header.textContent = handlers.labels.commentOnLine(meta.line)

    const textarea = document.createElement("textarea")
    textarea.className = "am-annotation-textarea"
    textarea.rows = 3
    textarea.placeholder = handlers.labels.placeholder
    trackText(meta, textarea)

    const actions = document.createElement("div")
    actions.className = "am-annotation-actions"

    const cancelButton = document.createElement("button")
    cancelButton.className = "am-annotation-btn"
    cancelButton.textContent = handlers.labels.cancel

    const submitButton = document.createElement("button")
    submitButton.className = "am-annotation-btn am-annotation-btn-submit"
    submitButton.textContent = handlers.labels.comment

    const sendButton = document.createElement("button")
    sendButton.className = "am-annotation-btn am-annotation-btn-submit"
    sendButton.textContent = handlers.labels.send
    sendButton.title = handlers.labels.sendToChat

    const update = () => {
      const disabled = textarea.value.trim().length === 0
      submitButton.disabled = disabled
      sendButton.disabled = disabled
    }

    const speech = handlers.speech?.render(meta, textarea)
    if (speech) actions.appendChild(speech)
    actions.appendChild(cancelButton)
    actions.appendChild(submitButton)
    actions.appendChild(sendButton)
    wrapper.appendChild(header)
    wrapper.appendChild(textarea)
    wrapper.appendChild(actions)

    focusWhenConnected(textarea)
    update()

    const submit = () => {
      if (handlers.speech?.active()) return
      const text = textarea.value.trim()
      if (!text) return
      const diff = handlers.diffs.find((item) => item.file === meta.file)
      const content = meta.side === "deletions" ? (diff?.before ?? "") : (diff?.after ?? "")
      const selected = extractLines(content, meta.line, meta.endLine ?? meta.line)
      handlers.addComment(meta.file, meta.side, meta.line, text, selected)
    }

    const send = () => {
      if (handlers.speech?.active()) return
      const text = textarea.value.trim()
      if (!text) return
      const diff = handlers.diffs.find((item) => item.file === meta.file)
      const content = meta.side === "deletions" ? (diff?.before ?? "") : (diff?.after ?? "")
      const selected = extractLines(content, meta.line, meta.endLine ?? meta.line)
      handlers.sendComment(meta.file, meta.side, meta.line, text, selected)
    }

    cancelButton.addEventListener("click", (event) => {
      event.stopPropagation()
      handlers.cancelDraft()
    })

    submitButton.addEventListener("click", (event) => {
      event.stopPropagation()
      submit()
    })

    sendButton.addEventListener("click", (event) => {
      event.stopPropagation()
      send()
    })

    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault()
        handlers.cancelDraft()
        return
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault()
        submit()
      }
    })
    textarea.addEventListener("input", update)

    return wrapper
  }

  const comment = meta.comment!
  if (meta.editing) {
    wrapper.className = "am-annotation am-annotation-draft"

    const header = document.createElement("div")
    header.className = "am-annotation-header"
    header.textContent = handlers.labels.editCommentOnLine(comment.line)

    const textarea = document.createElement("textarea")
    textarea.className = "am-annotation-textarea"
    textarea.rows = 3
    trackText(meta, textarea, comment.comment)

    const actions = document.createElement("div")
    actions.className = "am-annotation-actions"

    const cancelButton = document.createElement("button")
    cancelButton.className = "am-annotation-btn"
    cancelButton.textContent = handlers.labels.cancel

    const saveButton = document.createElement("button")
    saveButton.className = "am-annotation-btn am-annotation-btn-submit"
    saveButton.textContent = handlers.labels.save

    const speech = handlers.speech?.render(meta, textarea)
    if (speech) actions.appendChild(speech)
    actions.appendChild(cancelButton)
    actions.appendChild(saveButton)
    wrapper.appendChild(header)
    wrapper.appendChild(textarea)
    wrapper.appendChild(actions)

    focusWhenConnected(textarea)

    cancelButton.addEventListener("click", (event) => {
      event.stopPropagation()
      handlers.setEditing(null)
    })

    saveButton.addEventListener("click", (event) => {
      event.stopPropagation()
      if (handlers.speech?.active()) return
      const text = textarea.value.trim()
      if (!text) return
      handlers.updateComment(comment.id, text)
    })

    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault()
        handlers.setEditing(null)
        return
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault()
        if (handlers.speech?.active()) return
        const text = textarea.value.trim()
        if (!text) return
        handlers.updateComment(comment.id, text)
      }
    })

    return wrapper
  }

  wrapper.className = "am-annotation"

  const body = document.createElement("div")
  body.className = "am-annotation-comment"

  const text = document.createElement("div")
  text.className = "am-annotation-comment-text"
  text.textContent = comment.comment
  body.appendChild(text)

  const actions = document.createElement("div")
  actions.className = "am-annotation-comment-actions"

  actions.appendChild(
    makeActionButton(handlers.labels.sendToChat, makeIcon("M1 1l14 7-14 7V9l10-1L1 7z"), () => {
      sendReviewComments([comment], handlers.activeTerminalId)
      handlers.deleteComment(comment.id)
    }),
  )

  actions.appendChild(
    makeActionButton(
      handlers.labels.edit,
      makeIcon("M13.2 1.1l1.7 1.7-1.1 1.1-1.7-1.7zM1 11.5V13.2h1.7l7.8-7.8-1.7-1.7z"),
      () => handlers.setEditing(comment.id),
    ),
  )

  actions.appendChild(
    makeActionButton(
      handlers.labels.delete,
      makeIcon(
        "M8 1a7 7 0 100 14A7 7 0 008 1zm3.1 9.3l-.8.8L8 8.8l-2.3 2.3-.8-.8L7.2 8 4.9 5.7l.8-.8L8 7.2l2.3-2.3.8.8L8.8 8z",
      ),
      () => handlers.deleteComment(comment.id),
    ),
  )

  wrapper.appendChild(body)
  wrapper.appendChild(actions)
  return wrapper
}
