// Delivery controls for prompts the server admitted but did not hand to the model yet. A steer joins the running turn
// at its next step boundary, a queued prompt waits until the turn ends, and "now" stops the current response first.
import type { UserMessagePending, UserMessagePendingAction } from "@kilocode/kilo-ui/message-part"
import { createSignal } from "solid-js"
import { useLanguage } from "../context/language"
import { partFeedback } from "../../../src/shared/browser-feedback"
import { useV2 } from "./client"
import { pendingActions, type PendingAction } from "./pending-actions"

const ICONS: Record<PendingAction, UserMessagePendingAction["icon"]> = {
  now: "send",
  steer: "arrow-up",
  queue: "clock",
  edit: "edit",
  delete: "close-small",
}

/**
 * Resolves the pending state of a user message in the open session. `edit` receives the text of a prompt the user
 * takes back into the composer.
 */
export function createPending(input: {
  session: () => string | undefined
  readOnly: () => boolean
  running: () => boolean
  edit: (text: string) => void
}) {
  const v2 = useV2()
  const language = useLanguage()
  // Inbox IDs with a request in flight, so a double click cannot send two conflicting mutations.
  const [busy, setBusy] = createSignal<ReadonlySet<string>>(new Set())

  const run = (inboxID: string, request: () => Promise<unknown>) => {
    if (busy().has(inboxID)) return
    setBusy((current) => new Set([...current, inboxID]))
    void request()
      .catch(v2.report)
      .finally(() =>
        setBusy((current) => {
          const next = new Set(current)
          next.delete(inboxID)
          return next
        }),
      )
  }

  const request = (sessionID: string, inboxID: string, text: string, action: PendingAction) => {
    if (action === "now") return v2.api.session.interrupt({ sessionID, resume: true })
    if (action === "steer" || action === "queue")
      return v2.api.session.inbox.update({ sessionID, inboxID, delivery: action })
    const cancel = v2.api.session.inbox.cancel({ sessionID, inboxID })
    if (action === "delete") return cancel
    return cancel.then(() => input.edit(text))
  }

  const label = (action: PendingAction) => {
    if (action === "now")
      return language.t(input.running() ? "session.pending.action.stopAndSend" : "session.pending.action.send")
    return language.t(`session.pending.action.${action}`)
  }

  return (messageID: string): UserMessagePending | undefined => {
    const sessionID = input.session()
    if (!sessionID) return undefined
    const item = v2.data.session.pending.list(sessionID).find((entry) => entry.id === messageID)
    if (item?.type !== "user") return undefined
    const status = v2.data.session.pending.status(sessionID, item.id)
    if (!status) return undefined
    // The composer restores plain text only, so a prompt with files or structured references (review comments,
    // browser references) cannot be taken back without losing data.
    const editable = !item.payload.files?.length && !partFeedback(item.payload.metadata, item.payload.text)
    const actions = input.readOnly() ? [] : pendingActions(status, editable)
    return {
      status: language.t(`session.pending.status.${status}`),
      actions: actions.map((action) => ({
        key: action,
        icon: ICONS[action],
        label: label(action),
        disabled: busy().has(item.id),
        onClick: () => run(item.id, () => request(sessionID, item.id, item.payload.text, action)),
      })),
    }
  }
}
