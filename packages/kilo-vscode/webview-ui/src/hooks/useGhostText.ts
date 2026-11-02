import { createEffect, createSignal, onCleanup } from "solid-js"
import type { Accessor } from "solid-js"
import type { ExtensionMessage, WebviewMessage } from "../types/messages"
import { kiloSettings } from "../v2/kilo-settings"

const DEBOUNCE_MS = 500
const MIN_LENGTH = 3

interface VSCodeContext {
  postMessage: (message: WebviewMessage) => void
  onMessage: (handler: (message: ExtensionMessage) => void) => () => void
}

export interface GhostText {
  text: Accessor<string>
  enabled: Accessor<boolean>
  /** Idempotent sync - call from any handler to reconcile ghost text visibility. */
  sync: (textarea: HTMLTextAreaElement | undefined) => void
  /** Schedule a completion request after debounce. Call on every input. */
  scheduleRequest: (val: string, textarea: HTMLTextAreaElement | undefined) => void
  /** Accept the full ghost text suggestion. */
  accept: () => { text: string } | null
  /** Dismiss the current ghost text. */
  dismiss: () => void
}

/**
 * Centralized ghost text (AI autocomplete) hook.
 *
 * Single source of truth for ghost text visibility - call `sync()` from every
 * relevant handler (onInput, onFocus, onBlur, onSelect, onKeyDown, message
 * listener) instead of scattering show/hide logic.
 */
export function useGhostText(vscode: VSCodeContext, getText: () => string, connected: () => boolean): GhostText {
  const [ghost, setGhost] = createSignal("")
  // The live `kilo-code.v2.autocomplete.enableChatAutocomplete` setting; the host pushes it through
  // `vscodeSettingsLoaded`, so the signal updates without a reload.
  const enabled = () => kiloSettings()["autocomplete.enableChatAutocomplete"] === true

  let counter = 0
  let prefix = ""
  let timer: ReturnType<typeof setTimeout> | undefined

  // Saved ghost text for blur/focus preservation
  let saved = ""
  let savedPrefix = ""
  let focused = false

  const unsubscribe = vscode.onMessage((message) => {
    if (message.type !== "chatCompletionResult") return
    if (message.requestId !== `chat-ac-${counter}`) return
    if (message.text) {
      saved = message.text
      savedPrefix = prefix
    }
    // Don't set directly - let sync() decide visibility
    syncInternal(undefined)
  })

  onCleanup(() => {
    unsubscribe()
    if (timer) clearTimeout(timer)
  })

  /**
   * Core visibility derivation. The single source of truth.
   * Call this from every handler instead of manually setting ghost text.
   */
  function syncInternal(textarea: HTMLTextAreaElement | undefined) {
    // No saved suggestion → nothing to show
    if (!saved) {
      setGhost("")
      return
    }

    // Must be focused (if we can tell)
    if (!focused) {
      setGhost("")
      return
    }

    // Must be enabled and connected
    if (!enabled() || !connected()) {
      setGhost("")
      return
    }

    // Text must still match the prefix that generated this suggestion
    const val = getText()
    if (val !== savedPrefix) {
      saved = ""
      savedPrefix = ""
      setGhost("")
      return
    }

    // Cursor must be at end (if textarea is available)
    if (textarea) {
      const atEnd = textarea.selectionStart === textarea.selectionEnd && textarea.selectionEnd === textarea.value.length
      if (!atEnd) {
        setGhost("")
        return
      }
    }

    setGhost(saved)
  }

  // Reactively reconcile ghost text whenever the input text changes.
  // This replaces manual ghost.dismiss() calls after setText() - if the text
  // no longer matches savedPrefix, syncInternal will clear the ghost.
  // Also cancels pending debounce when text is cleared (e.g., on send).
  createEffect(() => {
    const val = getText()
    if (!val) {
      // Text cleared - cancel pending debounce and invalidate any in-flight
      // requests so a stale completion response cannot resurface ghost text
      // over the native placeholder.
      if (timer) {
        clearTimeout(timer)
        timer = undefined
      }
      saved = ""
      savedPrefix = ""
      prefix = ""
      counter++
    }
    syncInternal(undefined)
  })

  function sync(textarea: HTMLTextAreaElement | undefined) {
    // Track focus from the textarea
    if (textarea) {
      focused = document.activeElement === textarea
    }
    syncInternal(textarea)
  }

  function scheduleRequest(val: string, textarea: HTMLTextAreaElement | undefined) {
    // Clear saved suggestion on new input
    saved = ""
    savedPrefix = ""
    setGhost("")

    if (timer) clearTimeout(timer)

    if (val.length < MIN_LENGTH || !connected() || !enabled()) return

    // Check cursor is at end
    if (textarea) {
      const atEnd = textarea.selectionStart === textarea.selectionEnd && textarea.selectionEnd === textarea.value.length
      if (!atEnd) return
    }

    timer = setTimeout(() => {
      counter++
      prefix = val
      savedPrefix = val
      vscode.postMessage({ type: "requestChatCompletion", text: val, requestId: `chat-ac-${counter}` })
    }, DEBOUNCE_MS)
  }

  function accept(): { text: string } | null {
    const suggestion = ghost()
    if (!suggestion) return null

    saved = ""
    savedPrefix = ""
    setGhost("")
    vscode.postMessage({ type: "chatCompletionAccepted", suggestionLength: suggestion.length })
    return { text: suggestion }
  }

  function dismiss() {
    saved = ""
    savedPrefix = ""
    setGhost("")
  }

  return {
    text: ghost,
    enabled,
    sync,
    scheduleRequest,
    accept,
    dismiss,
  }
}
