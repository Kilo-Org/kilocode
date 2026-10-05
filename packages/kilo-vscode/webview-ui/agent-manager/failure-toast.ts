/**
 * Host-reported failures, as toasts.
 *
 * Both shapes the host uses to report one land here: a PR action's error code, and a plain error
 * message from a worktree action. Neither has anywhere else to go — a message that is posted and
 * dropped leaves its only trace in an output channel nobody opens, which is how a failed action
 * looks like nothing happening at all.
 */
import type { AgentManagerPRErrorMessage } from "../src/types/messages"
import { REVERT_ERROR_CODE } from "../../src/shared/revert-error"
import { isCurrent } from "./project/message-ownership"

type Failure = { type?: string; message?: unknown; error?: unknown; code?: string; projectId?: string }

export interface FailureToastDeps {
  toast: (toast: { variant: "error"; title: string; description: string }) => void
  t: (key: string) => string
  /** The project on screen; a failure reported for another one is not shown. */
  project: string | undefined
}

/**
 * Shows a failure report as a toast. Answers "stale" when the message belongs to another project and
 * must not be routed any further, the same contract `routeReview` uses for review messages.
 *
 * Only a PR error carries a project, so only it can be stale. A plain error message is shown and the
 * caller keeps routing, which is what the inline branches this replaced did.
 */
export function reportFailure(msg: Failure, deps: FailureToastDeps): "stale" | undefined {
  if (msg.type === "agentManager.prError") {
    if (!isCurrent(msg, deps.project)) return "stale"
    const error = (msg as AgentManagerPRErrorMessage).error
    deps.toast({
      variant: "error",
      title: deps.t(`agentManager.pr.error.${error}.title`),
      description: deps.t(`agentManager.pr.error.${error}.description`),
    })
    return undefined
  }
  if (msg.type !== "error" || typeof msg.message !== "string" || !msg.message) return undefined
  // SessionProvider, which this webview also mounts, shows a failed revert or redo translated; the
  // host's raw message would be a second toast for the same failure.
  if (msg.code === REVERT_ERROR_CODE) return undefined
  deps.toast({ variant: "error", title: deps.t("agentManager.error.title"), description: msg.message })
  return undefined
}
