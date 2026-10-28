import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import type { ModelRef } from "@opencode/client"
import { createEffect, createSignal, onCleanup, onMount, Show, type JSX } from "solid-js"
import { useLanguage } from "../context/language"
import { isEnterKeyCommitNotIme } from "../utils/ime-enter"
import { message, useV2 } from "./client"
import { cleanEnhancedPrompt, enhancePromptRequest, normalizeEnhancePromptErrorMessage } from "./enhance-prompt"

export function PromptInput(props: {
  session?: string
  running: boolean
  disabled: boolean
  /** The model the composer shows; Enhance uses it so the rewrite never depends on another provider. */
  model?: ModelRef
  onSend: (text: string) => Promise<boolean>
  onStop: () => void
  /** Agent, model and variant controls, before the actions as in main's PromptInput. */
  selectors?: JSX.Element
}) {
  const v2 = useV2()
  const language = useLanguage()
  const [text, setText] = createSignal("")
  const [sending, setSending] = createSignal(false)
  const [enhancing, setEnhancing] = createSignal(false)
  // The draft Enhance replaced, so Ctrl/Cmd+Z restores it once (as on v1).
  let preEnhance: string | null = null
  // Ignores a late result after a newer Enhance or a newer edit.
  let enhanceToken = 0
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
        if (!ok) return
        preEnhance = null
        if (text() === draft) setText("")
      })
      .catch(v2.report)
      .finally(() => setSending(false))
  }

  // v1 disabled Enhance while a prompt submission was in flight, as `isPromptBusy` counted `submitting`.
  const canEnhance = () => !props.running && !props.disabled && !enhancing() && !sending()

  const enhance = () => {
    if (!canEnhance()) return
    const draft = text().trim()
    // An empty draft explains the action instead of rewriting nothing, as on v1.
    if (!draft) {
      setText(language.t("prompt.action.enhanceDescription"))
      focus()
      return
    }
    preEnhance = text()
    const token = ++enhanceToken
    setEnhancing(true)
    void v2.api.generate
      .text({ prompt: enhancePromptRequest(draft), model: props.model })
      .then((response) => {
        if (token !== enhanceToken) return
        setText(cleanEnhancedPrompt(response.text))
        focus()
      })
      .catch((err: unknown) => {
        if (token !== enhanceToken) return
        v2.report(new Error(normalizeEnhancePromptErrorMessage(message(err))))
      })
      .finally(() => {
        // Clear unconditionally: an edit invalidates the token, and two Enhance requests cannot overlap
        // because canEnhance() blocks while enhancing() is true.
        setEnhancing(false)
      })
  }

  // VS Code's webview preload forwards Ctrl/Cmd+Z to the workbench, so the keydown must stop it. Only an
  // Enhance result is reverted here; any other undo keeps its native behavior.
  const undoKey = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return
    const z = e.keyCode === 90 || e.key.toLowerCase() === "z"
    const y = e.keyCode === 89 || e.key.toLowerCase() === "y"
    if (z) return e.shiftKey ? "redo" : "undo"
    if (y && !e.shiftKey) return "redo"
  }

  const undoEnhance = (e: KeyboardEvent) => {
    if (preEnhance === null || undoKey(e) !== "undo") return false
    e.preventDefault()
    e.stopPropagation()
    const restored = preEnhance
    preEnhance = null
    setText(restored)
    return true
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
            onInput={(e) => {
              // An edit invalidates an in-flight Enhance, so its late result cannot overwrite the new text.
              enhanceToken++
              preEnhance = null
              setText(e.currentTarget.value)
            }}
            onKeyDown={(e) => {
              if (undoEnhance(e)) return
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
          <div class="prompt-action">
            <Tooltip value={language.t("prompt.action.enhance")} placement="top" openDelay={0}>
              <IconButton
                icon="wand-sparkles"
                variant="ghost"
                size="small"
                onClick={enhance}
                disabled={!canEnhance()}
                loading={enhancing()}
                aria-label={language.t("prompt.action.enhance")}
              />
            </Tooltip>
          </div>
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
