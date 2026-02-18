/**
 * PromptInput component
 * Text input with send/abort buttons and ghost-text autocomplete for the chat interface
 */

import { Component, createSignal, onCleanup, Show } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useSession } from "../../context/session"
import { useServer } from "../../context/server"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import { ModelSelector } from "./ModelSelector"
import { ModeSwitcher } from "./ModeSwitcher"

const AUTOCOMPLETE_DEBOUNCE_MS = 500
const MIN_TEXT_LENGTH = 3

export const PromptInput: Component = () => {
  const session = useSession()
  const server = useServer()
  const language = useLanguage()
  const vscode = useVSCode()

  const [text, setText] = createSignal("")
  const [ghostText, setGhostText] = createSignal("")
  let textareaRef: HTMLTextAreaElement | undefined
  let debounceTimer: ReturnType<typeof setTimeout> | undefined
  let requestCounter = 0

  const isBusy = () => session.status() === "busy"
  const isDisabled = () => !server.isConnected()
  const canSend = () => text().trim().length > 0 && !isBusy() && !isDisabled()

  // Listen for chat completion results from the extension
  const unsubscribe = vscode.onMessage((message) => {
    if (message.type === "chatCompletionResult") {
      const result = message as { type: "chatCompletionResult"; text: string; requestId: string }
      // Only apply if the requestId matches the latest request
      const expectedId = `chat-ac-${requestCounter}`
      if (result.requestId === expectedId && result.text) {
        setGhostText(result.text)
      }
    }
  })

  onCleanup(() => {
    unsubscribe()
    if (debounceTimer) {
      clearTimeout(debounceTimer)
    }
  })

  // Request autocomplete from the extension
  const requestAutocomplete = (currentText: string) => {
    if (currentText.length < MIN_TEXT_LENGTH || isDisabled()) {
      setGhostText("")
      return
    }

    requestCounter++
    const requestId = `chat-ac-${requestCounter}`

    vscode.postMessage({
      type: "requestChatCompletion",
      text: currentText,
      requestId,
    })
  }

  // Accept the ghost text suggestion
  const acceptSuggestion = () => {
    const suggestion = ghostText()
    if (!suggestion) return

    const newText = text() + suggestion
    setText(newText)
    setGhostText("")

    // Notify extension of acceptance for telemetry
    vscode.postMessage({
      type: "chatCompletionAccepted",
      suggestionLength: suggestion.length,
    })

    // Update textarea
    if (textareaRef) {
      textareaRef.value = newText
      adjustHeight()
    }
  }

  // Dismiss the ghost text
  const dismissSuggestion = () => {
    setGhostText("")
  }

  // Auto-resize textarea
  const adjustHeight = () => {
    if (!textareaRef) return
    textareaRef.style.height = "auto"
    textareaRef.style.height = `${Math.min(textareaRef.scrollHeight, 200)}px`
  }

  const handleInput = (e: InputEvent) => {
    const target = e.target as HTMLTextAreaElement
    setText(target.value)
    adjustHeight()

    // Clear existing ghost text on new input
    setGhostText("")

    // Debounce autocomplete request
    if (debounceTimer) {
      clearTimeout(debounceTimer)
    }
    debounceTimer = setTimeout(() => {
      requestAutocomplete(target.value)
    }, AUTOCOMPLETE_DEBOUNCE_MS)
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    // Tab or ArrowRight to accept ghost text
    if ((e.key === "Tab" || e.key === "ArrowRight") && ghostText()) {
      e.preventDefault()
      acceptSuggestion()
      return
    }

    // Escape to dismiss ghost text
    if (e.key === "Escape" && ghostText()) {
      e.preventDefault()
      dismissSuggestion()
      return
    }

    // Enter to send (without shift)
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      dismissSuggestion()
      handleSend()
    }
  }

  const handleSend = () => {
    const message = text().trim()
    if (!message || isBusy() || isDisabled()) return

    const sel = session.selected()
    session.sendMessage(message, sel?.providerID, sel?.modelID)
    setText("")
    setGhostText("")

    // Reset textarea height
    if (textareaRef) {
      textareaRef.style.height = "auto"
    }
  }

  const handleAbort = () => {
    session.abort()
  }

  return (
    <div class="prompt-input-container">
      <div class="prompt-input-wrapper">
        <div class="prompt-input-ghost-wrapper">
          <textarea
            ref={textareaRef}
            class="prompt-input"
            placeholder={
              isDisabled() ? language.t("prompt.placeholder.connecting") : language.t("prompt.placeholder.default")
            }
            value={text()}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            disabled={isDisabled()}
            rows={1}
          />
          <Show when={ghostText()}>
            <div class="prompt-input-ghost-overlay" aria-hidden="true">
              <span class="prompt-input-ghost-text-hidden">{text()}</span>
              <span class="prompt-input-ghost-text">{ghostText()}</span>
            </div>
          </Show>
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
              <Button variant="ghost" size="small" onClick={handleAbort} aria-label={language.t("prompt.action.stop")}>
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
