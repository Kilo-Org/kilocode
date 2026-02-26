import type { AnnotationSide, DiffLineAnnotation } from "@pierre/diffs"
import type { WorktreeFileDiff } from "../src/types/messages"
import { extractLines, type ReviewComment } from "./review-comments"

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

function makeActionButton(title: string, svg: string, action: () => void): HTMLButtonElement {
  const button = document.createElement("button")
  button.className = "am-annotation-icon-btn"
  button.title = title
  button.innerHTML = svg
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
    header.textContent = `Comment on line ${meta.line}`

    const textarea = document.createElement("textarea")
    textarea.className = "am-annotation-textarea"
    textarea.rows = 3
    textarea.placeholder = "Leave a comment..."

    const actions = document.createElement("div")
    actions.className = "am-annotation-actions"

    const cancelButton = document.createElement("button")
    cancelButton.className = "am-annotation-btn"
    cancelButton.textContent = "Cancel"

    const submitButton = document.createElement("button")
    submitButton.className = "am-annotation-btn am-annotation-btn-submit"
    submitButton.textContent = "Comment"

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
    header.textContent = `Edit comment on line ${comment.line}`

    const textarea = document.createElement("textarea")
    textarea.className = "am-annotation-textarea"
    textarea.rows = 3
    textarea.value = comment.comment

    const actions = document.createElement("div")
    actions.className = "am-annotation-actions"

    const cancelButton = document.createElement("button")
    cancelButton.className = "am-annotation-btn"
    cancelButton.textContent = "Cancel"

    const saveButton = document.createElement("button")
    saveButton.className = "am-annotation-btn am-annotation-btn-submit"
    saveButton.textContent = "Save"

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
    makeActionButton(
      "Send to chat",
      '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M1 1l14 7-14 7V9l10-1L1 7z"/></svg>',
      () => {
        const quote = comment.selectedText
          ? `\n> \`\`\`\n> ${comment.selectedText.split("\n").join("\n> ")}\n> \`\`\`\n`
          : ""
        const msg = `**${comment.file}** (line ${comment.line}):${quote}\n${comment.comment}`
        window.dispatchEvent(new MessageEvent("message", { data: { type: "appendChatBoxMessage", text: msg } }))
        handlers.deleteComment(comment.id)
      },
    ),
  )

  actions.appendChild(
    makeActionButton(
      "Edit",
      '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M13.2 1.1l1.7 1.7-1.1 1.1-1.7-1.7zM1 11.5V13.2h1.7l7.8-7.8-1.7-1.7z"/></svg>',
      () => handlers.setEditing(comment.id),
    ),
  )

  actions.appendChild(
    makeActionButton(
      "Delete",
      '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm3.1 9.3l-.8.8L8 8.8l-2.3 2.3-.8-.8L7.2 8 4.9 5.7l.8-.8L8 7.2l2.3-2.3.8.8L8.8 8z"/></svg>',
      () => handlers.deleteComment(comment.id),
    ),
  )

  wrapper.appendChild(body)
  wrapper.appendChild(actions)
  return wrapper
}
