import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { showToast } from "@kilocode/kilo-ui/toast"
import type { JsonValue, ModelRef } from "@opencode/client"
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show, untrack, type JSX } from "solid-js"
import { fold, reserve } from "../components/chat/prompt-fold"
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
import type { PromptAttachment } from "../../../src/protocol"
import { CodeContextChips } from "../components/chat/CodeContextChips"
import { useImageAttachments } from "../hooks/useImageAttachments"
import { usePasteCollapse } from "../hooks/usePasteCollapse"
import { expandPastes } from "../components/chat/prompt-input-utils"
import { message, useV2 } from "./client"
import { registerComposer, type ComposerHandle } from "./composer"
import { attachmentDrafts, fileAttachments, imageAttachment, mergeAttachments, pasteDrafts } from "./prompt-attachments"
import { cleanEnhancedPrompt, enhancePromptRequest, normalizeEnhancePromptErrorMessage } from "./enhance-prompt"
import { insertSpacedText } from "./prompt-speech"
import { PromptOverflow, type OverflowItem } from "./prompt-overflow"
import { sendMode, sendShortcuts, type SendMode } from "./pending-actions"
import { PromptHint } from "./prompt-hint"

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
  /**
   * Sends the composed text. While the agent runs, `mode` chooses between steering, queueing and stopping to send now.
   * `input.items` are editor and terminal attachments; `input.metadata` carries browser references.
   */
  onSend: (
    text: string,
    mode: SendMode,
    input?: { items?: PromptAttachment[]; metadata?: { [key: string]: JsonValue } },
  ) => Promise<boolean>
  onStop: () => void
  /** Agent, model and variant controls, before the actions as in main's PromptInput. */
  selectors?: JSX.Element
  /** Auto-approve for permission requests. The toggle folds into the overflow menu like edge actions. */
  autoApprove?: { enabled: boolean; onToggle: () => void }
  /** Receives a function that appends text to the draft and, when `send` is true, sends it; undefined on unmount. */
  onAppendReady?: (append: AppendHandler | undefined) => void
  /** Receives a function that adds a browser reference to this draft; undefined on unmount. */
  onReferenceReady?: (add: ReferenceHandler | undefined) => void
  /** Receives the context actions handle of this composer; undefined on unmount. */
  onComposerReady?: (composer: ComposerHandle | undefined) => void
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
  // Editor selections, files, terminal output and images sent with the next prompt, per draft like the text.
  const [attachments, setAttachments] = createSignal<PromptAttachment[]>(attachmentDrafts.get(props.draftKey))
  const paste = usePasteCollapse({ enabled: () => !props.disabled, text })
  paste.load(untrack(text), pasteDrafts.get(props.draftKey))
  const images = useImageAttachments()
  // The hook reads files; the composer keeps one list, so a finished read moves into it.
  createEffect(() => {
    const read = images.images()
    if (read.length === 0) return
    setAttachments((current) => mergeAttachments(current, read.map(imageAttachment)))
    images.clear()
  })
  images.setFilePathDropHandler((paths) =>
    setAttachments((current) => mergeAttachments(current, fileAttachments(paths, v2.directory))),
  )
  const removeAttachment = (id: string) => setAttachments((current) => current.filter((item) => item.id !== id))
  const pictures = () => attachments().filter((item) => item.kind === "image")
  const contexts = () => attachments().filter((item) => item.kind !== "image")
  // The draft Enhance replaced, so Ctrl/Cmd+Z restores it once.
  let preEnhance: string | null = null
  let preEnhancePastes: string[] = []
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
  const ready = () => !props.disabled && !props.blocked && !sending() && images.pending() === 0
  const canSend = () =>
    ready() &&
    (speech.state() === "recording" ||
      (!speech.active() && (!!text().trim() || attachments().length > 0 || browsers().length > 0)))
  // The label is the pending-permission hint while blocked, otherwise Send.
  const sendLabel = () => {
    if (props.blocked) return language.t("prompt.action.send.blocked")
    if (speech.state() === "recording") return language.t("prompt.action.send.recording")
    return language.t("prompt.action.send")
  }
  // While the agent runs, a held modifier previews its send action on the Send button, so the user sees what Enter or
  // a click will do before pressing it. The accessible name stays "Send".
  const [held, setHeld] = createSignal<SendMode>("steer")
  const hold = (event: KeyboardEvent) => setHeld(sendMode(event, true))
  const release = () => setHeld("steer")
  onMount(() => {
    window.addEventListener("keydown", hold)
    window.addEventListener("keyup", hold)
    window.addEventListener("blur", release)
  })
  onCleanup(() => {
    window.removeEventListener("keydown", hold)
    window.removeEventListener("keyup", hold)
    window.removeEventListener("blur", release)
  })
  // An empty composer during a run suggests one shortcut in its placeholder: queueing, the one Enter cannot do. The
  // Send tooltip and the modifier preview cover the others.
  const runningHint = () =>
    !!props.running &&
    !props.questioning &&
    !text() &&
    !browsers().length &&
    speech.state() !== "recording" &&
    v2.connection.status() === "connected"
  const hintText = (key: string) =>
    language.t("prompt.placeholder.plainHint", { key, action: language.t("prompt.shortcutHint.queue") })
  // The placeholder template split around the key, so the key renders as keycaps.
  const keycaps = () => {
    const mark = "\u0001"
    const parts = hintText(mark).split(mark)
    return { before: parts.at(0) ?? "", after: parts.at(1) ?? "", binding: sendShortcuts().queue }
  }
  const busySend = () => props.running && !props.blocked && speech.state() !== "recording"
  const sendAction = (): SendMode => (busySend() ? held() : "steer")
  const sendIcon = () => ({ steer: "send", queue: "clock", now: "arrow-right" } as const)[sendAction()]
  const sendHint = () => {
    if (!busySend()) return sendLabel()
    const keys = sendShortcuts()
    if (held() === "queue") return language.t("prompt.action.queue", { key: keys.queue })
    if (held() === "now") return language.t("prompt.action.stopAndSend", { key: keys.now })
    return language.t("prompt.action.steer", keys)
  }
  // Stop replaces Send while the agent runs and the draft is empty. Typing during a run turns it back into Send,
  // whose prompt steers the running turn at its next step. A pending question is not running work. Stop is not shown
  // while the prompt is still being admitted, because an unadmitted prompt has no execution for Stop to interrupt.
  const showStop = () =>
    props.running &&
    !text().trim() &&
    !browsers().length &&
    attachments().length === 0 &&
    !props.questioning &&
    speech.state() !== "recording"

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
        attachmentDrafts.set(draft, untrack(attachments))
        pasteDrafts.set(
          draft,
          untrack(paste.pastes).map((item) => item.text),
        )
        keep(draft, untrack(browsers))
        draft = key
        setBrowsers(key ? (references.get(key) ?? []) : [])
        const value = promptDrafts.get(key)
        enhanceToken++
        preEnhance = null
        setText(value)
        paste.load(value, pasteDrafts.get(key))
        setAttachments(attachmentDrafts.get(key))
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
    attachmentDrafts.set(draft, attachments())
    pasteDrafts.set(
      draft,
      paste.pastes().map((item) => item.text),
    )
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

  // A context action sends its own prompt. It keeps the composer guards and returns its text and chips to the
  // draft when the composer cannot send or the send fails, so the request is never lost.
  const putInDraft = (value: string, items: PromptAttachment[]) => {
    const current = text()
    setText(current.trim() ? `${current}\n\n${value}` : value)
    setAttachments((list) => mergeAttachments(list, items))
    window.dispatchEvent(new CustomEvent("focusPrompt", { detail: { force: true, restore: true } }))
  }

  const submit = (mode: SendMode = "steer", external?: { text: string; items: PromptAttachment[] }) => {
    if (!ready() || (speech.active() && speech.state() !== "recording")) {
      if (external) putInDraft(external.text, external.items)
      return
    }
    if (!external && !canSend()) return
    const draft = text()
    // Capture the paste ranges before the draft is cleared, so a mismatched placeholder count still expands the
    // blocks that have backing text.
    const pastes = paste.pastes()
    const backing = pastes.map((item) => item.text)
    const items = external ? external.items : attachments()
    const picked = external ? [] : browsers()
    const prompt = browserPrompt(draft, picked)
    // Clear the draft as soon as it is sent, so the composer is empty while the prompt is admitted. Restore it only
    // if the send fails and the user has not typed, attached or picked something new.
    const restore = () => {
      if (external) return putInDraft(external.text, external.items)
      if (text().trim() || attachments().length > 0 || browsers().length > 0) return
      setText(draft)
      paste.load(draft, backing)
      setAttachments(items)
      setBrowsers(picked)
    }
    if (!external) {
      setText("")
      paste.load("", [])
      setAttachments([])
      setBrowsers([])
    }
    setSending(true)
    void props
      // The references hold only strings, numbers and arrays, so they are the JSON the prompt metadata requires.
      .onSend(external ? external.text : expandPastes(draft, pastes).trim(), mode, {
        items,
        metadata: prompt.metadata as { [key: string]: JsonValue } | undefined,
      })
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

  const send = (mode: SendMode = "steer") => {
    if (!canSend()) return
    if (speech.state() === "recording") {
      transcribeAndSend()
      return
    }
    submit(mode)
  }
  const queue = () => send("queue")

  registerComposer(props.onComposerReady, {
    attach: (items) => {
      setAttachments((current) => mergeAttachments(current, items))
      window.dispatchEvent(new CustomEvent("focusPrompt", { detail: { force: true, restore: true } }))
    },
    // A context action sends on its own and leaves the draft and its chips for the user's next prompt.
    submit: (value, items) => submit("steer", { text: value, items }),
  })

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
    const draft = paste.plainText(text()).trim()
    // An empty draft explains the action instead of rewriting nothing.
    if (!draft) {
      setText(language.t("prompt.action.enhanceDescription"))
      focusInput()
      return
    }
    preEnhance = text()
    preEnhancePastes = paste.pastes().map((item) => item.text)
    const token = ++enhanceToken
    setEnhancing(true)
    void v2.api.generate
      .text({ prompt: enhancePromptRequest(draft), model: props.model })
      .then((response) => {
        if (token !== enhanceToken) return
        const next = cleanEnhancedPrompt(response.text)
        setText(next)
        paste.load(next, [])
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
    paste.load(restored, preEnhancePastes)
    return true
  }

  // Progressive toolbar fold, driven by the toolbar width and font size only.
  // The list goes from low to high priority, so low priority actions fold first
  // and the actions next to voice and send stay in place. All sizes are read
  // from the DOM, so a larger font scales the fold steps.
  let hintRef: HTMLDivElement | undefined
  let pinnedRef: HTMLDivElement | undefined
  const [metrics, setMetrics] = createSignal({ width: Number.POSITIVE_INFINITY, pinned: 0, slot: 26, reserve: 210 })
  onMount(() => {
    const measure = () => {
      const hint = hintRef
      const pinned = pinnedRef
      if (!hint || !pinned) return
      const box = getComputedStyle(hint)
      const actions = pinned.parentElement
      const button = actions?.querySelector<HTMLElement>(".prompt-action [data-component='icon-button']")
      const gap = actions ? parseFloat(getComputedStyle(actions).columnGap) || 0 : 0
      setMetrics({
        width:
          hint.clientWidth -
          parseFloat(box.paddingLeft) -
          parseFloat(box.paddingRight) -
          (parseFloat(box.columnGap) || 0),
        pinned: pinned.getBoundingClientRect().width,
        slot: (button?.getBoundingClientRect().width ?? 22) + gap,
        reserve: reserve(hint),
      })
    }
    const observer = new ResizeObserver(measure)
    if (hintRef) observer.observe(hintRef)
    if (pinnedRef) observer.observe(pinnedRef)
    onCleanup(() => observer.disconnect())
  })
  const foldable = createMemo<OverflowItem[]>(() => {
    const list: OverflowItem[] = [
      {
        key: "enhance",
        icon: "wand-sparkles",
        label: language.t("prompt.action.enhance"),
        disabled: !canEnhance(),
        busy: enhancing(),
        run: enhance,
      },
    ]
    const autoApprove = props.autoApprove
    if (autoApprove)
      list.push({
        key: "approve",
        icon: "shield",
        label: language.t(
          autoApprove.enabled ? "prompt.action.autoApprove.disable" : "prompt.action.autoApprove.enable",
        ),
        description: language.t("prompt.action.autoApprove.sandboxExcluded"),
        tone: autoApprove.enabled ? "success" : undefined,
        dot: autoApprove.enabled ? "success" : undefined,
        run: autoApprove.onToggle,
      })
    return list
  })
  const shown = createMemo(() => fold({ ...metrics(), count: foldable().length }))
  const hidden = createMemo(() => foldable().slice(0, foldable().length - shown()))
  const folded = (key: string) => hidden().some((item) => item.key === key)
  const approveTooltip = () => {
    const autoApprove = props.autoApprove
    if (!autoApprove) return ""
    return `${language.t(
      autoApprove.enabled ? "prompt.action.autoApprove.enabled" : "prompt.action.autoApprove.disabled",
    )} ${language.t("prompt.action.autoApprove.sandboxExcluded")}`
  }

  return (
    <div
      class="prompt-input-container"
      classList={{ "prompt-input-container--dragging": images.dragging() }}
      onDragOver={images.handleDragOver}
      onDragLeave={images.handleDragLeave}
      onDrop={images.handleDrop}
    >
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
      <Show when={contexts().length > 0}>
        <CodeContextChips
          items={contexts()}
          disabled={props.disabled}
          onRemove={removeAttachment}
          onClear={() => setAttachments(pictures())}
        />
      </Show>
      <Show when={pictures().length > 0}>
        <div class="image-attachments">
          <For each={pictures()}>
            {(img) => (
              <div class="image-attachment">
                <img
                  src={img.uri}
                  alt={img.name}
                  title={img.name}
                  onClick={() => vscode.postMessage({ type: "previewImage", dataUrl: img.uri, filename: img.name })}
                />
                <IconButton
                  icon="close-small"
                  variant="ghost"
                  size="small"
                  class="image-attachment-remove"
                  disabled={props.disabled}
                  onClick={() => removeAttachment(img.id)}
                  aria-label={language.t("ui.promptInput.removeAttachment")}
                />
              </div>
            )}
          </For>
        </div>
      </Show>
      <div class="prompt-input-wrapper">
        <div class="prompt-input-ghost-wrapper">
          <div class="prompt-input-highlight-overlay" ref={(el) => (refs.overlay = el)} aria-hidden="true" dir="auto">
            <For each={paste.segments(text())}>
              {(seg) => (
                <Show when={seg.kind === "paste"} fallback={<span>{seg.text}</span>}>
                  <span
                    class="prompt-input-paste"
                    title={language.t("prompt.paste.expand")}
                    onClick={(e) => {
                      if (props.disabled || !refs.input || seg.paste === undefined) return
                      e.preventDefault()
                      e.stopPropagation()
                      paste.expand(seg.paste, refs.input, setText, () => {
                        enhanceToken++
                        preEnhance = null
                      })
                    }}
                  >
                    {seg.text}
                  </span>
                </Show>
              )}
            </For>
            <Show when={text().endsWith("\n")}>
              <br />
            </Show>
          </div>
          <Show when={runningHint()}>
            <PromptHint {...keycaps()} />
          </Show>
          <textarea
            ref={(el) => (refs.input = el)}
            class="prompt-input"
            classList={{ "prompt-input--disabled": props.disabled, "prompt-input--keycaps": runningHint() }}
            placeholder={
              v2.connection.status() !== "connected"
                ? language.t("prompt.placeholder.connecting")
                : runningHint()
                  ? hintText(sendShortcuts().queue)
                  : language.t("prompt.placeholder.plain")
            }
            aria-label={language.t("prompt.placeholder.plain")}
            value={text()}
            onBeforeInput={(e) => paste.beforeInput(e, refs.input)}
            onInput={(e) => {
              // An edit invalidates an in-flight Enhance, so its late result cannot overwrite the new text.
              enhanceToken++
              preEnhance = null
              setText(e.currentTarget.value)
              paste.afterInput()
            }}
            onPaste={(e) => {
              if (props.disabled || !refs.input) return
              images.handlePaste(e)
              paste.paste(e, refs.input, setText, () => {
                enhanceToken++
                preEnhance = null
              })
            }}
            onCopy={(e) => paste.clipboard(e, refs.input, setText)}
            onCut={(e) => paste.clipboard(e, refs.input, setText, true)}
            onKeyDown={(e) => {
              if (speechDown(e)) return
              if (undoEnhance(e)) return
              if (paste.backspace(e, refs.input, setText)) return
              paste.arrow(e, refs.input)
              if (!isEnterKeyCommitNotIme(e) || e.shiftKey) return
              e.preventDefault()
              send(sendMode(e, props.running))
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
      <div class="prompt-input-hint" ref={(el) => (hintRef = el)}>
        {props.selectors}
        <div class="prompt-input-hint-actions">
          <div class="prompt-action" data-folded={hidden().length === 0 ? "" : undefined}>
            <PromptOverflow items={hidden()} />
          </div>
          <div class="prompt-action" data-folded={folded("enhance") ? "" : undefined}>
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
          <Show when={props.autoApprove}>
            {(autoApprove) => (
              <div class="prompt-action" data-folded={folded("approve") ? "" : undefined}>
                <Tooltip value={approveTooltip()} placement="top" openDelay={0}>
                  <IconButton
                    icon="shield"
                    variant="ghost"
                    size="small"
                    onClick={autoApprove().onToggle}
                    aria-label={language.t(
                      autoApprove().enabled ? "prompt.action.autoApprove.disable" : "prompt.action.autoApprove.enable",
                    )}
                    aria-pressed={autoApprove().enabled}
                    class="prompt-status-button"
                    classList={{ "prompt-status-button--active": autoApprove().enabled }}
                  />
                </Tooltip>
              </div>
            )}
          </Show>
          <div class="prompt-input-hint-pinned" ref={(el) => (pinnedRef = el)}>
            <Show when={canUseSpeech()}>
              <SpeechToTextButton speech={speech} disabled={props.disabled} start={startSpeech} label={language.t} />
            </Show>
            <Show when={props.running && (!!text().trim() || browsers().length > 0)}>
              <Tooltip
                value={language.t("prompt.action.queue", { key: sendShortcuts().queue })}
                placement="top"
                openDelay={0}
              >
                <IconButton
                  icon="clock"
                  variant="ghost"
                  size="small"
                  onClick={queue}
                  disabled={!canSend() || speech.state() === "recording"}
                  aria-label={language.t("prompt.action.queue", { key: sendShortcuts().queue })}
                />
              </Tooltip>
            </Show>
            <Show
              when={showStop()}
              fallback={
                <Tooltip value={sendHint()} placement="top" openDelay={0}>
                  <IconButton
                    icon={sendIcon()}
                    variant="ghost"
                    size="small"
                    onClick={(event) => send(sendMode(event, props.running))}
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
