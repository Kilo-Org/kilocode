import { createEffect, createMemo, createSignal, Show } from "solid-js"
import { type KeyEvent, type RGBA, type TextareaRenderable } from "@opentui/core"
import type { JSX } from "@opentui/solid"
import {
  createVimState,
  enterNormal,
  handleNormalKey,
  handleVisualKey,
  type VimDoc,
  type VimKey,
  type VimMode,
} from "./vim"

export interface VimDeps {
  input: () => TextareaRenderable | undefined
  disabled: () => boolean
  autocompleteVisible: () => boolean
  getVimEnabled: () => boolean
  bumpCursor: () => void
  cursorVersion: () => number
}

export interface VimApi {
  vimEnabled: () => boolean
  vimMode: () => VimMode
  vimOnKey: (e: KeyEvent) => boolean
  resetVim: () => void
}

/**
 * Set up vim modal editing for the prompt textarea. Returns the reactive
 * accessors and key handler the shared `Prompt` component wires into its
 * textarea, command palette, and meta-row indicator.
 *
 * Must be called within the `Prompt` component body so the SolidJS effects
 * are owned by the component.
 */
export function useVim(deps: VimDeps): VimApi {
  const state = createVimState("insert")
  const [mode, setMode] = createSignal<VimMode>("insert")
  const enabled = createMemo(() => deps.getVimEnabled())

  function sync() {
    if (state.mode !== mode()) setMode(state.mode)
    deps.bumpCursor()
  }

  function resetVim() {
    state.mode = "insert"
    state.operator = undefined
    state.awaitingG = false
    state.awaitingReplace = false
    state.countDigits = ""
    state.desiredColumn = undefined
    state.visualAnchor = undefined
    const input = deps.input()
    if (input && !input.isDestroyed) input.clearSelection()
    setMode("insert")
  }

  function doc(input: TextareaRenderable): VimDoc {
    return {
      get text() {
        return input.plainText
      },
      get cursor() {
        return input.cursorOffset
      },
      setCursor(offset: number) {
        input.cursorOffset = Math.max(0, Math.min(offset, input.plainText.length))
      },
      insert(offset: number, value: string) {
        input.cursorOffset = Math.max(0, Math.min(offset, input.plainText.length))
        input.insertText(value)
      },
      remove(start: number, end: number) {
        const removed = input.plainText.slice(start, end)
        input.setSelection(start, end)
        input.deleteSelection()
        return removed
      },
      undo() {
        input.undo()
      },
      redo() {
        input.redo()
      },
      setSelection(start: number, end: number) {
        input.setSelection(start, end)
      },
      clearSelection() {
        input.clearSelection()
      },
    }
  }

  /**
   * Intercept a key while vim mode is active. Returns true when the key was
   * consumed by the vim layer (caller must preventDefault so the textarea does
   * not also process it).
   */
  function vimOnKey(e: KeyEvent): boolean {
    const input = deps.input()
    if (!enabled() || deps.disabled() || !input || input.isDestroyed) return false

    // INSERT mode: only Escape is special (switch to NORMAL). Everything else
    // is left to the native textarea so typing behaves normally.
    if (state.mode === "insert") {
      if (e.name === "escape" && !deps.autocompleteVisible()) {
        enterNormal(doc(input), state)
        sync()
        return true
      }
      return false
    }

    const visual = state.mode === "visual" || state.mode === "visual-line"

    // In NORMAL mode keep Enter (submit) and Tab (autocomplete) working rather
    // than emulating strict vim line motions for them. In VISUAL mode the user
    // is selecting, so let the engine handle those keys instead.
    if (!visual && (e.name === "return" || e.name === "enter" || e.name === "tab")) return false

    // Let global ctrl/meta combos (e.g. ctrl+c to exit) through, except ctrl+r
    // which is vim redo.
    const ctrl = e.ctrl === true
    if ((ctrl || e.meta === true || e.super === true) && !(ctrl && e.name === "r")) return false

    const key: VimKey = ctrl
      ? { key: e.name, ctrl: true }
      : { key: e.sequence && e.sequence.length === 1 ? e.sequence : e.name }

    const result = visual ? handleVisualKey(doc(input), state, key) : handleNormalKey(doc(input), state, key)
    if (result.handled) sync()
    return result.handled
  }

  // Block cursor in NORMAL/VISUAL modes, bar cursor in INSERT mode (vim
  // convention). Also restores the default cursor when vim is disabled.
  createEffect(() => {
    if (!enabled()) {
      if (state.mode !== "insert") resetVim()
      const input = deps.input()
      if (input && !input.isDestroyed) input.cursorStyle = { style: "block", blinking: true }
      return
    }
    deps.cursorVersion()
    const input = deps.input()
    if (!input || input.isDestroyed) return
    input.cursorStyle = mode() === "insert" ? { style: "line", blinking: true } : { style: "block", blinking: false }
  })

  return { vimEnabled: enabled, vimMode: mode, vimOnKey, resetVim }
}

/**
 * Mode indicator shown in the prompt meta row. Renders nothing unless vim mode
 * is enabled and the prompt is not in shell mode.
 */
export function VimModeIndicator(props: {
  when: () => boolean
  mode: () => VimMode
  fade: (color: RGBA, alpha: number) => RGBA
  textMuted: () => RGBA
  info: () => RGBA
  warning: () => RGBA
  success: () => RGBA
  alpha: () => number
}): JSX.Element {
  return (
    <Show when={props.when()}>
      <box flexDirection="row" gap={1}>
        <text fg={props.fade(props.textMuted(), props.alpha())}>·</text>
        <text>
          <span
            style={{
              fg: props.fade(
                props.mode() === "insert"
                  ? props.info()
                  : props.mode() === "visual" || props.mode() === "visual-line"
                    ? props.warning()
                    : props.success(),
                props.alpha(),
              ),
              bold: true,
            }}
          >
            {props.mode() === "insert"
              ? "INSERT"
              : props.mode() === "visual"
                ? "VISUAL"
                : props.mode() === "visual-line"
                  ? "V-LINE"
                  : "NORMAL"}
          </span>
        </text>
      </box>
    </Show>
  )
}

/**
 * Command-palette entry that toggles vim mode on or off.
 */
export function vimToggleCommand(opts: {
  vimEnabled: () => boolean
  setVimEnabled: (value: boolean) => void
  resetVim: () => void
  clearDialog: () => void
  showToast: (message: string) => void
}) {
  return {
    title: "Toggle vim mode",
    desc: "Enable or disable vim modal editing in the prompt input",
    name: "prompt.vim.toggle",
    category: "Prompt",
    slashName: "vim",
    run: () => {
      const next = !opts.vimEnabled()
      opts.setVimEnabled(next)
      opts.resetVim()
      opts.clearDialog()
      opts.showToast(next ? "Vim mode enabled" : "Vim mode disabled")
    },
  }
}
