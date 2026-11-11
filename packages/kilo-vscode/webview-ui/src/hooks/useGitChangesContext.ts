import { onCleanup } from "solid-js"
import type { Accessor } from "solid-js"
import type { ExtensionMessage, WebviewMessage } from "../types/messages"
import type { MentionFile } from "./context-mention-utils"
import { buildGitChangesAttachment, hasGitChangesMention } from "./git-changes-context-utils"
import { createContextRequests } from "./context-requests"

interface VSCodeContext {
  postMessage: (message: WebviewMessage) => void
  onMessage: (handler: (message: ExtensionMessage) => void) => () => void
}

/**
 * What `@git-changes` diffs: the session's directory, and for an Agent Manager worktree the base branch it is
 * compared against. Without a base the host finds the target itself.
 */
export type GitChangesTarget = { directory?: string; base?: string }

export interface GitChangesContext {
  pending: Accessor<boolean>
  resolveAttachment: (text: string, target?: GitChangesTarget) => Promise<MentionFile | undefined>
}

export function useGitChangesContext(
  vscode: VSCodeContext,
  target?: Accessor<GitChangesTarget | undefined>,
  git?: Accessor<boolean>,
): GitChangesContext {
  const requests = createContextRequests("git-changes-context", 15_000, "Timed out while reading git changes")

  const unsubscribe = vscode.onMessage((message) => {
    if (message.type === "gitChangesContextResult") {
      requests.settle(message.requestId, (req) => req.resolve(message.content))
      return
    }

    if (message.type === "gitChangesContextError") {
      requests.settle(message.requestId, (req) => req.reject(new Error(message.error)))
    }
  })

  onCleanup(() => {
    unsubscribe()
    requests.dispose("Git changes context request cancelled", true)
  })

  const resolveAttachment = async (text: string, scope?: GitChangesTarget) => {
    if (!hasGitChangesMention(text)) return undefined
    if (git?.() === false) return undefined

    const resolved = scope ?? target?.()
    const content = await requests.request((requestId) => {
      vscode.postMessage({
        type: "requestGitChangesContext",
        requestId,
        ...(resolved?.directory ? { directory: resolved.directory } : {}),
        ...(resolved?.base ? { base: resolved.base } : {}),
      })
    })
    return buildGitChangesAttachment(text, content)
  }

  return { pending: requests.pending, resolveAttachment }
}
