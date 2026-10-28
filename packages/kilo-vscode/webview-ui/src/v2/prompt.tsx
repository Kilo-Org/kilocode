import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { createEffect, createSignal, onCleanup, onMount, Show, type JSX } from "solid-js"
import { useLanguage } from "../context/language"
import { isEnterKeyCommitNotIme } from "../utils/ime-enter"
import { useV2 } from "./client"

export function PromptInput(props: {
  session?: string
  running: boolean
  disabled: boolean
  onSend: (text: string) => Promise<boolean>
  onStop: () => void
  /** Agent, model and variant controls, before the actions as in main's PromptInput. */
  selectors?: JSX.Element
}) {
  const v2 = useV2()
  const language = useLanguage()
  const [text, setText] = createSignal("")
  const [sending, setSending] = createSignal(false)
  const refs = { input: undefined as HTMLTextAreaElement | undefined, overlay: undefined as HTMLDivElement | undefined }
  const ready = () => !props.disabled && !sending() && !!text().trim()
  const stopping = () => props.running && !text().trim()

  const scroll = () => {
    if (!refs.input || !refs.overlay) return
    refs.overlay.scrollTop = refs.input.scrollTop
    refs.overlay.scrollLeft = refs.input.scrollLeft
  }

  createEffect(() => {
    text()
    if (!refs.input) return
    refs.input.style.height = "auto"
    // As in main: size to the content, which includes a wrapped placeholder.
    refs.input.style.height = `${Math.min(refs.input.scrollHeight, 200)}px`
    scroll()
  })

  const focus = () => refs.input?.focus({ preventScroll: true })
  onMount(() => window.addEventListener("focusPrompt", focus))
  onCleanup(() => window.removeEventListener("focusPrompt", focus))

  const send = () => {
    if (!ready()) return
    const draft = text()
    setSending(true)
    void props
      .onSend(draft.trim())
      .then((ok) => {
        if (ok && text() === draft) setText("")
      })
      .catch(v2.report)
      .finally(() => setSending(false))
  }

  return (
    <div class="prompt-input-container">
      <div class="prompt-input-wrapper">
        <div class="prompt-input-ghost-wrapper">
          <div class="prompt-input-highlight-overlay" ref={(el) => (refs.overlay = el)} aria-hidden="true" dir="auto">
            <span>{text()}</span>
            <Show when={text().endsWith("\n")}>
              <br />
            </Show>
          </div>
          <textarea
            ref={(el) => (refs.input = el)}
            class="prompt-input"
            classList={{ "prompt-input--disabled": props.disabled }}
            placeholder={
              v2.connection.status() === "connected"
                ? language.t("prompt.placeholder.plain")
                : language.t("prompt.placeholder.connecting")
            }
            aria-label={language.t("prompt.placeholder.plain")}
            value={text()}
            onInput={(e) => setText(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (!isEnterKeyCommitNotIme(e) || e.shiftKey) return
              e.preventDefault()
              send()
            }}
            onScroll={scroll}
            aria-disabled={props.disabled}
            readOnly={props.disabled}
            rows={1}
            dir="auto"
          />
        </div>
      </div>
      <div class="prompt-input-hint">
        {props.selectors}
        <div class="prompt-input-hint-actions">
          <div class="prompt-input-hint-pinned">
            <Show
              when={stopping()}
              fallback={
                <Tooltip value={language.t("prompt.action.send")} placement="top" openDelay={0}>
                  <IconButton
                    icon="send"
                    variant="ghost"
                    size="small"
                    onClick={send}
                    disabled={!ready()}
                    aria-label="Send"
                  />
                </Tooltip>
              }
            >
              <Tooltip value={language.t("prompt.action.stop")} placement="top" openDelay={0}>
                <IconButton icon="stop" variant="ghost" size="small" onClick={props.onStop} aria-label="Stop" />
              </Tooltip>
            </Show>
          </div>
        </div>
      </div>
    </div>
  )
}
