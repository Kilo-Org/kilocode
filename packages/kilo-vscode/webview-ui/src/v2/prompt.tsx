import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { showToast } from "@kilocode/kilo-ui/toast"
import type { JsonValue, ModelRef } from "@opencode/client"
import { createEffect, createSignal, on, onCleanup, onMount, Show, untrack, type JSX } from "solid-js"
import { SpeechToTextButton } from "../components/speech-to-text/SpeechToTextButton"
import { createSpeechShortcut } from "../components/speech-to-text/shortcut"
import { useSpeechStatus } from "../components/speech-to-text/status"
import { useSpeechToText } from "../components/speech-to-text/useSpeechToText"
import { useLanguage } from "../context/language"
import { useVSCode } from "../context/vscode"
import {
  hasPopup,
  hasQuestionOption,
  hasTextSelection,
  isTextControl,
  ownsFocusRegion,
  promptFocusAllowed,
} from "../utils/focus"
import { isEnterKeyCommitNotIme } from "../utils/ime-enter"
import { browserPrompt, mergeBrowserReferences, type BrowserReference } from "../../../src/shared/browser-feedback"
import { registerAppend, type AppendHandler, type ReferenceHandler } from "./append-ready"
import { BrowserReferences } from "./browser-references"
import { message, useV2 } from "./client"
import { cleanEnhancedPrompt, enhancePromptRequest, normalizeEnhancePromptErrorMessage } from "./enhance-prompt"
import { insertSpacedText } from "./prompt-speech"

// Drafts live outside the component so a composer remounted for another session restores its own text, as v1 did.
// The key is the session id, or the pending tab id before a first prompt creates the session.
const drafts = new Map<string, string>()

// Browser references picked for each draft, kept with the same key as the draft text.
const references = new Map<string, BrowserReference[]>()

export const promptDrafts = {
  get(key: string | undefined) {
    return key ? (drafts.get(key) ?? "") : ""
  },
  set(key: string | undefined, value: string) {
    if (!key) return
    if (value) drafts.set(key, value)
    else drafts.delete(key)
  },
}

export function PromptInput(props: {
  session?: string
  /** Draft identity: the session id, or the pending tab id before a session exists. */
  draftKey?: string
  running: boolean
  disabled: boolean
  /** The model the composer shows; Enhance uses it so the rewrite never depends on another provider. */
  model?: ModelRef
  /** A pending permission blocks sending. Drives the blocked Send tooltip. */
  blocked?: boolean
  /** A pending question tool call. The composer waits for an answer, so Send replaces Stop. */
  questioning?: boolean
  /** Sends the composed text. `metadata` carries the structured browser references the text also describes. */
  onSend: (text: string, metadata?: { [key: string]: JsonValue }) => Promise<boolean>
  onStop: () => void
  /** Agent, model and variant controls, before the actions as in main's PromptInput. */
  selectors?: JSX.Element
  /** Prompt toolbar actions (auto-approve, and later indexing, sandbox and enhance as on main). */
  actions?: JSX.Element
  /** Receives a function that appends text to the draft and, when `send` is true, sends it; undefined on unmount. */
  onAppendReady?: (append: AppendHandler | undefined) => void
  /** Receives a function that adds a browser reference to this draft; undefined on unmount. */
  onReferenceReady?: (add: ReferenceHandler | undefined) => void
}) {
  const v2 = useV2()
  const language = useLanguage()
  const [text, setText] = createSignal(promptDrafts.get(props.draftKey))
  const [browsers, setBrowsers] = createSignal(props.draftKey ? (references.get(props.draftKey) ?? []) : [])
  const keep = (key: string | undefined, list: BrowserReference[]) => {
    if (!key) return
    if (list.length) references.set(key, list)
    else references.delete(key)
  }
  const [sending, setSending] = createSignal(false)
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
    !props.disabled &&
    !sending() &&
    (speech.state() === "recording" || (!speech.active() && (!!text().trim() || browsers().length > 0)))
  // The label is the pending-permission hint while blocked, otherwise Send.
  const sendLabel = () => {
    if (props.blocked) return language.t("prompt.action.send.blocked")
    if (speech.state() === "recording") return language.t("prompt.action.send.recording")
    return language.t("prompt.action.send")
  }
  // Stop replaces Send while the agent runs and the draft is empty. Typing during a run turns it back into Send,
  // whose prompt queues behind the running turn. A pending question is not running work. Stop is not shown while the
  // prompt is still being admitted, because an unadmitted prompt has no execution for Stop to interrupt.
  const showStop = () =>
    props.running && !text().trim() && !browsers().length && !props.questioning && speech.state() !== "recording"

  const scroll = () => {
    if (!refs.input || !refs.overlay) return
    refs.overlay.scrollTop = refs.input.scrollTop
    refs.overlay.scrollLeft = refs.input.scrollLeft
  }

  // Switching drafts saves the text of the draft being left and restores the target draft. SessionView normally
  // remounts this component for another key; this also covers a key change without a remount.
  let draft = props.draftKey
  createEffect(
    on(
      () => props.draftKey,
      (key) => {
        if (key === draft) return
        promptDrafts.set(draft, untrack(text))
        keep(draft, untrack(browsers))
        draft = key
        setBrowsers(key ? (references.get(key) ?? []) : [])
        const value = promptDrafts.get(key)
        enhanceToken++
        preEnhance = null
        setText(value)
        if (refs.input) {
          refs.input.value = value
          refs.input.scrollTop = 0
        }
        scroll()
      },
    ),
  )
  onCleanup(() => {
    promptDrafts.set(draft, text())
    keep(draft, browsers())
  })

  createEffect(() => {
    text()
    if (!refs.input) return
    refs.input.style.height = "auto"
    // As in main: size to the content, which includes a wrapped placeholder.
    refs.input.style.height = `${Math.min(refs.input.scrollHeight, 200)}px`
    scroll()
  })

  const focusInput = () => refs.input?.focus({ preventScroll: true })
  // The restore chain outlives the event that started it, so every handle is tracked and dropped on unmount.
  const frames = new Set<number>()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  let disposed = false
  const frame = (run: () => void) => {
    const id = requestAnimationFrame(() => {
      frames.delete(id)
      if (!disposed) run()
    })
    frames.add(id)
  }
  const timer = (run: () => void, delay: number) => {
    const id = setTimeout(() => {
      timers.delete(id)
      if (!disposed) run()
    }, delay)
    timers.add(id)
  }
  // A restore retries after the dialog, menu or question that owned focus closes, but never takes focus from
  // another text control, a popup or a selection.
  const onFocusPrompt = (event: Event) => {
    const detail = event instanceof CustomEvent ? (event.detail as Record<string, unknown> | undefined) : undefined
    const force = detail?.force === true
    const allowed = () =>
      !disposed &&
      !!refs.input?.isConnected &&
      promptFocusAllowed({
        force,
        deferToQuestion: detail?.deferFocusToQuestion === true,
        questionOption: hasQuestionOption(),
        ownsRegion: ownsFocusRegion(document.activeElement),
        popup: hasPopup(),
        textControl: document.activeElement !== refs.input && isTextControl(document.activeElement),
        selection: hasTextSelection(),
      })
    const focus = () => {
      if (!allowed()) return
      focusInput()
    }
    focus()
    if (detail?.restore !== true) return
    const restore = () => {
      if (!allowed()) return
      window.focus()
      focus()
    }
    queueMicrotask(restore)
    frame(() => {
      restore()
      frame(restore)
      timer(restore, 0)
      timer(restore, 50)
    })
  }
  onMount(() => window.addEventListener("focusPrompt", onFocusPrompt))
  onCleanup(() => {
    disposed = true
    for (const id of frames) cancelAnimationFrame(id)
    for (const id of timers) clearTimeout(id)
    frames.clear()
    timers.clear()
    window.removeEventListener("focusPrompt", onFocusPrompt)
  })

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

  const submit = () => {
    if (!canSend()) return
    const draft = text()
    const picked = browsers()
    const prompt = browserPrompt(draft, picked)
    // Clear the draft as soon as it is sent, so the composer is empty while the prompt is admitted. Restore it only
    // if the send fails and the user has not typed something new.
    const restore = () => {
      if (text().trim() || browsers().length) return
      setText(draft)
      setBrowsers(picked)
    }
    setText("")
    setBrowsers([])
    setSending(true)
    void props
      // The references hold only strings, numbers and arrays, so they are the JSON the prompt metadata requires.
      .onSend(prompt.text, prompt.metadata as { [key: string]: JsonValue } | undefined)
      .then((ok) => {
        if (ok) preEnhance = null
        else restore()
      })
      .catch((err: unknown) => {
        v2.report(err)
        restore()
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

  registerAppend(props.onAppendReady, (value, shouldSend) => {
    const current = text()
    enhanceToken++
    preEnhance = null
    setText(current.trim() ? `${current}\n\n${value}` : value)
    if (shouldSend) send()
    else focusInput()
  })

  // A reference for another session is dropped: the browser tab can outlive the session the composer shows.
  registerAppend<ReferenceHandler>(props.onReferenceReady, (reference) => {
    if (props.session && reference.sessionId !== props.session) return
    setBrowsers((current) => mergeBrowserReferences(current, reference))
    focusInput()
  })

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
      focusInput()
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
        focusInput()
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
      <Show when={browsers().length > 0}>
        <div data-component="browser-references">
          <BrowserReferences
            references={browsers()}
            onRemove={(id) => {
              if (!props.disabled) setBrowsers((current) => current.filter((item) => item.id !== id))
            }}
            onClear={() => {
              if (!props.disabled) setBrowsers([])
            }}
          />
        </div>
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
