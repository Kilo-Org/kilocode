import type { AnnotationSide, DiffLineAnnotation } from "@pierre/diffs"
import type { WorktreeFileDiff } from "../src/types/messages"
import { extractLines, formatReviewCommentMarkdown, type ReviewComment } from "./review-comments"

export interface AnnotationLabels {
  commentOnLine: (line: number) => string
  editCommentOnLine: (line: number) => string
  placeholder: string
  cancel: string
  comment: string
  save: string
  sendToChat: string
  edit: string
  delete: string
}

export interface AnnotationMeta {
  type: "comment" | "draft"
  comment: ReviewComment | null
  file: string
  side: AnnotationSide
  line: number
}

interface AnnotationHandlers {
  diffs: WorktreeFileDiff[]
  editing: string | null
  setEditing: (id: string | null) => void
  addComment: (file: string, side: AnnotationSide, line: number, text: string, selectedText: string) => void
  updateComment: (id: string, text: string) => void
  deleteComment: (id: string) => void
  cancelDraft: () => void
  labels: AnnotationLabels
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

    const actions = document.createElement("div")
    actions.className = "am-annotation-actions"

    const cancelButton = document.createElement("button")
    cancelButton.className = "am-annotation-btn"
    cancelButton.textContent = handlers.labels.cancel

    const submitButton = document.createElement("button")
    submitButton.className = "am-annotation-btn am-annotation-btn-submit"
    submitButton.textContent = handlers.labels.comment

    actions.appendChild(cancelButton)
    actions.appendChild(submitButton)
    wrapper.appendChild(header)
    wrapper.appendChild(textarea)
    wrapper.appendChild(actions)

    focusWhenConnected(textarea)

    const submit = () => {
      const text = textarea.value.trim()
      if (!text) return
      const diff = handlers.diffs.find((item) => item.file === meta.file)
      const content = meta.side === "deletions" ? (diff?.before ?? "") : (diff?.after ?? "")
      const selected = extractLines(content, meta.line, meta.line)
      handlers.addComment(meta.file, meta.side, meta.line, text, selected)
    }

    cancelButton.addEventListener("click", (event) => {
      event.stopPropagation()
      handlers.cancelDraft()
    })

    submitButton.addEventListener("click", (event) => {
      event.stopPropagation()
      submit()
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

    return wrapper
  }

  const comment = meta.comment!
  if (handlers.editing === comment.id) {
    wrapper.className = "am-annotation am-annotation-draft"

    const header = document.createElement("div")
    header.className = "am-annotation-header"
    header.textContent = handlers.labels.editCommentOnLine(comment.line)

    const textarea = document.createElement("textarea")
    textarea.className = "am-annotation-textarea"
    textarea.rows = 3
    textarea.value = comment.comment

    const actions = document.createElement("div")
    actions.className = "am-annotation-actions"

    const cancelButton = document.createElement("button")
    cancelButton.className = "am-annotation-btn"
    cancelButton.textContent = handlers.labels.cancel

    const saveButton = document.createElement("button")
    saveButton.className = "am-annotation-btn am-annotation-btn-submit"
    saveButton.textContent = handlers.labels.save

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
      const msg = formatReviewCommentMarkdown(comment)
      window.dispatchEvent(new MessageEvent("message", { data: { type: "appendChatBoxMessage", text: msg } }))
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
