import { type Component, createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useSession } from "../../context/session"
import { useServer } from "../../context/server"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import { useSlashCommand } from "../../hooks/useSlashCommand"
import { ModelSelector } from "../shared/ModelSelector"
import { ModeSwitcher } from "../shared/ModeSwitcher"
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
  const slash = useSlashCommand(vscode, undefined, { sessionID: sid })
  const key = () => `${props.boxId ?? "prompt:cloud"}:${sid() ?? "new"}`
  const [text, setText] = createSignal("")
  let textareaRef: HTMLTextAreaElement | undefined
  let slashRef: HTMLDivElement | undefined

  const resize = () => {
    if (!textareaRef) return
    textareaRef.style.height = "auto"
    textareaRef.style.height = `${Math.min(textareaRef.scrollHeight, 200)}px`
  }

  const scroll = () => {
    const items = slashRef?.querySelectorAll(".slash-command-item")
    const active = items?.[slash.index()] as HTMLElement | undefined
    active?.scrollIntoView({ block: "nearest" })
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
      slash.close()
      if (!textareaRef) return
      textareaRef.value = draft
      resize()
    }),
  )

  const busy = () => session.status() === "busy"
  const pending = () => !session.isCloudSessionHydrated(sid())
  const status = () => session.cloudStatus(sid())
  const statusKey = createMemo(() => cloudStatusKey(status()))
  const statusError = createMemo(() => cloudStatusError(status()))
  const canSend = () => {
    const sel = session.selected(sid())
    return (
      !pending() &&
      server.isConnected() &&
      !!text().trim() &&
      sel?.providerID === "kilo" &&
      !!sel.modelID &&
      !!session.selectedAgent(sid())
    )
  }

  const send = () => {
    if (!canSend()) return
    const message = text().trim()
    const resolved = slash.resolve(message)
    const sel = session.selected(sid())!
    if (resolved) {
      session.sendCommand(resolved.command.name, resolved.arguments, sel.providerID, sel.modelID)
    }
    if (!resolved) {
      const agent = session.selectedAgent(sid())
      session.sendMessage(message, sel.providerID, sel.modelID, undefined, undefined, undefined, agent)
    }
    drafts.delete(key())
    setText("")
    slash.close()
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
    const value = target.value
    setText(value)
    slash.onInput(value, target.selectionStart ?? value.length)
    resize()
  }

  const keydown = (event: KeyboardEvent) => {
    if (slash.onKeyDown(event, textareaRef, setText, resize)) {
      queueMicrotask(scroll)
      return
    }
    if (event.key === "Escape" && !pending() && busy()) {
      event.preventDefault()
      event.stopPropagation()
      session.abort()
      return
    }
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return
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
      <Show when={slash.show()}>
        <div class="slash-command-dropdown" ref={slashRef}>
          <Show when={slash.results().length > 0} fallback={<div class="slash-command-empty">No commands found</div>}>
            <div class="slash-command-group-label">Commands</div>
            <For each={slash.results()}>
              {(command, index) => (
                <div
                  class="slash-command-item"
                  classList={{ "slash-command-item--active": index() === slash.index() }}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    if (textareaRef) slash.select(command, textareaRef, setText, resize)
                  }}
                  onMouseEnter={() => slash.setIndex(index())}
                >
                  <span class="slash-command-name">/{command.name}</span>
                  <Show when={command.description}>
                    <span class="slash-command-desc">{command.description}</span>
                  </Show>
                </div>
              )}
            </For>
          </Show>
        </div>
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
        <div class="prompt-input-hint-selectors">
          <ModeSwitcher sessionID={sid} />
          <ModelSelector sessionID={sid} providerID="kilo" />
        </div>
        <div class="prompt-input-hint-actions">
          {pending() ? (
            <Spinner class="chat-spinner-small" />
          ) : busy() ? (
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
          ) : (
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
          )}
        </div>
      </div>
    </div>
  )
}
