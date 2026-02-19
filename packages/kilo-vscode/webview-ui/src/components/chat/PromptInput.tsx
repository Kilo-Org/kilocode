/**
 * PromptInput component
 * Text input with send/abort buttons, ghost-text autocomplete, and @ file mention support
 */

import { Component, createSignal, createEffect, on, For, Index, onCleanup, Show, untrack } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { FileIcon } from "@kilocode/kilo-ui/file-icon"
import { useSession } from "../../context/session"
import { useServer } from "../../context/server"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import { ModelSelector } from "./ModelSelector"
import { ModeSwitcher } from "./ModeSwitcher"
import { useFileMention } from "../../hooks/useFileMention"
import { useImageAttachments } from "../../hooks/useImageAttachments"

const AUTOCOMPLETE_DEBOUNCE_MS = 500
const MIN_TEXT_LENGTH = 3

// Per-session input text storage (module-level so it survives remounts)
const drafts = new Map<string, string>()

export const PromptInput: Component = () => {
  const session = useSession()
  const server = useServer()
  const language = useLanguage()
  const vscode = useVSCode()
  const mention = useFileMention(vscode)
  const imageAttach = useImageAttachments()

  const sessionKey = () => session.currentSessionID() ?? "__new__"

  const [text, setText] = createSignal("")
  const [ghostText, setGhostText] = createSignal("")

  let textareaRef: HTMLTextAreaElement | undefined
  let highlightRef: HTMLDivElement | undefined
  let dropdownRef: HTMLDivElement | undefined
  let debounceTimer: ReturnType<typeof setTimeout> | undefined
  let requestCounter = 0
  // Save/restore input text when switching sessions.
  // Uses `on()` to track only sessionKey — avoids re-running on every keystroke.
  createEffect(
    on(sessionKey, (key, prev) => {
      if (prev !== undefined && prev !== key) {
        drafts.set(prev, untrack(text))
      }
      const draft = drafts.get(key) ?? ""
      setText(draft)
      setGhostText("")
      if (textareaRef) {
        textareaRef.value = draft
        // Reset height then adjust
        textareaRef.style.height = "auto"
        textareaRef.style.height = `${Math.min(textareaRef.scrollHeight, 200)}px`
      }
      window.dispatchEvent(new Event("focusPrompt"))
    }),
  )

  // Focus textarea when any part of the app requests it
  const onFocusPrompt = () => textareaRef?.focus()
  window.addEventListener("focusPrompt", onFocusPrompt)
  onCleanup(() => window.removeEventListener("focusPrompt", onFocusPrompt))

  const isBusy = () => session.status() === "busy"
  const isDisabled = () => !server.isConnected()
  const canSend = () => (text().trim().length > 0 || imageAttach.images().length > 0) && !isBusy() && !isDisabled()

  const unsubscribe = vscode.onMessage((message) => {
    if (message.type !== "chatCompletionResult") return
    const result = message as { type: "chatCompletionResult"; text: string; requestId: string }
    if (result.requestId === `chat-ac-${requestCounter}` && result.text) {
      setGhostText(result.text)
    }
  })

  onCleanup(() => {
    // Persist current draft before unmounting
    const current = text()
    if (current) drafts.set(sessionKey(), current)
    unsubscribe()
    if (debounceTimer) clearTimeout(debounceTimer)
  })

  const requestAutocomplete = (val: string) => {
    if (val.length < MIN_TEXT_LENGTH || isDisabled()) {
      setGhostText("")
      return
    }
    requestCounter++
    vscode.postMessage({ type: "requestChatCompletion", text: val, requestId: `chat-ac-${requestCounter}` })
  }

  const acceptSuggestion = () => {
    const suggestion = ghostText()
    if (!suggestion) return

    const newText = text() + suggestion
    setText(newText)
    setGhostText("")
    vscode.postMessage({ type: "chatCompletionAccepted", suggestionLength: suggestion.length })

    if (textareaRef) {
      textareaRef.value = newText
      adjustHeight()
    }
  }

  const dismissSuggestion = () => setGhostText("")

  const scrollToActiveItem = () => {
    if (!dropdownRef) return
    const items = dropdownRef.querySelectorAll(".file-mention-item")
    const active = items[mention.mentionIndex()] as HTMLElement | undefined
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

  const buildHighlightSegments = (val: string) => {
    const paths = mention.mentionedPaths()
    if (paths.size === 0) return [{ text: val, highlight: false }]

    const segments: { text: string; highlight: boolean }[] = []
    let remaining = val

    while (remaining.length > 0) {
      let earliest = -1
      let earliestPath = ""

      for (const path of paths) {
        const token = `@${path}`
        const idx = remaining.indexOf(token)
        if (idx !== -1 && (earliest === -1 || idx < earliest)) {
          earliest = idx
          earliestPath = path
        }
      }

      if (earliest === -1) {
        segments.push({ text: remaining, highlight: false })
        break
      }

      if (earliest > 0) {
        segments.push({ text: remaining.substring(0, earliest), highlight: false })
      }

      const token = `@${earliestPath}`
      segments.push({ text: token, highlight: true })
      remaining = remaining.substring(earliest + token.length)
    }

    return segments
  }

  const handleInput = (e: InputEvent) => {
    const target = e.target as HTMLTextAreaElement
    const val = target.value
    setText(val)
    adjustHeight()
    setGhostText("")
    syncHighlightScroll()

    mention.onInput(val, target.selectionStart ?? val.length)

    if (mention.showMention()) {
      setGhostText("")
      if (debounceTimer) clearTimeout(debounceTimer)
      return
    }

    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => requestAutocomplete(val), AUTOCOMPLETE_DEBOUNCE_MS)
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (mention.onKeyDown(e, textareaRef, setText, adjustHeight)) {
      setGhostText("")
      queueMicrotask(scrollToActiveItem)
      return
    }

    if ((e.key === "Tab" || e.key === "ArrowRight") && ghostText()) {
      e.preventDefault()
      acceptSuggestion()
      return
    }
    if (e.key === "Escape" && ghostText()) {
      e.preventDefault()
      dismissSuggestion()
      return
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      dismissSuggestion()
      handleSend()
    }
  }

  const handleSend = () => {
    const message = text().trim()
    const imgs = imageAttach.images()
    if ((!message && imgs.length === 0) || isBusy() || isDisabled()) return

    const mentionFiles = mention.parseFileAttachments(message)
    const imgFiles = imgs.map((img) => ({ mime: img.mime, url: img.dataUrl }))
    const allFiles = [...mentionFiles, ...imgFiles]

    const sel = session.selected()
    const attachments = allFiles.length > 0 ? allFiles : undefined

    session.sendMessage(message, sel?.providerID, sel?.modelID, attachments)

    requestCounter++
    setText("")
    setGhostText("")
    imageAttach.clear()
    if (debounceTimer) clearTimeout(debounceTimer)
    mention.closeMention()
    drafts.delete(sessionKey())

    if (textareaRef) textareaRef.style.height = "auto"
  }

  const fileName = (path: string) => path.replaceAll("\\", "/").split("/").pop() ?? path
  const dirName = (path: string) => {
    const parts = path.replaceAll("\\", "/").split("/")
    if (parts.length <= 1) return ""
    const dir = parts.slice(0, -1).join("/")
    return dir.length > 30 ? `…/${parts.slice(-3, -1).join("/")}` : dir
  }

  return (
    <div
      class="prompt-input-container"
      classList={{ "prompt-input-container--dragging": imageAttach.dragging() }}
      onDragOver={imageAttach.handleDragOver}
      onDragLeave={imageAttach.handleDragLeave}
      onDrop={imageAttach.handleDrop}
    >
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
      <Show when={imageAttach.images().length > 0}>
        <div class="image-attachments">
          <For each={imageAttach.images()}>
            {(img) => (
              <div class="image-attachment">
                <img src={img.dataUrl} alt={img.filename} title={img.filename} />
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
            <Index each={buildHighlightSegments(text())}>
              {(seg) => (
                <Show when={seg().highlight} fallback={<span>{seg().text}</span>}>
                  <span class="prompt-input-file-mention">{seg().text}</span>
                </Show>
              )}
            </Index>
            <Show when={ghostText()}>
              <span class="prompt-input-ghost-text">{ghostText()}</span>
            </Show>
          </div>
          <textarea
            ref={textareaRef}
            class="prompt-input"
            placeholder={
              isDisabled() ? language.t("prompt.placeholder.connecting") : language.t("prompt.placeholder.default")
            }
            value={text()}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={imageAttach.handlePaste}
            onScroll={syncHighlightScroll}
            disabled={isDisabled()}
            rows={1}
          />
        </div>
      </div>
      <div class="prompt-input-hint">
        <div class="prompt-input-hint-selectors">
          <ModeSwitcher />
          <ModelSelector />
        </div>
        <div class="prompt-input-hint-actions">
          <Show
            when={isBusy()}
            fallback={
              <Tooltip value={language.t("prompt.action.send")} placement="top">
                <Button
                  variant="primary"
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
