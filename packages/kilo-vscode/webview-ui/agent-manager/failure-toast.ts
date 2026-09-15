/**
 * Host-reported failures, as toasts.
 *
 * Both shapes the host uses to report one land here: a PR action's error code, and a plain error
 * message from a worktree action. Neither has anywhere else to go — a message that is posted and
 * dropped leaves its only trace in an output channel nobody opens, which is how a failed action
 * looks like nothing happening at all.
 */
import type { AgentManagerPRErrorMessage } from "../src/types/messages"
import { isCurrent } from "./project/message-ownership"

type Failure = { type?: string; message?: unknown; error?: unknown; projectId?: string }

export interface FailureToastDeps {
  toast: (toast: { variant: "error"; title: string; description: string }) => void
  t: (key: string) => string
  /** The project on screen; a failure reported for another one is not shown. */
  project: string | undefined
}

/** True when the message was a failure report, whether or not a toast was shown for it. */
export function reportFailure(msg: Failure, deps: FailureToastDeps): boolean {
  if (msg.type === "agentManager.prError") {
    if (!isCurrent(msg, deps.project)) return true
    const error = (msg as AgentManagerPRErrorMessage).error
    deps.toast({
      variant: "error",
      title: deps.t(`agentManager.pr.error.${error}.title`),
      description: deps.t(`agentManager.pr.error.${error}.description`),
    })
    return true
  }
  if (msg.type !== "error" || typeof msg.message !== "string" || !msg.message) return false
  deps.toast({ variant: "error", title: deps.t("agentManager.error.title"), description: msg.message })
  return true
}
