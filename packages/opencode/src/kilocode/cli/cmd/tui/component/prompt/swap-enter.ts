import { type TextareaRenderable } from "@opentui/core"
import { KILO_BASE_MODE, useBindings } from "@tui/keymap"

/** KV key holding the user's in-TUI choice (tui.json `swap_enter` is the default). */
export const SWAP_ENTER_KV_KEY = "swap_enter_enabled"

/**
 * Targeted keymap layer for the prompt textarea that rebinds Enter to insert a
 * newline and Ctrl+Enter to submit. Registered once; `enabled` is read lazily
 * at dispatch time so re-registration cannot reorder this layer against other
 * targeted layers like the autocomplete select binding. Pinned to the base
 * mode, overlays that push a mode (autocomplete popups, the palette) suppress
 * it regardless of layer order.
 */
export function useSwapEnter(deps: {
  target: () => TextareaRenderable | undefined
  blocked: () => boolean
  enabled: () => boolean
}) {
  useBindings(() => {
    const target = deps.target()
    return {
      target: () => target,
      mode: KILO_BASE_MODE,
      enabled: () => target !== undefined && !deps.blocked() && deps.enabled(),
      bindings: [
        {
          key: "return",
          desc: "Insert newline",
          group: "Prompt",
          cmd: () => {
            if (!target || target.isDestroyed) return false
            target.newLine()
            return true
          },
        },
        {
          key: "ctrl+return",
          desc: "Submit",
          group: "Prompt",
          cmd: () => {
            if (!target || target.isDestroyed) return false
            return target.submit()
          },
        },
      ],
    }
  })
}

/**
 * Command-palette entry that toggles the Enter/Ctrl+Enter swap on or off.
 */
export function swapEnterToggleCommand(opts: {
  swapEnabled: () => boolean
  setSwapEnabled: (value: boolean) => void
  clearDialog: () => void
  showToast: (message: string) => void
}) {
  return {
    get title() {
      return opts.swapEnabled() ? "Use Enter to send" : "Use Enter for a new line"
    },
    desc: "Make Enter insert a newline in the prompt and submit with Ctrl+Enter instead",
    name: "prompt.swap_enter.toggle",
    category: "Prompt",
    slashName: "swap-enter",
    run: () => {
      const next = !opts.swapEnabled()
      opts.setSwapEnabled(next)
      opts.clearDialog()
      opts.showToast(next ? "Enter inserts a newline, Ctrl+Enter submits" : "Enter submits")
    },
  }
}
