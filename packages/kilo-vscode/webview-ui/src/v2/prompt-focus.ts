// Prompt focus restoration and keep-alive slot activation handling for PromptInput.
import { createEffect, on, onCleanup, onMount, type Accessor } from "solid-js"
import {
  hasPopup,
  hasQuestionOption,
  hasTextSelection,
  isTextControl,
  ownsFocusRegion,
  promptFocusAllowed,
} from "../utils/focus"

export function bindPromptFocus(opts: {
  input: () => HTMLTextAreaElement | undefined
  viewActive: Accessor<boolean>
  focusInput: () => void
  focusOnDraftChange?: () => boolean
  onDeactivate: () => void
  onActivate: () => void
}): void {
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

  const onFocusPrompt = (event: Event) => {
    if (!opts.viewActive()) return
    const detail = event instanceof CustomEvent ? (event.detail as Record<string, unknown> | undefined) : undefined
    const force = detail?.force === true
    const deferToQuestion = detail?.deferFocusToQuestion === true
    const allowed = () => {
      const el = opts.input()
      if (disposed || !opts.viewActive() || !el?.isConnected) return false
      if (force) return true
      const active = document.activeElement
      if (ownsFocusRegion(active) || (active !== el && isTextControl(active))) return false
      return promptFocusAllowed({
        force: false,
        deferToQuestion,
        questionOption: deferToQuestion ? hasQuestionOption() : false,
        ownsRegion: false,
        popup: hasPopup(),
        textControl: false,
        selection: hasTextSelection(),
      })
    }
    if (allowed()) opts.focusInput()
    if (detail?.restore !== true) return
    const restore = () => {
      if (disposed || !opts.viewActive()) return
      if (document.activeElement === opts.input() && document.hasFocus()) return
      if (!allowed()) return
      window.focus()
      opts.focusInput()
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
  onMount(() => {
    if (!opts.viewActive() || !document.hasFocus() || hasQuestionOption()) return
    if (opts.focusOnDraftChange?.() !== true) return
    window.dispatchEvent(new CustomEvent("focusPrompt", { detail: { deferFocusToQuestion: true } }))
  })
  // Defer focusPrompt when a cached slot re-activates so hasTextSelection() never forces a sync layout mid-click.
  createEffect(
    on(
      opts.viewActive,
      (active) => {
        if (!active) return opts.onDeactivate()
        opts.onActivate()
        const raf = requestAnimationFrame(() => {
          if (!opts.viewActive() || !document.hasFocus() || hasQuestionOption()) return
          if (opts.focusOnDraftChange?.() !== true) return
          window.dispatchEvent(new CustomEvent("focusPrompt", { detail: { deferFocusToQuestion: true } }))
        })
        onCleanup(() => cancelAnimationFrame(raf))
      },
      { defer: true },
    ),
  )
  onCleanup(() => {
    disposed = true
    for (const id of frames) cancelAnimationFrame(id)
    for (const id of timers) clearTimeout(id)
    frames.clear()
    timers.clear()
    window.removeEventListener("focusPrompt", onFocusPrompt)
  })
}
