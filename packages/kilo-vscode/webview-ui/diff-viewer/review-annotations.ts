import type { AnnotationSide, DiffLineAnnotation } from "@pierre/diffs"
import { clickSend, type SendIntent } from "../../src/shared/prompt-send"
import type { Delivery } from "../src/v2/pending-actions"
import { alternateClickKey, sendHintText } from "../src/v2/send-hint-text"
import type { ReviewCommentEntry, WorktreeFileDiff } from "../src/types/messages/agent-manager"
import { extractLines, formatReviewCommentsMarkdown, type ReviewComment } from "./review-comments"

// The translation parameters of the kilo-ui i18n context, declared here so the host tests can load this module.
type UiI18nParams = Record<string, string | number | boolean>

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

export interface CommentFormActions {
  body: string
  onBodyChange: (body: string) => void
  onSave: (body: string, selectedText: string) => void
  /** `send` is Enter's send for the form's action, or ⌥↵'s for an Option-click. */
  onSend: (body: string, selectedText: string, send: SendIntent) => void
  onGithubSuccess: () => void
  onCancel: () => void
  onDestination: (value: "local" | "github") => void
}

export type CommentFormMount = (
  host: HTMLElement,
  meta: AnnotationMeta,
  actions: CommentFormActions,
) => (() => void) | undefined

export function labels(t: (key: string, params?: UiI18nParams) => string, alternate: Delivery): AnnotationLabels {
  return {
    commentOnLine: (line) => t("agentManager.review.commentOnLine", { line }),
    editCommentOnLine: (line) => t("agentManager.review.editCommentOnLine", { line }),
    placeholder: t("agentManager.review.commentPlaceholder"),
    cancel: t("common.cancel"),
    comment: t("agentManager.review.commentAction"),
    send: t("prompt.action.send"),
    save: t("common.save"),
    sendToChat: sendHintText({
      action: t("agentManager.review.sendToChat"),
      click: alternateClickKey(t),
      alternate,
      t,
    }),
    edit: t("common.edit"),
    delete: t("common.delete"),
  }
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
  destination?: "local" | "github"
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

interface AnnotationHandlers {
  track?: (meta: AnnotationMeta, host: HTMLElement, dispose: () => void) => void
  diffs: WorktreeFileDiff[]
  editing: string | null
  setEditing: (id: string | null) => void
  addComment: (file: string, side: AnnotationSide, line: number, text: string, selectedText: string) => void
  /** `send` is Enter's send for the form's action, or ⌥↵'s for an Option-click. */
  sendComment: (
    file: string,
    side: AnnotationSide,
    line: number,
    text: string,
    selectedText: string,
    send: SendIntent,
  ) => void
  updateComment: (id: string, text: string) => void
  deleteComment: (id: string) => void
  cancelDraft: () => void
  completeRemoteDraft?: (meta: AnnotationMeta) => void
  /** Remember the destination so the next comment keeps the same choice. */
  onDestination?: (value: "local" | "github") => void
  mount?: CommentFormMount
  labels: AnnotationLabels
  sendToChatTitle?: () => string
  activeTerminalId: () => string | undefined
}

function focusWhenConnected(el: HTMLElement): () => void {
  if (el.isConnected) {
    el.focus()
    return () => {}
  }
  let attempts = 0
  let frame = 0
  const tick = () => {
    if (el.isConnected) {
      el.focus()
      return
    }
    attempts += 1
    if (attempts < 20) frame = requestAnimationFrame(tick)
  }
  frame = requestAnimationFrame(tick)
  return () => cancelAnimationFrame(frame)
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

function makeActionButton(
  title: string,
  icon: SVGSVGElement,
  action: (event: MouseEvent) => void,
  refreshTitle?: () => string,
): HTMLButtonElement {
  const button = document.createElement("button")
  button.className = "am-annotation-icon-btn"
  button.title = title
  button.appendChild(icon)
  if (refreshTitle) {
    button.addEventListener("pointerenter", () => {
      button.title = refreshTitle()
    })
  }
  button.addEventListener("click", (event) => {
    event.stopPropagation()
    action(event)
  })
  return button
}

/** Browser event that hands review comments to the prompt composer or a terminal of the panel. */
export const APPEND_REVIEW_COMMENTS = "agentManager.appendReviewComments"

export interface AppendReviewCommentsDetail {
  comments: ReviewCommentEntry[]
  /** The send a click asked for: Enter's delivery, or ⌥↵'s for an Option-click. */
  send: SendIntent
  targetTerminalId?: string
  /** Set by the consumer that took the batch, so exactly one consumer appends it. */
  handled?: boolean
}

export function sendReviewComments(
  comments: ReviewCommentEntry[],
  activeTerminalId?: string,
  send: SendIntent = "enter",
): boolean {
  const detail: AppendReviewCommentsDetail = { comments, send, targetTerminalId: activeTerminalId }
  window.dispatchEvent(new CustomEvent<AppendReviewCommentsDetail>(APPEND_REVIEW_COMMENTS, { detail }))
  return detail.handled === true
}

/**
 * Prompt composer side of the handoff. It takes only batches with no terminal
 * target, so a targeted send never reaches the composer as well.
 */
export function takeReviewCommentsForPromptBatch(
  detail: AppendReviewCommentsDetail | undefined,
): ReviewCommentEntry[] | undefined {
  if (!detail || detail.handled || detail.targetTerminalId) return undefined
  if (detail.comments.length === 0) return undefined
  detail.handled = true
  return detail.comments
}

/** The same handoff as markdown text, for a composer that has no review-comment chips. */
export function takeReviewCommentsForPrompt(detail: AppendReviewCommentsDetail | undefined): string | undefined {
  const comments = takeReviewCommentsForPromptBatch(detail)
  return comments ? formatReviewCommentsMarkdown(comments) : undefined
}

/** Terminal side of the handoff. It takes only the batch addressed to `terminalId`. */
export function takeReviewCommentsForTerminal(
  detail: AppendReviewCommentsDetail | undefined,
  terminalId: string,
): string | undefined {
  if (!detail || detail.handled || detail.targetTerminalId !== terminalId) return undefined
  if (detail.comments.length === 0) return undefined
  detail.handled = true
  return `${formatReviewCommentsMarkdown(detail.comments)}\n`
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

    if (handlers.mount) {
      wrapper.dataset.mounted = "true"
      const header = document.createElement("div")
      header.className = "am-annotation-header"
      header.textContent = handlers.labels.commentOnLine(meta.line)
      wrapper.appendChild(header)
      const host = document.createElement("div")
      host.className = "am-annotation-form"
      wrapper.appendChild(host)

      let dispose: (() => void) | undefined
      let unfocus: (() => void) | undefined

      // Keep focus attached to the mounted form's editor.
      const afterMount = () => {
        const field = host.querySelector<HTMLTextAreaElement>("textarea")
        if (!field) return
        unfocus?.()
        unfocus = focusWhenConnected(field)
      }

      dispose = handlers.mount(host, meta, {
        body: meta.text ?? "",
        onBodyChange: (body) => {
          meta.text = body
        },
        onSave: (body, selected) => handlers.addComment(meta.file, meta.side, meta.line, body.trim(), selected),
        onSend: (body, selected, send) =>
          handlers.sendComment(meta.file, meta.side, meta.line, body.trim(), selected, send),
        onGithubSuccess: () => handlers.completeRemoteDraft?.(meta),
        onCancel: handlers.cancelDraft,
        onDestination: (value) => {
          meta.destination = value
          handlers.onDestination?.(value)
        },
      })
      afterMount()

      handlers.track?.(meta, wrapper, () => {
        unfocus?.()
        dispose?.()
        dispose = undefined
      })
      return wrapper
    }

    // Fallback native composer for surfaces without a mounted form (for example the document panel).
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
    if (handlers.sendToChatTitle) {
      const refresh = handlers.sendToChatTitle
      sendButton.addEventListener("pointerenter", () => {
        sendButton.title = refresh()
      })
    }

    const update = () => {
      const disabled = textarea.value.trim().length === 0
      submitButton.disabled = disabled
      sendButton.disabled = disabled
    }

    actions.appendChild(cancelButton)
    actions.appendChild(submitButton)
    actions.appendChild(sendButton)
    wrapper.appendChild(header)
    wrapper.appendChild(textarea)
    wrapper.appendChild(actions)

    focusWhenConnected(textarea)
    update()

    const submit = () => {
      const text = textarea.value.trim()
      if (!text) return
      const diff = handlers.diffs.find((item) => item.file === meta.file)
      const content = meta.side === "deletions" ? (diff?.before ?? "") : (diff?.after ?? "")
      const selected = extractLines(content, meta.line, meta.endLine ?? meta.line)
      handlers.addComment(meta.file, meta.side, meta.line, text, selected)
    }

    const send = (event: MouseEvent) => {
      const text = textarea.value.trim()
      if (!text) return
      const diff = handlers.diffs.find((item) => item.file === meta.file)
      const content = meta.side === "deletions" ? (diff?.before ?? "") : (diff?.after ?? "")
      const selected = extractLines(content, meta.line, meta.endLine ?? meta.line)
      handlers.sendComment(meta.file, meta.side, meta.line, text, selected, clickSend(event))
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
      send(event)
    })

    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault()
        handlers.cancelDraft()
        return
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault()
        event.stopPropagation()
        if (event.altKey) {
          const text = textarea.value.trim()
          if (!text) return
          const diff = handlers.diffs.find((item) => item.file === meta.file)
          const content = meta.side === "deletions" ? (diff?.before ?? "") : (diff?.after ?? "")
          const selected = extractLines(content, meta.line, meta.endLine ?? meta.line)
          handlers.sendComment(meta.file, meta.side, meta.line, text, selected, "alternate")
          return
        }
        submit()
      }
    })
    textarea.addEventListener("input", update)

    return wrapper
  }

  return buildSavedAnnotation(meta, handlers)
}

function buildSavedAnnotation(meta: AnnotationMeta, handlers: AnnotationHandlers): HTMLElement {
  const wrapper = document.createElement("div")
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

    const save = () => {
      const text = textarea.value.trim()
      if (!text) return
      handlers.updateComment(comment.id, text)
    }

    saveButton.addEventListener("click", (event) => {
      event.stopPropagation()
      save()
    })

    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault()
        handlers.setEditing(null)
        return
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault()
        event.stopPropagation()
        save()
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
      handlers.labels.sendToChat,
      makeIcon("M1 1l14 7-14 7V9l10-1L1 7z"),
      (event) => {
        if (!sendReviewComments([comment], handlers.activeTerminalId(), clickSend(event))) return
        handlers.deleteComment(comment.id)
      },
      handlers.sendToChatTitle,
    ),
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
