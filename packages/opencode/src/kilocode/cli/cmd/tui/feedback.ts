// kilocode_change - new file
/**
 * Per-message thumbs up/down feedback for the TUI.
 *
 * Wired via the `messages_feedback_up` / `messages_feedback_down` keybinds
 * in the Session route. Kept out of `routes/session/index.tsx` so the
 * upstream-shared session route stays free of Kilo telemetry plumbing.
 */
import { Telemetry } from "@kilocode/kilo-telemetry"
import type { AssistantMessage, Message } from "@kilocode/sdk/v2"
import type { DialogContext } from "@tui/ui/dialog"
import type { ToastContext } from "@tui/ui/toast"

interface SessionRevert {
  revert?: { messageID: string }
}

interface Context {
  toast: ToastContext
  session: () => SessionRevert | undefined
  messages: () => Message[]
}

export function submitFeedback(rating: "up" | "down", dialog: DialogContext, ctx: Context): void {
  if (!Telemetry.isEnabled()) {
    ctx.toast.show({ message: "Feedback disabled: telemetry is off", variant: "info" })
    dialog.clear()
    return
  }
  const revertID = ctx.session()?.revert?.messageID
  const lastAssistant = ctx
    .messages()
    .findLast((msg): msg is AssistantMessage => msg.role === "assistant" && (!revertID || msg.id < revertID))
  if (!lastAssistant) {
    ctx.toast.show({ message: "No assistant messages found", variant: "error" })
    dialog.clear()
    return
  }
  const providerID = lastAssistant.providerID
  const payload: Telemetry.FeedbackProperties = {
    providerID,
    modelID: lastAssistant.modelID,
    rating,
  }
  const variant = (lastAssistant as AssistantMessage & { variant?: string }).variant
  if (variant) payload.variant = variant
  if (providerID === "kilo") {
    payload.sessionID = lastAssistant.sessionID
    payload.messageID = lastAssistant.id
    payload.parentMessageID = lastAssistant.parentID
  }
  Telemetry.trackFeedback(payload)
  ctx.toast.show({
    message: rating === "up" ? "Thanks for the feedback!" : "Thanks — we'll use this to improve.",
    variant: "success",
  })
  dialog.clear()
}
