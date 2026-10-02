import { type TextareaRenderable } from "@opentui/core"
import { useBindings } from "@tui/keymap"

/** KV key holding the user's in-TUI choice (tui.json `swap_enter` is the default). */
export const SWAP_ENTER_KV_KEY = "swap_enter"

/**
 * Targeted keymap layer for the prompt textarea that rebinds Enter to insert a
 * newline and Ctrl+Enter to submit. Inactive unless the swap is enabled, the
 * prompt is editable and not in shell mode, so Enter keeps submitting shell
 * commands and other textareas (dialogs, message editor) keep default behavior.
 */
export function useSwapEnter(deps: {
  target: () => TextareaRenderable | undefined
  disabled: () => boolean
  shellMode: () => boolean
  enabled: () => boolean
}) {
  useBindings(() => {
    const target = deps.target()
    return {
      target: () => target,
      enabled: target !== undefined && !deps.disabled() && !deps.shellMode() && deps.enabled(),
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
