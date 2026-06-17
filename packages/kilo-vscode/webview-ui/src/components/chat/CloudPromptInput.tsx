import { type Component, createEffect, createMemo, createSignal, on, onCleanup, Show } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useSession } from "../../context/session"
import { useServer } from "../../context/server"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import { isEnterKeyCommitNotIme } from "../../utils/ime-enter"
import { cloudStatusError, cloudStatusKey } from "./cloud-status-label"

const drafts = new Map<string, string>()

interface CloudPromptInputProps {
  boxId?: string
}

export const CloudPromptInput: Component<CloudPromptInputProps> = (props) => {
  const session = useSession()
  const server = useServer()
  const language = useLanguage()
  const vscode = useVSCode()
  const sid = () => session.currentSessionID()
  const key = () => `${props.boxId ?? "prompt:cloud"}:${sid() ?? "new"}`
  const [text, setText] = createSignal("")
  let textareaRef: HTMLTextAreaElement | undefined

  const resize = () => {
    if (!textareaRef) return
    textareaRef.style.height = "auto"
    textareaRef.style.height = `${Math.min(textareaRef.scrollHeight, 200)}px`
  }

  createEffect(
    on(key, (next, prev) => {
      if (prev !== undefined && prev !== next) {
        const draft = text()
        if (draft) drafts.set(prev, draft)
        else drafts.delete(prev)
      }
      const draft = drafts.get(next) ?? ""
      setText(draft)
      if (!textareaRef) return
      textareaRef.value = draft
      resize()
    }),
  )

  const busy = () => session.submitting() || session.status() === "busy"
  const pending = () => !session.isCloudSessionHydrated(sid())
  const status = () => session.cloudStatus(sid())
  const blocked = () => pending() || !!status()
  const stoppable = () => blocked() || busy()
  const statusKey = createMemo(() => cloudStatusKey(status()))
  const statusError = createMemo(() => cloudStatusError(status()))
  const canSend = () => !blocked() && server.isConnected() && !!text().trim()

  const send = () => {
    if (!canSend()) return
    const message = text().trim()
    session.sendMessage(message)
    drafts.delete(key())
    setText("")
    if (textareaRef) textareaRef.style.height = "auto"
  }

  const unsubscribe = vscode.onMessage((message) => {
    if (message.type !== "sendMessageFailed" || message.sessionID !== sid() || text()) return
    setText(message.text)
    if (message.text) drafts.set(key(), message.text)
    queueMicrotask(resize)
  })
  onCleanup(unsubscribe)

  const input = (event: InputEvent) => {
    const target = event.target as HTMLTextAreaElement
    setText(target.value)
    resize()
  }

  const keydown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && stoppable()) {
      event.preventDefault()
      event.stopPropagation()
      session.abort()
      return
    }
    if (!isEnterKeyCommitNotIme(event) || event.shiftKey) return
    event.preventDefault()
    send()
  }

  return (
    <div class="prompt-input-container">
      <Show when={statusKey()} keyed>
        {(key) => (
          <div
            class="cloud-status-strip"
            classList={{ "cloud-status-strip--error": statusError() }}
            role="status"
            aria-live="polite"
          >
            <Show when={!statusError()}>
              <Spinner class="cloud-status-spinner" />
            </Show>
            <span>{language.t(key)}</span>
          </div>
        )}
      </Show>
      <div class="prompt-input-wrapper">
        <div class="prompt-input-ghost-wrapper">
          <div class="prompt-input-highlight-overlay" aria-hidden="true">
            <span>{text()}</span>
            {text().endsWith("\n") ? <br /> : null}
          </div>
          <textarea
            ref={textareaRef}
            class="prompt-input"
            classList={{ "prompt-input--disabled": !server.isConnected() || pending() }}
            placeholder={language.t("prompt.placeholder.default")}
            value={text()}
            onInput={input}
            onKeyDown={keydown}
            disabled={pending()}
            aria-disabled={!server.isConnected() || pending()}
            rows={1}
          />
        </div>
      </div>
      <div class="prompt-input-hint">
        <div />
        <div class="prompt-input-hint-actions">
          <Show
            when={stoppable()}
            fallback={
              <Tooltip value={language.t("prompt.action.send")} placement="top">
                <Button
                  variant="ghost"
                  size="small"
                  onClick={send}
                  aria-disabled={!canSend()}
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
