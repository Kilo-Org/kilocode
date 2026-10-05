// kilocode_change - new file
import type { ToastOptions } from "../ui/toast"

export type Notice = { title: string; message: string }

/**
 * Folds the notices collected during TUI bootstrap into the single toast the store can hold.
 * `toast.show` replaces `currentToast`, so raising each notice as its own fetch resolved let
 * whichever settled last silently drop the others: a command-list failure could disappear
 * behind an unrelated config warning, hiding the very failure the notice exists to report.
 *
 * A lone notice keeps its own title so the common case reads exactly as before.
 */
export function combine(notices: Notice[]): ToastOptions | undefined {
  const first = notices.at(0)
  if (!first) return undefined
  if (notices.length === 1) return { ...first, variant: "warning", duration: 0 }
  return {
    title: "Startup Warnings",
    message: notices.map((item) => `${item.title}: ${item.message}`).join("\n\n"),
    variant: "warning",
    duration: 0,
  }
}
