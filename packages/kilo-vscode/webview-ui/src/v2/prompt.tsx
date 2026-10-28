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
  /** A pending permission blocks sending. Drives the blocked Send tooltip. */
  blocked?: boolean
  /** A pending question tool call. The composer waits for an answer, so Send replaces Stop. */
  questioning?: boolean
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
  // The label is the pending-permission hint while blocked, otherwise Send.
  const sendLabel = () =>
    props.blocked ? language.t("prompt.action.send.blocked") : language.t("prompt.action.send")
  // Stop replaces Send while the agent runs or a send is in flight, and the draft is empty. Typing during a run
  // turns it back into Send, whose prompt queues behind the running turn. A pending question is not running work.
  const showStop = () => (props.running || sending()) && !text().trim() && !props.questioning

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
    // Clear the draft as soon as it is sent, so the composer is empty and Stop replaces Send while the send is
    // in flight. Restore it only if the send fails and the user has not typed something new.
    setText("")
    setSending(true)
    void props
      .onSend(draft.trim())
      .then((ok) => {
        if (!ok && !text().trim()) setText(draft)
      })
      .catch((err: unknown) => {
        v2.report(err)
        if (!text().trim()) setText(draft)
      })
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
              when={showStop()}
              fallback={
                <Tooltip value={sendLabel()} placement="top" openDelay={0}>
                  <IconButton
                    icon="send"
                    variant="ghost"
                    size="small"
                    onClick={send}
                    disabled={!ready()}
                    aria-label={sendLabel()}
                  />
                </Tooltip>
              }
            >
              <Tooltip value={language.t("prompt.action.stop")} placement="top" openDelay={0}>
                <IconButton
                  icon="stop"
                  variant="ghost"
                  size="small"
                  onClick={props.onStop}
                  aria-label={language.t("prompt.action.stop")}
                />
              </Tooltip>
            </Show>
          </div>
        </div>
      </div>
    </div>
  )
}
