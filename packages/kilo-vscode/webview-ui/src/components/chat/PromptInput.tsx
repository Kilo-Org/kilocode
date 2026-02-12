/**
 * PromptInput component
 * Text input with send/abort buttons for the chat interface
 */

import { Component, createSignal, Show } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useSession } from "../../context/session"
import { useServer } from "../../context/server"
import { useLanguage } from "../../context/language"
import { ModelSelector } from "./ModelSelector"
import { ModeSwitcher } from "./ModeSwitcher"

export const PromptInput: Component = () => {
  const session = useSession()
  const server = useServer()
  const language = useLanguage()

  const [text, setText] = createSignal("")
  let textareaRef: HTMLTextAreaElement | undefined

  const isBusy = () => session.status() === "busy"
  const isDisabled = () => !server.isConnected()
  const canSend = () => text().trim().length > 0 && !isBusy() && !isDisabled()

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
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    // Enter to send (without shift)
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleSend = () => {
    const message = text().trim()
    if (!message || isBusy() || isDisabled()) return

    const sel = session.selected()
    session.sendMessage(message, sel?.providerID, sel?.modelID)
    setText("")

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
        <div class="prompt-input-actions">
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
      <div class="prompt-input-hint">
        <ModeSwitcher />
        <ModelSelector />
        <Show when={!isDisabled()}>
          <span>{language.t("prompt.hint.sendShortcut")}</span>
        </Show>
      </div>
    </div>
  )
}
