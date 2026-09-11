import { onCleanup } from "solid-js"
import type { Accessor } from "solid-js"
import type { ExtensionMessage, FileAttachment, WebviewMessage } from "../types/messages"
import { buildGitChangesAttachment, hasGitChangesMention } from "./git-changes-context-utils"
import { createContextRequests } from "./context-requests"

interface VSCodeContext {
  postMessage: (message: WebviewMessage) => void
  onMessage: (handler: (message: ExtensionMessage) => void) => () => void
}

export interface GitChangesContext {
  pending: Accessor<boolean>
  resolveAttachment: (
    text: string,
    sessionID?: string,
    scope?: CapturedGitChangesScope,
  ) => Promise<FileAttachment | undefined>
}

export interface CapturedGitChangesScope {
  captured: true
  agentManagerContext?: string
  available: boolean
}

export function useGitChangesContext(
  vscode: VSCodeContext,
  context?: Accessor<string | undefined>,
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

  const resolveAttachment = async (text: string, sessionID?: string, scope?: CapturedGitChangesScope) => {
    if (!hasGitChangesMention(text)) return undefined
    const available = scope?.captured ? scope.available : git?.()
    if (available === false) return undefined
    const agentManagerContext = scope?.captured ? scope.agentManagerContext : context?.()

    const content = await requests.request((requestId) => {
      vscode.postMessage({
        type: "requestGitChangesContext",
        requestId,
        sessionID,
        ...(agentManagerContext === undefined ? {} : { agentManagerContext }),
      })
    })
    return buildGitChangesAttachment(text, content)
  }

  return { pending: requests.pending, resolveAttachment }
}
