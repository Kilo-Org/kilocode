import { onCleanup } from "solid-js"
import type { Accessor } from "solid-js"
import type { ExtensionMessage, FileAttachment, WebviewMessage } from "../types/messages"
import { buildGitChangesAttachment, hasGitChangesMention } from "./git-changes-context-utils"
import { createContextRequests } from "./context-requests"

const GIT_CHANGES_TIMEOUT_MS = 15_000

interface VSCodeContext {
  postMessage: (message: WebviewMessage) => void
  onMessage: (handler: (message: ExtensionMessage) => void) => () => void
}

export interface GitChangesContext {
  pending: Accessor<boolean>
  resolveAttachment: (text: string, sessionID?: string, context?: string) => Promise<FileAttachment | undefined>
}

export function useGitChangesContext(
  vscode: VSCodeContext,
  context?: Accessor<string | undefined>,
  git?: Accessor<boolean>,
): GitChangesContext {
  const requests = createContextRequests(
    "git-changes-context",
    GIT_CHANGES_TIMEOUT_MS,
    "Timed out while reading git changes",
  )

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

  const request = (sessionID?: string, scope?: string) =>
    requests.request((requestId) => {
      vscode.postMessage({
        type: "requestGitChangesContext",
        requestId,
        sessionID,
        agentManagerContext: scope ?? context?.(),
      })
    })

  const resolveAttachment = async (text: string, sessionID?: string, scope?: string) => {
    if (!hasGitChangesMention(text)) return undefined
    if (git?.() === false) return undefined

    const content = await request(sessionID, scope)
    return buildGitChangesAttachment(text, content)
  }

  return { pending: requests.pending, resolveAttachment }
}
