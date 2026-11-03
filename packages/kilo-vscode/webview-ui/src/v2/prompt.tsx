import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { showToast } from "@kilocode/kilo-ui/toast"
import type { ModelRef } from "@opencode/client"
import { createEffect, createSignal, onCleanup, onMount, Show, type JSX } from "solid-js"
import { SpeechToTextButton } from "../components/speech-to-text/SpeechToTextButton"
import { createSpeechShortcut } from "../components/speech-to-text/shortcut"
import { useSpeechStatus } from "../components/speech-to-text/status"
import { useSpeechToText } from "../components/speech-to-text/useSpeechToText"
import { useLanguage } from "../context/language"
import { useVSCode } from "../context/vscode"
import { isEnterKeyCommitNotIme } from "../utils/ime-enter"
import { message, useV2 } from "./client"
import { cleanEnhancedPrompt, enhancePromptRequest, normalizeEnhancePromptErrorMessage } from "./enhance-prompt"
import { GoalHeader } from "./goal"
import { insertSpacedText } from "./prompt-speech"

export function PromptInput(props: {
  session?: string
  running: boolean
  disabled: boolean
  /** The model the composer shows; Enhance uses it so the rewrite never depends on another provider. */
  model?: ModelRef
  /** A pending permission blocks sending. Drives the blocked Send tooltip. */
  blocked?: boolean
  /** A pending question tool call. The composer waits for an answer, so Send replaces Stop. */
  questioning?: boolean
  onSend: (text: string) => Promise<boolean>
  onStop: () => void
  /** Send a server command, such as the goal controls, instead of a model prompt. */
  onCommand?: (name: string, text: string) => Promise<boolean>
  /** Agent, model and variant controls, before the actions as in main's PromptInput. */
  selectors?: JSX.Element
  /** Prompt toolbar actions (auto-approve, and later indexing, sandbox and enhance as on main). */
  actions?: JSX.Element
}) {
  const v2 = useV2()
  const language = useLanguage()
  const [text, setText] = createSignal("")
  const [sending, setSending] = createSignal(false)
  // Composing a goal: the draft is the objective and Send starts the goal instead of prompting the model.
  const [goalMode, setGoalMode] = createSignal(false)
  const [enhancing, setEnhancing] = createSignal(false)
  // The draft Enhance replaced, so Ctrl/Cmd+Z restores it once.
  let preEnhance: string | null = null
  // Ignores a late result after a newer Enhance or a newer edit.
  let enhanceToken = 0
  const refs = { input: undefined as HTMLTextAreaElement | undefined, overlay: undefined as HTMLDivElement | undefined }
  const vscode = useVSCode()
  const speech = useSpeechToText(
    vscode,
    { goToLogin: () => vscode.postMessage({ type: "openProfile" }) },
    language,
    showToast,
  )
  const speechStatus = useSpeechStatus()
  const canUseSpeech = () => speechStatus.status().enabled
  // Recording is enough to send: the transcript arrives first and the send continues from it. No other speech state
  // may send, or a draft would leave before the transcript is ready and the transcript would become a draft.
  const canSend = () =>
    !props.disabled && !sending() && (speech.state() === "recording" || (!speech.active() && !!text().trim()))
  // The label is the pending-permission hint while blocked, otherwise Send.
  const sendLabel = () => {
    if (goalMode()) return language.t("prompt.goal.start")
    if (props.blocked) return language.t("prompt.action.send.blocked")
    if (speech.state() === "recording") return language.t("prompt.action.send.recording")
    return language.t("prompt.action.send")
  }
  // Stop replaces Send while the agent runs and the draft is empty. Typing during a run turns it back into Send,
  // whose prompt queues behind the running turn. A pending question is not running work. Stop is not shown while the
  // prompt is still being admitted, because an unadmitted prompt has no execution for Stop to interrupt.
  const showStop = () => props.running && !text().trim() && !props.questioning && speech.state() !== "recording"

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

  const insertSpeechText = (value: string) => {
    const ref = refs.input
    const current = text()
    const start = ref?.selectionStart ?? current.length
    const end = ref?.selectionEnd ?? start
    const result = insertSpacedText(current, value, start, end)
    enhanceToken++
    preEnhance = null
    setText(result.text)
    if (!ref) return
    ref.value = result.text
    ref.setSelectionRange(result.pos, result.pos)
    ref.focus()
  }

  const startSpeech = () => {
    speech.start({ model: speechStatus.status().model, insert: insertSpeechText })
  }

  const transcribeAndSend = () => {
    const value = text()
    const session = props.session
    speech.stop({
      done: () => void submit(),
      ready: () => props.session === session && text() === value,
    })
  }

  const sendGoal = (objective: string) => {
    const command = props.onCommand
    const value = objective.trim()
    if (!command || !value) return
    setText("")
    setSending(true)
    void command("goal", value)
      .then((ok) => {
        if (ok) {
          preEnhance = null
          setGoalMode(false)
        } else if (!text().trim()) setText(objective)
      })
      .catch((err: unknown) => {
        v2.report(err)
        if (!text().trim()) setText(objective)
      })
      .finally(() => setSending(false))
  }

  const submit = () => {
    if (!canSend()) return
    const draft = text()
    if (goalMode()) return sendGoal(draft)
    // `/goal` alone opens the goal composer; `/goal <objective>` starts it at once.
    if (draft.trim() === "/goal") {
      setText("")
      setGoalMode(true)
      return
    }
    if (draft.trim().startsWith("/goal ") && props.onCommand) return sendGoal(draft.trim().slice(6))
    // Clear the draft as soon as it is sent, so the composer is empty while the prompt is admitted. Restore it only
    // if the send fails and the user has not typed something new.
    setText("")
    setSending(true)
    void props
      .onSend(draft.trim())
      .then((ok) => {
        if (ok) preEnhance = null
        else if (!text().trim()) setText(draft)
      })
      .catch((err: unknown) => {
        v2.report(err)
        if (!text().trim()) setText(draft)
      })
      .finally(() => setSending(false))
  }

  const send = () => {
    if (!canSend()) return
    if (speech.state() === "recording") {
      transcribeAndSend()
      return
    }
    submit()
  }

  const shortcut = createSpeechShortcut({
    speech,
    disabled: () => !canUseSpeech() || props.disabled,
    start: startSpeech,
    finish: (shouldSubmit) => {
      if (shouldSubmit) {
        transcribeAndSend()
        return
      }
      speech.stop()
    },
  })
  const speechDown = (event: KeyboardEvent): boolean => {
    if (!shortcut.down(event)) return false
    event.preventDefault()
    event.stopPropagation()
    return true
  }
  const speechUp = (event: KeyboardEvent): boolean => {
    if (!shortcut.up(event)) return false
    event.preventDefault()
    event.stopPropagation()
    return true
  }
  onCleanup(shortcut.reset)

  // Blocked while a send is in flight, so the composer is never rewritten from under a pending submission.
  const canEnhance = () => !props.running && !props.disabled && !enhancing() && !sending()

  const enhance = () => {
    if (!canEnhance()) return
    const draft = text().trim()
    // An empty draft explains the action instead of rewriting nothing.
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
      <Show when={goalMode()}>
        <GoalHeader onCancel={() => setGoalMode(false)} />
      </Show>
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
              goalMode()
                ? language.t("prompt.goal.set")
                : v2.connection.status() === "connected"
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
              if (speechDown(e)) return
              if (undoEnhance(e)) return
              if (!isEnterKeyCommitNotIme(e) || e.shiftKey) return
              e.preventDefault()
              send()
            }}
            onKeyUp={(e) => {
              speechUp(e)
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
          {props.actions}
          <div class="prompt-input-hint-pinned">
            <Show when={canUseSpeech()}>
              <SpeechToTextButton speech={speech} disabled={props.disabled} start={startSpeech} label={language.t} />
            </Show>
            <Show
              when={showStop()}
              fallback={
                <Tooltip value={sendLabel()} placement="top" openDelay={0}>
                  <IconButton
                    icon="send"
                    variant="ghost"
                    size="small"
                    onClick={send}
                    disabled={!canSend()}
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
