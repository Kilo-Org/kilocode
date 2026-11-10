// Delivery controls for prompts the server admitted but did not hand to the model yet. A steer joins the running turn
// at its next step boundary, a queued prompt waits until the turn ends, and "now" stops the current response first.
import type { UserMessagePending, UserMessagePendingAction } from "@kilocode/kilo-ui/message-part"
import { createSignal } from "solid-js"
import { useLanguage } from "../context/language"
import { partFeedback } from "../../../src/shared/browser-feedback"
import { useV2 } from "./client"
import { pendingActions, pendingEditable, type PendingAction } from "./pending-actions"

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
    // Sending this prompt now stops the current model call and its tools, but never a running compaction: the
    // checkpoint finishes first and the prompt follows it. Only the composer's Stop ends a compaction.
    if (action === "now") return v2.api.session.interrupt({ sessionID, resume: true, steer: true })
    if (action === "steer" || action === "queue")
      return v2.api.session.inbox.update({ sessionID, inboxID, delivery: action })
    const cancel = v2.api.session.inbox.cancel({ sessionID, inboxID })
    if (action === "delete") return cancel
    // Cancel also succeeds for an item that was delivered first. Take the text back only if the item is still
    // pending and this view still shows that session, so it cannot be sent twice or land in another draft.
    return cancel.then(() => {
      const still = v2.data.session.pending.list(sessionID).some((entry) => entry.id === inboxID)
      if (!still || input.session() !== sessionID) return
      input.edit(text)
    })
  }

  const label = (action: PendingAction) => {
    if (action === "now")
      return language.t(input.running() ? "session.pending.action.stopAndSend" : "session.pending.action.send")
    // A queued prompt outlives a stopped run. Steering it then starts a new run at once.
    if (action === "steer" && !input.running()) return language.t("session.pending.action.send")
    return language.t(`session.pending.action.${action}`)
  }

  return (messageID: string): UserMessagePending | undefined => {
    const sessionID = input.session()
    if (!sessionID) return undefined
    const item = v2.data.session.pending.list(sessionID).find((entry) => entry.id === messageID)
    if (item?.type !== "user") return undefined
    const status = v2.data.session.pending.status(sessionID, item.id)
    if (!status) return undefined
    // The composer restores plain text only, so a prompt with attachments or structured references cannot be taken
    // back without losing data.
    const editable =
      pendingEditable(item.payload) && !partFeedback(item.payload.metadata, item.payload.text)
    const actions = input.readOnly() ? [] : pendingActions(status, editable)
    return {
      // A stopped run leaves its queue parked until the user sends this prompt or another one.
      status: language.t(
        status === "queued" && !input.running() ? "session.pending.status.paused" : `session.pending.status.${status}`,
      ),
      actions: actions.map((action) => ({
        key: action,
        icon: action === "steer" && !input.running() ? ICONS.now : ICONS[action],
        label: label(action),
        disabled: busy().has(item.id),
        onClick: () => run(item.id, () => request(sessionID, item.id, item.payload.text, action)),
      })),
    }
  }
}
