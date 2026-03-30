/**
 * PromptInput component
 * Text input with send/abort buttons, ghost-text autocomplete, and @ file mention support
 */

import { Component, createSignal, createEffect, on, For, Index, onCleanup, Show, untrack } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { FileIcon } from "@kilocode/kilo-ui/file-icon"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { useSession } from "../../context/session"
import { useServer } from "../../context/server"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import { useWorktreeMode } from "../../context/worktree-mode"
import { ModelSelector } from "../shared/ModelSelector"
import { ModeSwitcher } from "../shared/ModeSwitcher"
import { ThinkingSelector } from "../shared/ThinkingSelector"
import { useFileMention } from "../../hooks/useFileMention"
import { useSlashCommand } from "../../hooks/useSlashCommand"
import { useGhostText } from "../../hooks/useGhostText"
import { useImageAttachments } from "../../hooks/useImageAttachments"
import { convertToMentionPath } from "../../utils/path-mentions"
import { usePromptHistory } from "../../hooks/usePromptHistory"
import { WandSparkles } from "@kilocode/kilo-ui/lucide"
import { fileName, dirName, buildHighlightSegments, atEnd } from "./prompt-input-utils"
import type { ReviewComment, TextPart } from "../../types/messages"
import { formatReviewCommentsMarkdown } from "../../utils/review-comment-markdown"

// Per-session input text storage (module-level so it survives remounts)
const drafts = new Map<string, string>()
const reviewDrafts = new Map<string, ReviewComment[]>()

function mergeReviewComments(current: ReviewComment[], incoming: ReviewComment[]): ReviewComment[] {
  if (incoming.length === 0) return current
  const map = new Map(current.map((item) => [item.id, item]))
  for (const item of incoming) {
    map.set(item.id, item)
  }
  return [...map.values()]
}

interface PromptInputProps {
  blocked?: () => boolean
}

export const PromptInput: Component<PromptInputProps> = (props) => {
  const session = useSession()
  const server = useServer()
  const language = useLanguage()
  const vscode = useVSCode()
  const worktree = useWorktreeMode()
  const dialog = useDialog()
  const mention = useFileMention(vscode)
  const excluded = worktree ? new Set(["sessions"]) : undefined
  const slash = useSlashCommand(vscode, excluded)
  const imageAttach = useImageAttachments()
  imageAttach.setFilePathDropHandler((paths) => {
    const cwd = server.workspaceDirectory()
    const resolved = paths.map((p) => convertToMentionPath(p, cwd))
    const ref = textareaRef
    if (!ref) return
    const val = ref.value
    const cursor = ref.selectionStart ?? val.length
    const before = val.substring(0, cursor)
    const after = val.substring(cursor)
    const inserted = resolved.map((p) => `@${p}`).join(" ")
    const result = before + inserted + " " + after
    ref.value = result
    setText(result)
    mention.addPaths(resolved, cwd)
    const pos = cursor + inserted.length + 1
    ref.setSelectionRange(pos, pos)
    ref.focus()
    adjustHeight()
  })
  const history = usePromptHistory()

  const sessionKey = () => session.currentSessionID() ?? "__new__"

  const [text, setText] = createSignal("")
  const [reviewComments, setReviewComments] = createSignal<ReviewComment[]>([])
  const [enhancing, setEnhancing] = createSignal(false)
  let enhanceCounter = 0
  let preEnhanceText: string | null = null

  const ghost = useGhostText(vscode, text, () => server.isConnected())

  const replaceReviewComments = (next: ReviewComment[]) => {
    setReviewComments(next)
    if (next.length === 0) {
      reviewDrafts.delete(sessionKey())
      return
    }
    reviewDrafts.set(sessionKey(), next)
  }

  const clearReviewComments = () => replaceReviewComments([])

  const removeReviewComment = (id: string) => {
    replaceReviewComments(reviewComments().filter((item) => item.id !== id))
  }

  const openReviewFile = (item: ReviewComment) => {
    const id = session.currentSessionID()
    if (worktree && id) {
      vscode.postMessage({ type: "agentManager.openFile", sessionId: id, filePath: item.file, line: item.line })
      dialog.close()
      return
    }
    vscode.postMessage({ type: "openFile", filePath: item.file, line: item.line, column: 1 })
    dialog.close()
  }

  const side = (item: ReviewComment) => (item.side === "deletions" ? "-" : "+")
  const reviewChipTitle = (item: ReviewComment) => `${fileName(item.file)} ${side(item)}${item.line}`

  const showReviewCommentDialog = (item: ReviewComment) => {
    dialog.show(() => (
      <Dialog title={language.t("agentManager.review.modalTitle")} fit>
        <div class="prompt-review-modal">
          <div class="prompt-review-modal-head">
            <span class="prompt-review-modal-headline">{reviewChipTitle(item)}</span>
            <Tooltip value={language.t("agentManager.diff.openFile")} placement="top">
              <IconButton
                icon="go-to-file"
                size="small"
                variant="ghost"
                label={language.t("agentManager.diff.openFile")}
                onClick={() => openReviewFile(item)}
              />
            </Tooltip>
          </div>

          <div class="prompt-review-modal-grid">
            <span class="prompt-review-modal-label">{language.t("agentManager.review.metaFile")}</span>
            <code class="prompt-review-modal-value">{item.file}</code>
            <span class="prompt-review-modal-label">{language.t("agentManager.review.metaLine")}</span>
            <span class="prompt-review-modal-value">L{item.line}</span>
            <span class="prompt-review-modal-label">{language.t("agentManager.review.metaComment")}</span>
            <span class="prompt-review-modal-value">{item.comment}</span>
          </div>

          <Show when={item.selectedText}>
            <pre class="prompt-review-modal-snippet">{item.selectedText}</pre>
          </Show>
        </div>
      </Dialog>
    ))
  }

  let textareaRef: HTMLTextAreaElement | undefined
  let highlightRef: HTMLDivElement | undefined
  let dropdownRef: HTMLDivElement | undefined
  let slashDropdownRef: HTMLDivElement | undefined
  // Save/restore input text when switching sessions.
  // Uses `on()` to track only sessionKey — avoids re-running on every keystroke.
  createEffect(
    on(sessionKey, (key, prev) => {
      if (prev !== undefined && prev !== key) {
        drafts.set(prev, untrack(text))
        const pending = untrack(reviewComments)
        if (pending.length > 0) reviewDrafts.set(prev, pending)
        else reviewDrafts.delete(prev)
      }
      const draft = drafts.get(key) ?? ""
      const pending = reviewDrafts.get(key) ?? []
      setText(draft)
      setReviewComments(pending)
      history.reset()
      if (textareaRef) {
        textareaRef.value = draft
        // Reset height then adjust
        textareaRef.style.height = "auto"
        textareaRef.style.height = `${Math.min(textareaRef.scrollHeight, 200)}px`
      }
      window.dispatchEvent(new Event("focusPrompt"))
    }),
  )

  // Seed prompt history from the current session's user messages (e.g., when a
  // session is loaded that has existing conversation). Tracks userMessages()
  // reactively so newly loaded sessions automatically contribute to history.
  // Strip review-comment markdown prefix so only the user's draft is stored.
  const REVIEW_PREFIX = /^## Review Comments\n[\s\S]*?\n\n/
  createEffect(() => {
    const msgs = session.userMessages()
    if (msgs.length === 0) return
    const texts = msgs.map((m) => {
      const parts = session.getParts(m.id)
      const raw = parts
        .filter((p): p is TextPart => p.type === "text")
        .map((p) => p.text)
        .join("")
      return raw.replace(REVIEW_PREFIX, "")
    })
    history.seed(texts)
  })

  // Focus textarea when any part of the app requests it
  const onFocusPrompt = () => textareaRef?.focus()
  window.addEventListener("focusPrompt", onFocusPrompt)
  onCleanup(() => window.removeEventListener("focusPrompt", onFocusPrompt))

  // Start a new task, carrying over the current prompt text (without auto-sending it)
  const onNewTaskRequest = () => {
    const prompt = text().trim()
    // Pre-populate the draft for the new (empty) session so the effect restores it
    if (prompt) drafts.set("__new__", prompt)
    session.clearCurrentSession()
  }
  window.addEventListener("newTaskRequest", onNewTaskRequest)
  onCleanup(() => window.removeEventListener("newTaskRequest", onNewTaskRequest))

  // Compact/summarize the current session (mirrors canCompact guards in TaskHeader)
  const onCompact = () => {
    if (session.status() === "busy") return
    if (session.messages().length === 0) return
    if (!session.selected()) return
    session.compact()
  }
  window.addEventListener("compactSession", onCompact)
  onCleanup(() => window.removeEventListener("compactSession", onCompact))

  const isBusy = () => session.status() === "busy"
  const isDisabled = () => !server.isConnected()
  const hasInput = () => text().trim().length > 0 || imageAttach.images().length > 0 || reviewComments().length > 0
  const canSend = () => hasInput() && !isDisabled() && !props.blocked?.()
  const showStop = () => isBusy() && !hasInput()
  const isAtEnd = () =>
    textareaRef ? atEnd(textareaRef.selectionStart, textareaRef.selectionEnd, textareaRef.value.length) : false
  const placeholder = () => {
    switch (server.connectionState()) {
      case "connecting":
        return language.t("prompt.placeholder.connecting")
      case "error":
        return language.t("prompt.placeholder.error")
      default:
        return language.t("prompt.placeholder.default")
    }
  }

  const unsubscribe = vscode.onMessage((message) => {
    if (message.type === "setChatBoxMessage") {
      setText(message.text)
      if (textareaRef) {
        textareaRef.value = message.text
        adjustHeight()
      }
    }

    if (message.type === "appendChatBoxMessage") {
      const current = text()
      const separator = current && !current.endsWith("\n") ? "\n\n" : ""
      const next = current + separator + message.text
      setText(next)
      if (textareaRef) {
        textareaRef.value = next
        adjustHeight()
        textareaRef.focus()
        textareaRef.scrollTop = textareaRef.scrollHeight
        syncHighlightScroll()
      }
    }

    if (message.type === "appendReviewComments") {
      const empty = !text().trim() && reviewComments().length === 0 && imageAttach.images().length === 0
      const merged = mergeReviewComments(reviewComments(), message.comments)
      replaceReviewComments(merged)
      if (message.autoSend && empty && !isDisabled() && !props.blocked?.()) {
        handleSend()
      } else {
        textareaRef?.focus()
      }
    }

    if (message.type === "triggerTask") {
      if (isDisabled()) return
      const sel = session.selected()
      session.sendMessage(message.text, sel?.providerID, sel?.modelID)
    }

    if (message.type === "sendMessageFailed") {
      const failed = message as import("../../types/messages").SendMessageFailedMessage
      // Only restore draft if the failure is for the current session and the
      // input is empty (user hasn't started typing something new).
      const target = failed.sessionID ?? "__new__"
      if (target === sessionKey() && !text().trim() && imageAttach.images().length === 0) {
        if (failed.text) {
          setText(failed.text)
          if (textareaRef) {
            textareaRef.value = failed.text
            adjustHeight()
            textareaRef.focus()
          }
        }
        const images = (failed.files ?? [])
          .filter((f) => f.mime.startsWith("image/") && f.url.startsWith("data:"))
          .map((f) => ({
            id: crypto.randomUUID(),
            filename: f.filename ?? "image",
            mime: f.mime,
            dataUrl: f.url,
          }))
        if (images.length > 0) imageAttach.replace(images)
      }
    }

    if (message.type === "action" && message.action === "focusInput") {
      textareaRef?.focus()
    }

    if (message.type === "enhancePromptResult") {
      const result = message as import("../../types/messages").EnhancePromptResultMessage
      if (result.requestId === `enhance-${enhanceCounter}`) {
        setText(result.text)
        setEnhancing(false)
        if (textareaRef) {
          textareaRef.value = result.text
          adjustHeight()
          textareaRef.focus()
        }
      }
    }

    if (message.type === "enhancePromptError") {
      const result = message as import("../../types/messages").EnhancePromptErrorMessage
      if (result.requestId === `enhance-${enhanceCounter}`) {
        setEnhancing(false)
      }
    }
  })

  onCleanup(() => {
    // Persist current draft before unmounting
    const current = text()
    if (current) drafts.set(sessionKey(), current)
    const pending = reviewComments()
    if (pending.length > 0) reviewDrafts.set(sessionKey(), pending)
    else reviewDrafts.delete(sessionKey())
    unsubscribe()
  })

  const acceptSuggestion = () => {
    const result = ghost.accept()
    if (!result) return

    const val = text() + result.text
    setText(val)

    if (textareaRef) {
      textareaRef.value = val
      adjustHeight()
      syncHighlightScroll()
    }
  }

  const syncGhost = () => ghost.sync(textareaRef)

  const scrollToActiveItem = () => {
    if (!dropdownRef) return
    const items = dropdownRef.querySelectorAll(".file-mention-item")
    const active = items[mention.mentionIndex()] as HTMLElement | undefined
    if (active) active.scrollIntoView({ block: "nearest" })
  }

  const scrollToActiveSlashItem = () => {
    if (!slashDropdownRef) return
    const items = slashDropdownRef.querySelectorAll(".slash-command-item")
    const active = items[slash.index()] as HTMLElement | undefined
    if (active) active.scrollIntoView({ block: "nearest" })
  }

  const syncHighlightScroll = () => {
    if (highlightRef && textareaRef) {
      highlightRef.scrollTop = textareaRef.scrollTop
    }
  }

  const adjustHeight = () => {
    if (!textareaRef) return
    textareaRef.style.height = "auto"
    textareaRef.style.height = `${Math.min(textareaRef.scrollHeight, 200)}px`
  }

  const handlePaste = (e: ClipboardEvent) => {
    imageAttach.handlePaste(e)
    // After pasting text, the textarea content changes but the layout may not
    // have reflowed yet, causing the caret position to be visually out of sync.
    // Defer height recalculation to after the browser completes the reflow.
    requestAnimationFrame(() => {
      adjustHeight()
      syncHighlightScroll()
    })
  }

  const handleInput = (e: InputEvent) => {
    const target = e.target as HTMLTextAreaElement
    const val = target.value
    setText(val)
    preEnhanceText = null
    adjustHeight()
    syncHighlightScroll()
    history.reset()

    slash.onInput(val, target.selectionStart ?? val.length)
    mention.onInput(val, target.selectionStart ?? val.length)
    ghost.setMentionOpen(slash.show() || mention.showMention())
    ghost.scheduleRequest(val, textareaRef)
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    // Undo enhanced prompt with Ctrl+Z / ⌘Z
    if (e.key === "z" && (e.metaKey || e.ctrlKey) && !e.shiftKey && preEnhanceText !== null) {
      e.preventDefault()
      const restored = preEnhanceText
      preEnhanceText = null
      setText(restored)
      if (textareaRef) {
        textareaRef.value = restored
        adjustHeight()
      }
      return
    }

    if (slash.onKeyDown(e, textareaRef, setText, adjustHeight)) {
      ghost.setMentionOpen(slash.show())
      queueMicrotask(scrollToActiveSlashItem)
      return
    }

    if (mention.onKeyDown(e, textareaRef, setText, adjustHeight)) {
      ghost.setMentionOpen(mention.showMention())
      queueMicrotask(scrollToActiveItem)
      return
    }

    // Prompt history: ArrowUp/ArrowDown at cursor boundaries cycles through sent prompts
    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      const start = textareaRef?.selectionStart ?? 0
      const end = textareaRef?.selectionEnd ?? 0
      if (start !== end) return // don't replace active text selection
      const cursor = start
      const direction = e.key === "ArrowUp" ? ("up" as const) : ("down" as const)
      const entry = history.navigate(direction, text(), cursor)
      if (entry !== null) {
        e.preventDefault()
        setText(entry)
        if (textareaRef) {
          textareaRef.value = entry
          adjustHeight()
          const pos = direction === "up" ? 0 : entry.length
          textareaRef.setSelectionRange(pos, pos)
        }
        return
      }
    }

    if (e.key === "Tab" && ghost.text()) {
      if (!isAtEnd()) return
      e.preventDefault()
      acceptSuggestion()
      return
    }
    if (e.key === "ArrowRight" && ghost.text()) {
      if (!isAtEnd()) return
      e.preventDefault()
      acceptSuggestion()
      return
    }
    if (e.key === "Escape" && ghost.text()) {
      e.preventDefault()
      e.stopPropagation()
      ghost.dismiss()
      return
    }
    if (e.key === "Escape" && isBusy()) {
      e.preventDefault()
      e.stopPropagation()
      session.abort()
      return
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const canEnhance = () => !isBusy() && !isDisabled() && !enhancing()

  const handleEnhance = () => {
    if (isDisabled() || enhancing() || isBusy()) return
    const draft = text().trim()
    if (!draft) {
      const description = language.t("prompt.action.enhanceDescription")
      setText(description)
      if (textareaRef) {
        textareaRef.value = description
        adjustHeight()
        textareaRef.focus()
      }
      return
    }
    preEnhanceText = text()
    enhanceCounter++
    setEnhancing(true)
    vscode.postMessage({ type: "enhancePrompt", text: draft, requestId: `enhance-${enhanceCounter}` })
  }

  const handleSend = () => {
    const draft = text().trim()

    // Detect slash command (hoisted for both client and server command checks).
    // Prioritize exact name matches over hint/alias matches so that a server
    // command named e.g. "continue" is not hijacked by a client alias.
    const cmdMatch = draft.match(/^\/(\S+)/)
    const word = cmdMatch?.[1]
    const matched = word
      ? (slash.commands().find((c) => c.name === word) ?? slash.commands().find((c) => c.hints.includes(word)))
      : undefined

    // Client-side slash command — runs locally without a backend round-trip
    if (matched?.action) {
      setText("")
      clearReviewComments()
      imageAttach.clear()
      mention.closeMention()
      slash.close()
      drafts.delete(sessionKey())
      if (textareaRef) textareaRef.style.height = "auto"
      matched.action()
      return
    }

    const imgs = imageAttach.images()
    const pending = reviewComments()
    const review = pending.length > 0 ? formatReviewCommentsMarkdown(pending) : ""
    const message = draft && review ? `${review}\n\n${draft}` : draft || review
    if ((!message && imgs.length === 0) || isDisabled() || props.blocked?.()) return

    const mentionFiles = mention.parseFileAttachments(draft)
    const imgFiles = imgs.map((img) => ({ mime: img.mime, url: img.dataUrl, filename: img.filename }))
    const allFiles = [...mentionFiles, ...imgFiles]

    const sel = session.selected()
    const attachments = allFiles.length > 0 ? allFiles : undefined

    // Server-side slash command (cmdMatch/matched already computed above)
    if (matched) {
      const rest = draft.slice(cmdMatch![0].length).trim()
      const args = review && rest ? `${review}\n\n${rest}` : rest || review
      session.sendCommand(matched.name, args, sel?.providerID, sel?.modelID, attachments)
    } else {
      session.sendMessage(message, sel?.providerID, sel?.modelID, attachments)
    }

    history.append(draft)
    history.reset()
    setText("")
    clearReviewComments()
    imageAttach.clear()
    mention.closeMention()
    slash.close()
    drafts.delete(sessionKey())

    if (textareaRef) textareaRef.style.height = "auto"
  }

  return (
    <div
      class="prompt-input-container"
      classList={{ "prompt-input-container--dragging": imageAttach.dragging() }}
      onDragOver={imageAttach.handleDragOver}
      onDragLeave={imageAttach.handleDragLeave}
      onDrop={imageAttach.handleDrop}
    >
      <Show when={reviewComments().length > 0}>
        <div class="prompt-review-comments">
          <div class="prompt-review-comments-header">
            <span class="prompt-review-comments-title">
              {language.t("agentManager.review.inlineCount", { count: reviewComments().length })}
            </span>
            <Button variant="ghost" size="small" onClick={clearReviewComments}>
              {language.t("agentManager.review.clearAll")}
            </Button>
          </div>
          <div class="prompt-review-chip-list">
            <For each={reviewComments()}>
              {(item) => (
                <div class="prompt-review-chip">
                  <button type="button" class="prompt-review-chip-body" onClick={() => showReviewCommentDialog(item)}>
                    <span class="prompt-review-chip-icon">
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                        <path
                          d="M3.2 11.8l-.6 2.5 2.3-1.2h6.1A2.8 2.8 0 0013.8 10V5A2.8 2.8 0 0011 2.2H5A2.8 2.8 0 002.2 5v5a2.8 2.8 0 001 2.2z"
                          stroke="currentColor"
                          stroke-width="1.4"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                      </svg>
                    </span>
                    <span class="prompt-review-chip-copy">
                      <span class="prompt-review-chip-main">
                        <span class="prompt-review-chip-title">{fileName(item.file)}</span>
                        <span class="prompt-review-chip-line">
                          {side(item)}
                          {item.line}
                        </span>
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    class="prompt-review-chip-remove"
                    onClick={() => removeReviewComment(item.id)}
                    aria-label={language.t("common.delete")}
                  >
                    ×
                  </button>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>
      <Show when={mention.showMention()}>
        <div class="file-mention-dropdown" ref={dropdownRef}>
          <Show
            when={mention.mentionResults().length > 0}
            fallback={<div class="file-mention-empty">No files found</div>}
          >
            <For each={mention.mentionResults()}>
              {(path, index) => (
                <div
                  class="file-mention-item"
                  classList={{ "file-mention-item--active": index() === mention.mentionIndex() }}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    if (textareaRef) mention.selectFile(path, textareaRef, setText, adjustHeight)
                  }}
                  onMouseEnter={() => mention.setMentionIndex(index())}
                >
                  <FileIcon node={{ path, type: "file" }} class="file-mention-icon" />
                  <span class="file-mention-name">{fileName(path)}</span>
                  <span class="file-mention-dir">{dirName(path)}</span>
                </div>
              )}
            </For>
          </Show>
        </div>
      </Show>
      <Show when={slash.show()}>
        <div class="slash-command-dropdown" ref={slashDropdownRef}>
          <Show when={slash.results().length > 0} fallback={<div class="slash-command-empty">No commands found</div>}>
            {(() => {
              const all = slash.results()
              const actions = all.filter((c) => c.action)
              const server = all.filter((c) => !c.action)
              const offset = actions.length
              return (
                <>
                  <Show when={actions.length > 0}>
                    <div class="slash-command-group-label">Actions</div>
                    <For each={actions}>
                      {(cmd, idx) => (
                        <div
                          class="slash-command-item"
                          classList={{ "slash-command-item--active": idx() === slash.index() }}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            if (textareaRef) slash.select(cmd, textareaRef, setText, adjustHeight)
                          }}
                          onMouseEnter={() => slash.setIndex(idx())}
                        >
                          <span class="slash-command-name">/{cmd.name}</span>
                          <Show when={cmd.description}>
                            <span class="slash-command-desc">{cmd.description}</span>
                          </Show>
                        </div>
                      )}
                    </For>
                  </Show>
                  <Show when={server.length > 0}>
                    <Show when={actions.length > 0}>
                      <div class="slash-command-separator" />
                    </Show>
                    <div class="slash-command-group-label">Commands</div>
                    <For each={server}>
                      {(cmd, idx) => (
                        <div
                          class="slash-command-item"
                          classList={{ "slash-command-item--active": idx() + offset === slash.index() }}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            if (textareaRef) slash.select(cmd, textareaRef, setText, adjustHeight)
                          }}
                          onMouseEnter={() => slash.setIndex(idx() + offset)}
                        >
                          <span class="slash-command-name">/{cmd.name}</span>
                          <Show when={cmd.description}>
                            <span class="slash-command-desc">{cmd.description}</span>
                          </Show>
                        </div>
                      )}
                    </For>
                  </Show>
                </>
              )
            })()}
          </Show>
        </div>
      </Show>
      <Show when={imageAttach.images().length > 0}>
        <div class="image-attachments">
          <For each={imageAttach.images()}>
            {(img) => (
              <div class="image-attachment">
                <img
                  src={img.dataUrl}
                  alt={img.filename}
                  title={img.filename}
                  onClick={() =>
                    vscode.postMessage({ type: "previewImage", dataUrl: img.dataUrl, filename: img.filename })
                  }
                />
                <button
                  type="button"
                  class="image-attachment-remove"
                  onClick={() => imageAttach.remove(img.id)}
                  aria-label="Remove image"
                >
                  ×
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>
      <div class="prompt-input-wrapper">
        <div class="prompt-input-ghost-wrapper">
          <div class="prompt-input-highlight-overlay" ref={highlightRef} aria-hidden="true">
            <Index each={buildHighlightSegments(text(), mention.mentionedPaths())}>
              {(seg) => (
                <Show when={seg().highlight} fallback={<span>{seg().text}</span>}>
                  <span class="prompt-input-file-mention">{seg().text}</span>
                </Show>
              )}
            </Index>
            <Show when={ghost.text()}>
              <span class="prompt-input-ghost-text">{ghost.text()}</span>
            </Show>
          </div>
          <textarea
            ref={textareaRef}
            class="prompt-input"
            classList={{ "prompt-input--disabled": isDisabled() }}
            placeholder={placeholder()}
            value={text()}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            onKeyUp={syncGhost}
            onPaste={handlePaste}
            onClick={syncGhost}
            onFocus={syncGhost}
            onBlur={syncGhost}
            onSelect={syncGhost}
            onScroll={syncHighlightScroll}
            aria-disabled={isDisabled()}
            rows={1}
          />
        </div>
      </div>
      <div class="prompt-input-hint">
        <div class="prompt-input-hint-selectors">
          <ModeSwitcher />
          <ModelSelector />
          <ThinkingSelector />
          <Show when={session.hasModelOverride()}>
            <Tooltip value={language.t("prompt.action.resetModel")} placement="top">
              <Button
                variant="ghost"
                size="small"
                onClick={() => session.clearModelOverride()}
                aria-label={language.t("prompt.action.resetModel")}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
                </svg>
              </Button>
            </Tooltip>
          </Show>
        </div>
        <div class="prompt-input-hint-actions">
          <Tooltip value={language.t("prompt.action.enhance")} placement="top">
            <Button
              variant="ghost"
              size="small"
              onClick={handleEnhance}
              disabled={!canEnhance()}
              aria-label={language.t("prompt.action.enhance")}
            >
              <WandSparkles size={16} class={enhancing() ? "enhance-spinner" : ""} />
            </Button>
          </Tooltip>
          <Show
            when={showStop()}
            fallback={
              <Tooltip
                value={props.blocked?.() ? language.t("prompt.action.send.blocked") : language.t("prompt.action.send")}
                placement="top"
              >
                <Button
                  variant="ghost"
                  size="small"
                  onClick={handleSend}
                  disabled={!canSend()}
                  aria-label={language.t("prompt.action.send")}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M1.5 1.5L14.5 8L1.5 14.5V9L10 8L1.5 7V1.5Z" />
                  </svg>
                </Button>
              </Tooltip>
            }
          >
            <Tooltip value={language.t("prompt.action.stop")} placement="top">
              <Button
                variant="ghost"
                size="small"
                onClick={() => session.abort()}
                aria-label={language.t("prompt.action.stop")}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <rect x="3" y="3" width="10" height="10" rx="1" />
                </svg>
              </Button>
            </Tooltip>
          </Show>
        </div>
      </div>
    </div>
  )
}
